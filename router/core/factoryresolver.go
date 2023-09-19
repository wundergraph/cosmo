package core

import (
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/staticdatasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/config"
)

type Loader struct {
	resolvers []FactoryResolver
}

type FactoryResolver interface {
	Resolve(ds *nodev1.DataSourceConfiguration) (plan.PlannerFactory, error)
}

type ApiTransportFactory interface {
	RoundTripper(transport http.RoundTripper, enableStreamingMode bool) http.RoundTripper
	DefaultTransportTimeout() time.Duration
	DefaultHTTPProxyURL() *url.URL
}

type DefaultFactoryResolver struct {
	baseTransport    *http.Transport
	transportFactory ApiTransportFactory
	graphql          *graphql_datasource.Factory
	static           *staticdatasource.Factory
	log              *zap.Logger
}

func NewDefaultFactoryResolver(transportFactory ApiTransportFactory, baseTransport *http.Transport,
	log *zap.Logger) *DefaultFactoryResolver {

	defaultHttpClient := &http.Client{
		Timeout:   transportFactory.DefaultTransportTimeout(),
		Transport: transportFactory.RoundTripper(baseTransport, false),
	}
	streamingClient := &http.Client{
		Transport: transportFactory.RoundTripper(baseTransport, true),
	}

	return &DefaultFactoryResolver{
		baseTransport:    baseTransport,
		transportFactory: transportFactory,
		static:           &staticdatasource.Factory{},
		graphql: &graphql_datasource.Factory{
			HTTPClient:      defaultHttpClient,
			StreamingClient: streamingClient,
		},
		log: log,
	}
}

func (d *DefaultFactoryResolver) Resolve(ds *nodev1.DataSourceConfiguration) (plan.PlannerFactory, error) {
	switch ds.Kind {
	case nodev1.DataSourceKind_GRAPHQL:
		factory := &graphql_datasource.Factory{
			HTTPClient:      d.graphql.HTTPClient,
			StreamingClient: d.graphql.StreamingClient,
		}
		return factory, nil
	case nodev1.DataSourceKind_STATIC:
		return d.static, nil
	default:
		return nil, fmt.Errorf("invalid datasource kind %q", ds.Kind)
	}
}

func NewLoader(resolvers ...FactoryResolver) *Loader {
	return &Loader{
		resolvers: resolvers,
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

func (l *Loader) Load(engineConfig *nodev1.EngineConfiguration) (*plan.Configuration, error) {
	var (
		outConfig plan.Configuration
	)

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
		outConfig.Fields = append(outConfig.Fields, plan.FieldConfiguration{
			TypeName:  configuration.TypeName,
			FieldName: configuration.FieldName,
			Arguments: args,
		})
	}

	for _, configuration := range engineConfig.TypeConfigurations {
		outConfig.Types = append(outConfig.Types, plan.TypeConfiguration{
			TypeName: configuration.TypeName,
			RenameTo: configuration.RenameTo,
		})
	}

	for _, in := range engineConfig.DatasourceConfigurations {
		factory, err := l.resolveFactory(in)
		if err != nil {
			return nil, err
		}
		if factory == nil {
			continue
		}
		out := plan.DataSourceConfiguration{
			Factory: factory,
		}
		switch in.Kind {
		case nodev1.DataSourceKind_STATIC:
			out.Custom = staticdatasource.ConfigJSON(staticdatasource.Configuration{
				Data: config.LoadStringVariable(in.CustomStatic.Data),
			})
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

			out.Custom = graphql_datasource.ConfigJson(graphql_datasource.Configuration{
				Fetch: graphql_datasource.FetchConfiguration{
					URL:    fetchUrl,
					Method: in.CustomGraphql.Fetch.Method.String(),
					Header: header,
				},
				Federation: graphql_datasource.FederationConfiguration{
					Enabled:    in.CustomGraphql.Federation.Enabled,
					ServiceSDL: in.CustomGraphql.Federation.ServiceSdl,
				},
				Subscription: graphql_datasource.SubscriptionConfiguration{
					URL:    subscriptionUrl,
					UseSSE: in.CustomGraphql.Subscription.UseSSE,
				},
				UpstreamSchema:         graphqlSchema,
				CustomScalarTypeFields: customScalarTypeFields,
			})
		default:
			continue
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
			out.Directives = append(out.Directives, plan.DirectiveConfiguration{
				DirectiveName: directive.DirectiveName,
				RenameTo:      directive.DirectiveName,
			})
		}
		out.FederationMetaData = plan.FederationMetaData{
			Keys:     nil,
			Requires: nil,
			Provides: nil,
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
		outConfig.DataSources = append(outConfig.DataSources, out)
	}
	return &outConfig, nil
}

func (l *Loader) resolveFactory(ds *nodev1.DataSourceConfiguration) (plan.PlannerFactory, error) {
	for i := range l.resolvers {
		factory, err := l.resolvers[i].Resolve(ds)
		if err != nil {
			return nil, err
		}
		if factory != nil {
			return factory, nil
		}
	}
	return nil, nil
}
