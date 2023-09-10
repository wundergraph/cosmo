package core

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/config"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/staticdatasource"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

type Loader struct {
	resolvers []FactoryResolver
}

type FactoryResolver interface {
	Resolve(ds *nodev1.DataSourceConfiguration) (plan.PlannerFactory, error)
}

type ApiTransportFactory interface {
	RoundTripper(transport *http.Transport, enableStreamingMode bool) http.RoundTripper
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
			BatchFactory:    graphql_datasource.NewBatchFactory(),
		},
		log: log,
	}
}

// requiresDedicatedHTTPClient returns true if the given FetchConfiguration requires a dedicated HTTP client
func (d *DefaultFactoryResolver) requiresDedicatedHTTPClient(ds *nodev1.DataSourceConfiguration, cfg *nodev1.FetchConfiguration) bool {
	// when a custom timeout is specified, we can't use the shared http.Client
	if ds != nil && ds.RequestTimeoutSeconds > 0 {
		return true
	}
	if cfg != nil {
		// when mTLS is enabled, we need to create a new client
		if cfg.Mtls != nil {
			return true
		}
		// if the data source uses a custom proxy, create a dedicated client
		if dataSourceUsesHTTPProxy(ds) {
			_, found := config.LookupStringVariable(cfg.HttpProxyUrl)
			return found
		}
	}
	return false
}

// customTLSTransport returns a TLS *http.Transport with the given key and certificates loaded
func (d *DefaultFactoryResolver) customTLSTransport(mTLS *nodev1.MTLSConfiguration) (*http.Transport, error) {
	privateKey := config.LoadStringVariable(mTLS.Key)
	caCert := config.LoadStringVariable(mTLS.Cert)

	if privateKey == "" || caCert == "" {
		return nil, errors.New("invalid key/cert in mTLS configuration")
	}

	caCertData := []byte(caCert)
	cert, err := tls.X509KeyPair(caCertData, []byte(privateKey))
	if err != nil {
		return nil, fmt.Errorf("unable to build key pair: %w", err)
	}

	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 90 * time.Second,
	}

	// building an empty pool of certificates means no other certificates are allowed
	// even if they are in the system trust store
	caCertPool := x509.NewCertPool()
	caCertPool.AppendCertsFromPEM(caCertData)

	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, addr)
		},
		MaxIdleConns:        1024,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
		TLSClientConfig: &tls.Config{
			Certificates:       []tls.Certificate{cert},
			RootCAs:            caCertPool,
			InsecureSkipVerify: mTLS.InsecureSkipVerify,
		},
	}, nil
}

// newHTTPClient returns a custom http.Client with the given FetchConfiguration applied. Configuration
// should have been previously validated by d.fetchConfigurationRequiresDedicatedHTTPClient()
func (d *DefaultFactoryResolver) newHTTPClient(ds *nodev1.DataSourceConfiguration, cfg *nodev1.FetchConfiguration) (*http.Client, error) {
	// Timeout
	timeout := d.transportFactory.DefaultTransportTimeout()
	if ds != nil && ds.RequestTimeoutSeconds > 0 {
		timeout = time.Duration(ds.RequestTimeoutSeconds) * time.Second
	}
	// TLS
	var transport *http.Transport
	var err error
	if cfg != nil && cfg.Mtls != nil {
		transport, err = d.customTLSTransport(cfg.Mtls)
		if err != nil {
			return nil, err
		}
	} else {
		transport = d.baseTransport.Clone()
	}
	// Proxy
	var proxyURL *url.URL

	if cfg != nil {
		proxyURLString, found := config.LookupStringVariable(cfg.HttpProxyUrl)
		if found {
			if proxyURLString != "" {
				proxyURL, err = url.Parse(proxyURLString)
				if err != nil {
					return nil, fmt.Errorf("invalid proxy URL %q: %w", proxyURLString, err)
				}
				d.log.Debug("using HTTP proxy for data source", zap.String("proxy", proxyURLString), zap.String("url", config.LoadStringVariable(cfg.Url)))
			}
		} else {
			if dataSourceUsesHTTPProxy(ds) {
				proxyURL = d.transportFactory.DefaultHTTPProxyURL()
			}
		}
	}

	if proxyURL != nil {
		transport.Proxy = func(r *http.Request) (*url.URL, error) {
			return proxyURL, nil
		}
	} else {
		if transport.Proxy != nil && dataSourceUsesHTTPProxy(ds) {
			d.log.Debug("disabling global HTTP proxy for data source", zap.String("url", config.LoadStringVariable(cfg.Url)))
		}
		transport.Proxy = nil
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: d.transportFactory.RoundTripper(transport, false),
	}, nil
}

func (d *DefaultFactoryResolver) Resolve(ds *nodev1.DataSourceConfiguration) (plan.PlannerFactory, error) {
	switch ds.Kind {
	case nodev1.DataSourceKind_GRAPHQL:
		factory := &graphql_datasource.Factory{
			HTTPClient:      d.graphql.HTTPClient,
			StreamingClient: d.graphql.StreamingClient,
			BatchFactory:    d.graphql.BatchFactory,
		}

		if d.requiresDedicatedHTTPClient(ds, ds.CustomGraphql.Fetch) {
			client, err := d.newHTTPClient(ds, ds.CustomGraphql.Fetch)
			if err != nil {
				return nil, err
			}
			factory.HTTPClient = client
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

func (l *Loader) Load(engineConfig *nodev1.EngineConfiguration, wgServerUrl string) (*plan.Configuration, error) {
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

			fetchUrl := buildFetchUrl(
				config.LoadStringVariable(in.CustomGraphql.Fetch.GetUrl()),
				config.LoadStringVariable(in.CustomGraphql.Fetch.GetBaseUrl()),
				config.LoadStringVariable(in.CustomGraphql.Fetch.GetPath()),
				wgServerUrl,
			)

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

const serverUrlPlaceholder = "WG_SERVER_URL-"

func buildFetchUrl(url, baseUrl, path string, hooksServerUrl string) string {
	if strings.HasPrefix(url, serverUrlPlaceholder) {
		return fmt.Sprintf("%s/%s", strings.TrimSuffix(hooksServerUrl, "/"), strings.TrimPrefix(path, "/"))
	}

	if url != "" {
		return url
	}

	return fmt.Sprintf("%s/%s", strings.TrimSuffix(baseUrl, "/"), strings.TrimPrefix(path, "/"))
}

func dataSourceUsesHTTPProxy(ds *nodev1.DataSourceConfiguration) bool {
	if ds == nil {
		return false
	}
	switch ds.Kind {
	case nodev1.DataSourceKind_GRAPHQL:
		return true
	case nodev1.DataSourceKind_STATIC:
		return false

	}
	panic("unhandled data source kind")
}
