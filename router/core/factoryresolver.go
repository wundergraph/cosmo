package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"net/url"
	"slices"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/argument_templates"

	"github.com/buger/jsonparser"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/routerplugin"

	"github.com/jensneuse/abstractlogger"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	grpcdatasource "github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/grpc_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/staticdatasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"

	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

type Loader struct {
	resolver FactoryResolver
	// includeInfo controls whether additional information like type usage and field usage is included in the plan de
	includeInfo bool
}

type FactoryResolver interface {
	ResolveGraphqlFactory(subgraphName string) (plan.PlannerFactory[graphql_datasource.Configuration], error)
	ResolveStaticFactory() (plan.PlannerFactory[staticdatasource.Configuration], error)
	ResolvePubsubFactory() (plan.PlannerFactory[pubsub_datasource.Configuration], error)
}

type ApiTransportFactory interface {
	RoundTripper(enableSingleFlight bool, transport http.RoundTripper) http.RoundTripper
	DefaultHTTPProxyURL() *url.URL
}

type DefaultFactoryResolver struct {
	static *staticdatasource.Factory[staticdatasource.Configuration]
	pubsub *pubsub_datasource.Factory[pubsub_datasource.Configuration]
	log    *zap.Logger

	engineCtx          context.Context
	enableSingleFlight bool
	streamingClient    *http.Client
	subscriptionClient graphql_datasource.GraphQLSubscriptionClient

	httpClient          *http.Client
	subgraphHTTPClients map[string]*http.Client
	pluginHost          *routerplugin.Host

	factoryLogger abstractlogger.Logger
}

func NewDefaultFactoryResolver(
	ctx context.Context,
	transportOptions *TransportOptions,
	subscriptionClientOptions *SubscriptionClientOptions,
	baseTransport http.RoundTripper,
	subgraphTransports map[string]http.RoundTripper,
	pluginHost *routerplugin.Host,
	log *zap.Logger,
	enableSingleFlight bool,
	enableNetPoll bool,
	natsPubSubBySourceID map[string]pubsub_datasource.NatsPubSub,
	kafkaPubSubBySourceID map[string]pubsub_datasource.KafkaPubSub,
) *DefaultFactoryResolver {
	transportFactory := NewTransport(transportOptions)

	defaultHTTPClient := &http.Client{
		Timeout:   transportOptions.SubgraphTransportOptions.RequestTimeout,
		Transport: transportFactory.RoundTripper(enableSingleFlight, baseTransport),
	}

	streamingClient := &http.Client{
		Transport: transportFactory.RoundTripper(enableSingleFlight, baseTransport),
	}

	subgraphHTTPClients := map[string]*http.Client{}

	for subgraph, subgraphOpts := range transportOptions.SubgraphTransportOptions.SubgraphMap {
		subgraphTransport, ok := subgraphTransports[subgraph]
		if !ok {
			panic(fmt.Sprintf("subgraph %s not found in subgraphTransports", subgraph))
		}

		// make a new http client
		subgraphClient := &http.Client{
			Transport: transportFactory.RoundTripper(enableSingleFlight, subgraphTransport),
			Timeout:   subgraphOpts.RequestTimeout,
		}

		subgraphHTTPClients[subgraph] = subgraphClient
	}

	var factoryLogger abstractlogger.Logger
	if log != nil {
		factoryLogger = abstractlogger.NewZapLogger(log, abstractlogger.DebugLevel)
	}

	var netPollConfig graphql_datasource.NetPollConfiguration

	netPollConfig.ApplyDefaults()

	netPollConfig.Enable = enableNetPoll

	options := []graphql_datasource.Options{
		graphql_datasource.WithLogger(factoryLogger),
		graphql_datasource.WithNetPollConfiguration(netPollConfig),
	}

	if subscriptionClientOptions != nil {
		if subscriptionClientOptions.PingInterval > 0 {
			options = append(options, graphql_datasource.WithPingInterval(subscriptionClientOptions.PingInterval))
		}
		if subscriptionClientOptions.ReadTimeout > 0 {
			options = append(options, graphql_datasource.WithReadTimeout(subscriptionClientOptions.ReadTimeout))
		}
		if subscriptionClientOptions.PingTimeout > 0 {
			options = append(options, graphql_datasource.WithPingTimeout(subscriptionClientOptions.PingTimeout))
		}
		if subscriptionClientOptions.FrameTimeout > 0 {
			options = append(options, graphql_datasource.WithFrameTimeout(subscriptionClientOptions.FrameTimeout))
		}
	}

	subscriptionClient := graphql_datasource.NewGraphQLSubscriptionClient(
		defaultHTTPClient,
		streamingClient,
		ctx,
		options...,
	)

	return &DefaultFactoryResolver{
		static:             &staticdatasource.Factory[staticdatasource.Configuration]{},
		pubsub:             pubsub_datasource.NewFactory(ctx, natsPubSubBySourceID, kafkaPubSubBySourceID),
		log:                log,
		factoryLogger:      factoryLogger,
		engineCtx:          ctx,
		enableSingleFlight: enableSingleFlight,
		streamingClient:    streamingClient,
		subscriptionClient: subscriptionClient,

		httpClient:          defaultHTTPClient,
		subgraphHTTPClients: subgraphHTTPClients,
		pluginHost:          pluginHost,
	}
}

func (d *DefaultFactoryResolver) ResolveGraphqlFactory(subgraphName string) (plan.PlannerFactory[graphql_datasource.Configuration], error) {
	if d.pluginHost != nil {
		// If the plugin host is not nil, we try to get the plugin for the subgraph.
		// In case of a plugin, we use the gRPC client provider to create the factory.
		plugin, exists := d.pluginHost.GetPlugin(subgraphName)
		if exists {
			return graphql_datasource.NewFactoryGRPCClientProvider(d.engineCtx, plugin.GetClient)
		}
	}

	if subgraphClient, ok := d.subgraphHTTPClients[subgraphName]; ok {
		return graphql_datasource.NewFactory(d.engineCtx, subgraphClient, d.subscriptionClient)
	}

	return graphql_datasource.NewFactory(d.engineCtx, d.httpClient, d.subscriptionClient)
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
	Headers                  *config.HeaderRules
	Events                   config.EventsConfiguration
	SubgraphErrorPropagation config.SubgraphErrorPropagationConfiguration
}

func mapProtoFilterToPlanFilter(input *nodev1.SubscriptionFilterCondition, output *plan.SubscriptionFilterCondition) *plan.SubscriptionFilterCondition {
	if input == nil {
		return nil
	}
	if input.And != nil {
		output.And = make([]plan.SubscriptionFilterCondition, len(input.And))
		for i := range input.And {
			mapProtoFilterToPlanFilter(input.And[i], &output.And[i])
		}
		return output
	}
	if input.In != nil {
		var values []string
		_, err := jsonparser.ArrayEach([]byte(input.In.Json), func(value []byte, dataType jsonparser.ValueType, offset int, err error) {
			// if the value is not a string, just append it as is because this is the JSON
			// representation of the value. If it contains a template, we want to keep it as
			// is to explode it later with the actual values
			if dataType != jsonparser.String || argument_templates.ContainsArgumentTemplateString(value) {
				values = append(values, string(value))
				return
			}
			// stringify values to prevent its actual type from being lost
			// during the transport to the engine as bytes
			marshaledValue, mErr := json.Marshal(string(value))
			if mErr != nil {
				return
			}
			values = append(values, string(marshaledValue))
		})
		if err != nil {
			return nil
		}
		output.In = &plan.SubscriptionFieldCondition{
			FieldPath: input.In.FieldPath,
			Values:    values,
		}
		return output
	}
	if input.Not != nil {
		output.Not = mapProtoFilterToPlanFilter(input.Not, &plan.SubscriptionFilterCondition{})
		return output
	}
	if input.Or != nil {
		output.Or = make([]plan.SubscriptionFilterCondition, len(input.Or))
		for i := range input.Or {
			output.Or[i] = plan.SubscriptionFilterCondition{}
			mapProtoFilterToPlanFilter(input.Or[i], &output.Or[i])
		}
		return output
	}
	return nil
}

func (l *Loader) Load(engineConfig *nodev1.EngineConfiguration, subgraphs []*nodev1.Subgraph, routerEngineConfig *RouterEngineConfiguration, pluginsEnabled bool) (*plan.Configuration, error) {
	var outConfig plan.Configuration
	// attach field usage information to the plan
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
			TypeName:                    configuration.TypeName,
			FieldName:                   configuration.FieldName,
			Arguments:                   args,
			HasAuthorizationRule:        l.fieldHasAuthorizationRule(configuration),
			SubscriptionFilterCondition: mapProtoFilterToPlanFilter(configuration.SubscriptionFilterCondition, &plan.SubscriptionFilterCondition{}),
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
			factory, err := l.resolver.ResolveStaticFactory()
			if err != nil {
				return nil, err
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

			wsSubprotocol := "auto"
			if in.CustomGraphql.Subscription.WebsocketSubprotocol != nil {
				switch *in.CustomGraphql.Subscription.WebsocketSubprotocol {
				case common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS:
					wsSubprotocol = "graphql-ws"
				case common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_TRANSPORT_WS:
					wsSubprotocol = "graphql-transport-ws"
				case common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO:
					wsSubprotocol = "auto"
				}
			}

			dataSourceRules := FetchURLRules(routerEngineConfig.Headers, subgraphs, subscriptionUrl)
			forwardedClientHeaders, forwardedClientRegexps, err := PropagatedHeaders(dataSourceRules)
			if err != nil {
				return nil, fmt.Errorf("error parsing header rules for data source %s: %w", in.Id, err)
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

			grpcConfig := toGRPCConfiguration(in.CustomGraphql.Grpc, pluginsEnabled)
			if grpcConfig != nil {
				grpcConfig.Compiler, err = grpcdatasource.NewProtoCompiler(in.CustomGraphql.Grpc.ProtoSchema, grpcConfig.Mapping)
				if err != nil {
					return nil, fmt.Errorf("error creating proto compiler for data source %s: %w", in.Id, err)
				}
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
					WsSubProtocol:                           wsSubprotocol,
				},
				SchemaConfiguration:    schemaConfiguration,
				CustomScalarTypeFields: customScalarTypeFields,
				GRPC:                   grpcConfig,
			})
			if err != nil {
				return nil, fmt.Errorf("error creating custom configuration for data source %s: %w", in.Id, err)
			}

			dataSourceName := l.subgraphName(subgraphs, in.Id)

			factory, err := l.resolver.ResolveGraphqlFactory(dataSourceName)
			if err != nil {
				return nil, err
			}

			out, err = plan.NewDataSourceConfigurationWithName[graphql_datasource.Configuration](
				in.Id,
				dataSourceName,
				factory,
				l.dataSourceMetaData(in),
				customConfiguration,
			)
			if err != nil {
				return nil, fmt.Errorf("error creating data source configuration for data source %s: %w", in.Id, err)
			}

		case nodev1.DataSourceKind_PUBSUB:
			var eventConfigurations []pubsub_datasource.EventConfiguration

			for _, eventConfiguration := range in.GetCustomEvents().GetNats() {
				eventType, err := pubsub_datasource.EventTypeFromString(eventConfiguration.EngineEventConfiguration.Type.String())
				if err != nil {
					return nil, fmt.Errorf("invalid event type %q for data source %q: %w", eventConfiguration.EngineEventConfiguration.Type.String(), in.Id, err)
				}

				var streamConfiguration *pubsub_datasource.NatsStreamConfiguration
				if eventConfiguration.StreamConfiguration != nil {
					streamConfiguration = &pubsub_datasource.NatsStreamConfiguration{
						Consumer:                  eventConfiguration.StreamConfiguration.GetConsumerName(),
						StreamName:                eventConfiguration.StreamConfiguration.GetStreamName(),
						ConsumerInactiveThreshold: eventConfiguration.StreamConfiguration.GetConsumerInactiveThreshold(),
					}
				}

				eventConfigurations = append(eventConfigurations, pubsub_datasource.EventConfiguration{
					Metadata: &pubsub_datasource.EventMetadata{
						ProviderID: eventConfiguration.EngineEventConfiguration.GetProviderId(),
						Type:       eventType,
						TypeName:   eventConfiguration.EngineEventConfiguration.GetTypeName(),
						FieldName:  eventConfiguration.EngineEventConfiguration.GetFieldName(),
					},
					Configuration: &pubsub_datasource.NatsEventConfiguration{
						StreamConfiguration: streamConfiguration,
						Subjects:            eventConfiguration.GetSubjects(),
					},
				})
			}

			for _, eventConfiguration := range in.GetCustomEvents().GetKafka() {
				eventType, err := pubsub_datasource.EventTypeFromString(eventConfiguration.EngineEventConfiguration.Type.String())
				if err != nil {
					return nil, fmt.Errorf("invalid event type %q for data source %q: %w", eventConfiguration.EngineEventConfiguration.Type.String(), in.Id, err)
				}

				eventConfigurations = append(eventConfigurations, pubsub_datasource.EventConfiguration{
					Metadata: &pubsub_datasource.EventMetadata{
						ProviderID: eventConfiguration.EngineEventConfiguration.GetProviderId(),
						Type:       eventType,
						TypeName:   eventConfiguration.EngineEventConfiguration.GetTypeName(),
						FieldName:  eventConfiguration.EngineEventConfiguration.GetFieldName(),
					},
					Configuration: &pubsub_datasource.KafkaEventConfiguration{
						Topics: eventConfiguration.GetTopics(),
					},
				})
			}

			factory, err := l.resolver.ResolvePubsubFactory()
			if err != nil {
				return nil, err
			}

			out, err = plan.NewDataSourceConfiguration[pubsub_datasource.Configuration](
				in.Id,
				factory,
				l.dataSourceMetaData(in),
				pubsub_datasource.Configuration{
					Events: eventConfigurations,
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

func (l *Loader) subgraphName(subgraphs []*nodev1.Subgraph, dataSourceID string) string {
	i := slices.IndexFunc(subgraphs, func(s *nodev1.Subgraph) bool {
		return s.Id == dataSourceID
	})

	if i != -1 {
		return subgraphs[i].Name
	}

	return ""
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
			TypeName:           node.TypeName,
			FieldNames:         node.FieldNames,
			ExternalFieldNames: node.ExternalFieldNames,
		})
	}
	for _, node := range in.ChildNodes {
		out.ChildNodes = append(out.ChildNodes, plan.TypeField{
			TypeName:           node.TypeName,
			FieldNames:         node.FieldNames,
			ExternalFieldNames: node.ExternalFieldNames,
		})
	}
	for _, directive := range in.Directives {
		*out.Directives = append(*out.Directives, plan.DirectiveConfiguration{
			DirectiveName: directive.DirectiveName,
			RenameTo:      directive.DirectiveName,
		})
	}

	for _, keyConfiguration := range in.Keys {
		var conditions []plan.KeyCondition

		if len(keyConfiguration.Conditions) > 0 {
			conditions = make([]plan.KeyCondition, 0, len(keyConfiguration.Conditions))
			for _, condition := range keyConfiguration.Conditions {
				coordinates := make([]plan.KeyConditionCoordinate, 0, len(condition.FieldCoordinatesPath))
				for _, coordinate := range condition.FieldCoordinatesPath {
					coordinates = append(coordinates, plan.KeyConditionCoordinate{
						TypeName:  coordinate.TypeName,
						FieldName: coordinate.FieldName,
					})
				}

				conditions = append(conditions, plan.KeyCondition{
					Coordinates: coordinates,
					FieldPath:   condition.FieldPath,
				})
			}
		}

		out.FederationMetaData.Keys = append(out.FederationMetaData.Keys, plan.FederationFieldConfiguration{
			TypeName:              keyConfiguration.TypeName,
			FieldName:             keyConfiguration.FieldName,
			SelectionSet:          keyConfiguration.SelectionSet,
			DisableEntityResolver: keyConfiguration.DisableEntityResolver,
			Conditions:            conditions,
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

// toGRPCConfiguration converts a nodev1.GRPCConfiguration to a grpcdatasource.GRPCConfiguration.
// It is used to configure the gRPC datasource for a subgraph.
// The pluginsEnabled flag is used to disable the gRPC datasource if the plugins are not enabled.
func toGRPCConfiguration(config *nodev1.GRPCConfiguration, pluginsEnabled bool) *grpcdatasource.GRPCConfiguration {
	if config == nil || config.Mapping == nil {
		return nil
	}

	in := config.Mapping

	result := &grpcdatasource.GRPCMapping{
		Service:          in.Service,
		QueryRPCs:        make(grpcdatasource.RPCConfigMap),
		MutationRPCs:     make(grpcdatasource.RPCConfigMap),
		SubscriptionRPCs: make(grpcdatasource.RPCConfigMap),
		EntityRPCs:       make(map[string]grpcdatasource.EntityRPCConfig),
		Fields:           make(map[string]grpcdatasource.FieldMap),
		EnumValues:       make(map[string][]grpcdatasource.EnumValueMapping),
	}

	for _, operation := range in.OperationMappings {
		rpcConfig := grpcdatasource.RPCConfig{
			RPC:      operation.Mapped,
			Request:  operation.Request,
			Response: operation.Response,
		}
		switch operation.Type {
		case nodev1.OperationType_OPERATION_TYPE_QUERY:
			result.QueryRPCs[operation.Original] = rpcConfig
		case nodev1.OperationType_OPERATION_TYPE_MUTATION:
			result.MutationRPCs[operation.Original] = rpcConfig
		case nodev1.OperationType_OPERATION_TYPE_SUBSCRIPTION:
			result.SubscriptionRPCs[operation.Original] = rpcConfig
		}
	}

	for _, entity := range in.EntityMappings {
		result.EntityRPCs[entity.Key] = grpcdatasource.EntityRPCConfig{
			Key: entity.Key,
			RPCConfig: grpcdatasource.RPCConfig{
				RPC:      entity.Rpc,
				Request:  entity.Request,
				Response: entity.Response,
			},
		}
	}

	for _, field := range in.TypeFieldMappings {
		fieldMap := grpcdatasource.FieldMap{}

		for _, fieldMapping := range field.FieldMappings {
			fieldMap[fieldMapping.Original] = grpcdatasource.FieldMapData{
				TargetName:       fieldMapping.Mapped,
				ArgumentMappings: grpcdatasource.FieldArgumentMap{},
			}

			for _, argumentMapping := range fieldMapping.ArgumentMappings {
				fieldMap[fieldMapping.Original].ArgumentMappings[argumentMapping.Original] = argumentMapping.Mapped
			}
		}

		result.Fields[field.Type] = fieldMap
	}

	for _, enumMapping := range in.EnumMappings {
		result.EnumValues[enumMapping.Type] = make([]grpcdatasource.EnumValueMapping, 0, len(enumMapping.Values))
		for _, enumValueMapping := range enumMapping.Values {
			result.EnumValues[enumMapping.Type] = append(result.EnumValues[enumMapping.Type], grpcdatasource.EnumValueMapping{
				Value:       enumValueMapping.Original,
				TargetValue: enumValueMapping.Mapped,
			})
		}
	}

	return &grpcdatasource.GRPCConfiguration{
		Mapping:  result,
		Disabled: !pluginsEnabled,
	}
}
