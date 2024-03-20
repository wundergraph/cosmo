package core

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/jensneuse/abstractlogger"
	"github.com/nats-io/nats.go"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/staticdatasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"

	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/pubsub"
)

type Loader struct {
	resolver FactoryResolver
	// includeInfo controls whether additional information like type usage and field usage is included in the plan
	includeInfo bool
}

type FactoryResolver interface {
	ResolveGraphqlFactory() (plan.PlannerFactory[graphql_datasource.Configuration], error)
	ResolveStaticFactory() (plan.PlannerFactory[staticdatasource.Configuration], error)
	ResolvePubsubFactory() (plan.PlannerFactory[pubsub_datasource.Configuration], error)
}

type ApiTransportFactory interface {
	RoundTripper(enableSingleFlight bool, transport http.RoundTripper) http.RoundTripper
	DefaultTransportTimeout() time.Duration
	DefaultHTTPProxyURL() *url.URL
}

type DefaultFactoryResolver struct {
	baseTransport    http.RoundTripper
	transportFactory ApiTransportFactory

	static *staticdatasource.Factory[staticdatasource.Configuration]
	pubsub *pubsub_datasource.Factory[pubsub_datasource.Configuration]
	log    *zap.Logger

	engineCtx       context.Context
	httpClient      *http.Client
	streamingClient *http.Client
	factoryLogger   abstractlogger.Logger
}

func NewDefaultFactoryResolver(ctx context.Context, transportFactory ApiTransportFactory, baseTransport http.RoundTripper, log *zap.Logger, enableSingleFlight bool, natsConnection *nats.Conn) *DefaultFactoryResolver {

	defaultHttpClient := &http.Client{
		Timeout:   transportFactory.DefaultTransportTimeout(),
		Transport: transportFactory.RoundTripper(enableSingleFlight, baseTransport),
	}
	streamingClient := &http.Client{
		Transport: transportFactory.RoundTripper(enableSingleFlight, baseTransport),
	}

	var factoryLogger abstractlogger.Logger
	if log != nil {
		factoryLogger = abstractlogger.NewZapLogger(log, abstractlogger.DebugLevel)
	}

	return &DefaultFactoryResolver{
		baseTransport:    baseTransport,
		transportFactory: transportFactory,
		static:           &staticdatasource.Factory[staticdatasource.Configuration]{},
		pubsub: pubsub_datasource.NewFactory(
			ctx,
			pubsub.NewNATSConnector(natsConnection),
		),
		log:             log,
		factoryLogger:   factoryLogger,
		engineCtx:       ctx,
		httpClient:      defaultHttpClient,
		streamingClient: streamingClient,
	}
}

func (d *DefaultFactoryResolver) ResolveGraphqlFactory() (plan.PlannerFactory[graphql_datasource.Configuration], error) {
	subscriptionClient := graphql_datasource.NewGraphQLSubscriptionClient(d.httpClient, d.streamingClient, d.engineCtx, graphql_datasource.WithLogger(d.factoryLogger))

	factory, err := graphql_datasource.NewFactory(d.engineCtx, d.httpClient, subscriptionClient)
	return factory, err
}

func (d *DefaultFactoryResolver) ResolveStaticFactory() (factory plan.PlannerFactory[staticdatasource.Configuration], err error) {
	return d.static, nil
}

func (d *DefaultFactoryResolver) ResolvePubsubFactory() (factory plan.PlannerFactory[pubsub_datasource.Configuration], err error) {
	return d.pubsub, nil
}

func NewLoader(includeInfo bool, resolver FactoryResolver) *Loader {
	return &Loader{
		resolver:    resolver,
		includeInfo: includeInfo,
	}
}

func (l *Loader) LoadInternedString(engineConfig *nodev1.EngineConfiguration, str *nodev1.InternedString) (string, error) {
	key := str.GetKey()
	s, ok := engineConfig.StringStorage[key]
	if !ok {
		return "", fmt.Errorf("no string found for key %q", key)
	}
	return s, nil
}

type RouterEngineConfiguration struct {
	Execution                config.EngineExecutionConfiguration
	Headers                  config.HeaderRules
	Events                   config.EventsConfiguration
	SubgraphErrorPropagation config.SubgraphErrorPropagationConfiguration
}

func (l *Loader) Load(routerConfig *nodev1.RouterConfig, routerEngineConfig *RouterEngineConfiguration) (*plan.Configuration, error) {
	var (
		outConfig plan.Configuration
	)
	// attach field usage information to the plan
	engineConfig := routerConfig.EngineConfig
	outConfig.IncludeInfo = l.includeInfo
	outConfig.DefaultFlushIntervalMillis = engineConfig.DefaultFlushInterval
	for _, configuration := range engineConfig.FieldConfigurations {
		var args []plan.ArgumentConfiguration
		for _, argumentConfiguration := range configuration.ArgumentsConfiguration {
			arg := plan.ArgumentConfiguration{
				Name: argumentConfiguration.Name,
			}
			switch argumentConfiguration.SourceType {
			case nodev1.ArgumentSource_FIELD_ARGUMENT:
				arg.SourceType = plan.FieldArgumentSource
			case nodev1.ArgumentSource_OBJECT_FIELD:
				arg.SourceType = plan.ObjectFieldSource
			}
			args = append(args, arg)
		}
		fieldConfig := plan.FieldConfiguration{
			TypeName:             configuration.TypeName,
			FieldName:            configuration.FieldName,
			Arguments:            args,
			HasAuthorizationRule: l.fieldHasAuthorizationRule(configuration),
		}
		outConfig.Fields = append(outConfig.Fields, fieldConfig)
	}

	for _, configuration := range engineConfig.TypeConfigurations {
		outConfig.Types = append(outConfig.Types, plan.TypeConfiguration{
			TypeName: configuration.TypeName,
			RenameTo: configuration.RenameTo,
		})
	}

	for _, in := range engineConfig.DatasourceConfigurations {
		var out plan.DataSource

		switch in.Kind {
		case nodev1.DataSourceKind_STATIC:
			factory, err := l.resolveStaticFactory()
			if err != nil {
				return nil, err
			}
			if factory == nil {
				continue
			}

			out, err = plan.NewDataSourceConfiguration[staticdatasource.Configuration](
				in.Id,
				factory,
				l.dataSourceMetaData(in),
				staticdatasource.Configuration{
					Data: config.LoadStringVariable(in.CustomStatic.Data),
				},
			)
			if err != nil {
				return nil, fmt.Errorf("error creating data source configuration for data source %s: %w", in.Id, err)
			}

		case nodev1.DataSourceKind_GRAPHQL:
			header := http.Header{}
			for s, httpHeader := range in.CustomGraphql.Fetch.Header {
				for _, value := range httpHeader.Values {
					header.Add(s, config.LoadStringVariable(value))
				}
			}

			fetchUrl := config.LoadStringVariable(in.CustomGraphql.Fetch.GetUrl())

			subscriptionUrl := config.LoadStringVariable(in.CustomGraphql.Subscription.Url)
			if subscriptionUrl == "" {
				subscriptionUrl = fetchUrl
			}

			customScalarTypeFields := make([]graphql_datasource.SingleTypeField, len(in.CustomGraphql.CustomScalarTypeFields))
			for i, v := range in.CustomGraphql.CustomScalarTypeFields {
				customScalarTypeFields[i] = graphql_datasource.SingleTypeField{
					TypeName:  v.TypeName,
					FieldName: v.FieldName,
				}
			}

			graphqlSchema, err := l.LoadInternedString(engineConfig, in.CustomGraphql.GetUpstreamSchema())
			if err != nil {
				return nil, fmt.Errorf("could not load GraphQL schema for data source %s: %w", in.Id, err)
			}

			var subscriptionUseSSE bool
			var subscriptionSSEMethodPost bool
			if in.CustomGraphql.Subscription.Protocol != nil {
				switch *in.CustomGraphql.Subscription.Protocol {
				case common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_WS:
					subscriptionUseSSE = false
					subscriptionSSEMethodPost = false
				case common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE:
					subscriptionUseSSE = true
					subscriptionSSEMethodPost = false
				case common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST:
					subscriptionUseSSE = true
					subscriptionSSEMethodPost = true
				}
			} else {
				// Old style config
				if in.CustomGraphql.Subscription.UseSSE != nil {
					subscriptionUseSSE = *in.CustomGraphql.Subscription.UseSSE
				}
			}
			dataSourceRules := FetchURLRules(&routerEngineConfig.Headers, routerConfig.Subgraphs, subscriptionUrl)
			forwardedClientHeaders, forwardedClientRegexps, err := PropagatedHeaders(dataSourceRules)
			if err != nil {
				return nil, fmt.Errorf("error parsing header rules for data source %s: %w", in.Id, err)
			}

			factory, err := l.resolveGraphqlFactory()
			if err != nil {
				return nil, err
			}
			if factory == nil {
				continue
			}

			schemaConfiguration, err := graphql_datasource.NewSchemaConfiguration(
				graphqlSchema,
				&graphql_datasource.FederationConfiguration{
					Enabled:    in.CustomGraphql.Federation.Enabled,
					ServiceSDL: in.CustomGraphql.Federation.ServiceSdl,
				},
			)
			if err != nil {
				return nil, fmt.Errorf("error creating schema configuration for data source %s: %w", in.Id, err)
			}

			customConfiguration, err := graphql_datasource.NewConfiguration(graphql_datasource.ConfigurationInput{
				Fetch: &graphql_datasource.FetchConfiguration{
					URL:    fetchUrl,
					Method: in.CustomGraphql.Fetch.Method.String(),
					Header: header,
				},
				Subscription: &graphql_datasource.SubscriptionConfiguration{
					URL:                                     subscriptionUrl,
					UseSSE:                                  subscriptionUseSSE,
					SSEMethodPost:                           subscriptionSSEMethodPost,
					ForwardedClientHeaderNames:              forwardedClientHeaders,
					ForwardedClientHeaderRegularExpressions: forwardedClientRegexps,
				},
				SchemaConfiguration:    schemaConfiguration,
				CustomScalarTypeFields: customScalarTypeFields,
			})
			if err != nil {
				return nil, fmt.Errorf("error creating custom configuration for data source %s: %w", in.Id, err)
			}

			out, err = plan.NewDataSourceConfiguration[graphql_datasource.Configuration](
				in.Id,
				factory,
				l.dataSourceMetaData(in),
				customConfiguration,
			)
			if err != nil {
				return nil, fmt.Errorf("error creating data source configuration for data source %s: %w", in.Id, err)
			}

		case nodev1.DataSourceKind_PUBSUB:
			pubsubEvents := in.GetCustomEvents().GetEvents()
			events := make([]pubsub_datasource.EventConfiguration, len(pubsubEvents))
			for ii, ev := range pubsubEvents {
				eventType, err := pubsub_datasource.EventTypeFromString(ev.Type.String())
				if err != nil {
					return nil, fmt.Errorf("invalid event type %q for data source %q: %w", ev.Type.String(), in.Id, err)
				}
				events[ii] = pubsub_datasource.EventConfiguration{
					Type:      eventType,
					TypeName:  ev.TypeName,
					FieldName: ev.FieldName,
					Topic:     ev.Topic,
				}
			}

			factory, err := l.resolvePubsubFactory()
			if err != nil {
				return nil, err
			}
			if factory == nil {
				continue
			}

			out, err = plan.NewDataSourceConfiguration[pubsub_datasource.Configuration](
				in.Id,
				factory,
				l.dataSourceMetaData(in),
				pubsub_datasource.Configuration{
					Events: events,
				},
			)
			if err != nil {
				return nil, fmt.Errorf("error creating data source configuration for data source %s: %w", in.Id, err)
			}
		default:
			return nil, fmt.Errorf("unknown data source type %q", in.Kind)
		}

		outConfig.DataSources = append(outConfig.DataSources, out)
	}
	return &outConfig, nil
}

func (l *Loader) dataSourceMetaData(in *nodev1.DataSourceConfiguration) *plan.DataSourceMetadata {
	var d plan.DirectiveConfigurations = make([]plan.DirectiveConfiguration, 0, len(in.Directives))

	out := &plan.DataSourceMetadata{
		RootNodes:  make([]plan.TypeField, 0, len(in.RootNodes)),
		ChildNodes: make([]plan.TypeField, 0, len(in.ChildNodes)),
		Directives: &d,
		FederationMetaData: plan.FederationMetaData{
			Keys:     make([]plan.FederationFieldConfiguration, 0, len(in.Keys)),
			Requires: make([]plan.FederationFieldConfiguration, 0, len(in.Requires)),
			Provides: make([]plan.FederationFieldConfiguration, 0, len(in.Provides)),
		},
	}

	for _, node := range in.RootNodes {
		out.RootNodes = append(out.RootNodes, plan.TypeField{
			TypeName:   node.TypeName,
			FieldNames: node.FieldNames,
		})
	}
	for _, node := range in.ChildNodes {
		out.ChildNodes = append(out.ChildNodes, plan.TypeField{
			TypeName:   node.TypeName,
			FieldNames: node.FieldNames,
		})
	}
	for _, directive := range in.Directives {
		*out.Directives = append(*out.Directives, plan.DirectiveConfiguration{
			DirectiveName: directive.DirectiveName,
			RenameTo:      directive.DirectiveName,
		})
	}

	for _, keyConfiguration := range in.Keys {
		out.FederationMetaData.Keys = append(out.FederationMetaData.Keys, plan.FederationFieldConfiguration{
			TypeName:     keyConfiguration.TypeName,
			FieldName:    keyConfiguration.FieldName,
			SelectionSet: keyConfiguration.SelectionSet,
		})
	}
	for _, providesConfiguration := range in.Provides {
		out.FederationMetaData.Provides = append(out.FederationMetaData.Provides, plan.FederationFieldConfiguration{
			TypeName:     providesConfiguration.TypeName,
			FieldName:    providesConfiguration.FieldName,
			SelectionSet: providesConfiguration.SelectionSet,
		})
	}
	for _, requiresConfiguration := range in.Requires {
		out.FederationMetaData.Requires = append(out.FederationMetaData.Requires, plan.FederationFieldConfiguration{
			TypeName:     requiresConfiguration.TypeName,
			FieldName:    requiresConfiguration.FieldName,
			SelectionSet: requiresConfiguration.SelectionSet,
		})
	}
	for _, entityInterfacesConfiguration := range in.EntityInterfaces {
		out.FederationMetaData.EntityInterfaces = append(out.FederationMetaData.EntityInterfaces, plan.EntityInterfaceConfiguration{
			InterfaceTypeName: entityInterfacesConfiguration.InterfaceTypeName,
			ConcreteTypeNames: entityInterfacesConfiguration.ConcreteTypeNames,
		})
	}
	for _, interfaceObjectConfiguration := range in.InterfaceObjects {
		out.FederationMetaData.InterfaceObjects = append(out.FederationMetaData.InterfaceObjects, plan.EntityInterfaceConfiguration{
			InterfaceTypeName: interfaceObjectConfiguration.InterfaceTypeName,
			ConcreteTypeNames: interfaceObjectConfiguration.ConcreteTypeNames,
		})
	}

	return out
}

func (l *Loader) resolveGraphqlFactory() (factory plan.PlannerFactory[graphql_datasource.Configuration], err error) {
	return l.resolver.ResolveGraphqlFactory()
}

func (l *Loader) resolveStaticFactory() (factory plan.PlannerFactory[staticdatasource.Configuration], err error) {
	return l.resolver.ResolveStaticFactory()
}

func (l *Loader) resolvePubsubFactory() (factory plan.PlannerFactory[pubsub_datasource.Configuration], err error) {
	return l.resolver.ResolvePubsubFactory()
}

func (l *Loader) fieldHasAuthorizationRule(fieldConfiguration *nodev1.FieldConfiguration) bool {
	if fieldConfiguration == nil {
		return false
	}
	if fieldConfiguration.AuthorizationConfiguration == nil {
		return false
	}
	if fieldConfiguration.AuthorizationConfiguration.RequiresAuthentication {
		return true
	}
	if len(fieldConfiguration.AuthorizationConfiguration.RequiredOrScopes) > 0 {
		return true
	}
	return false
}
