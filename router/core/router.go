package core

import (
	"context"
	"crypto/ecdsa"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"

	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/nats-io/nuid"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	pubsubNats "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"

	"github.com/redis/go-redis/v9"

	"github.com/wundergraph/cosmo/router/internal/recoveryhandler"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/health"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"

	"connectrpc.com/connect"
	"github.com/golang-jwt/jwt/v5"
	brotli "go.withmatt.com/connect-brotli"

	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/internal/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/internal/debug"
	"github.com/wundergraph/cosmo/router/internal/docker"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	rjwt "github.com/wundergraph/cosmo/router/internal/jwt"

	br "github.com/andybalholm/brotli"
	"github.com/dgraph-io/ristretto"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/mitchellh/mapstructure"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/graphiql"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/stringsx"
)

type IPAnonymizationMethod string

const (
	Hash   IPAnonymizationMethod = "hash"
	Redact IPAnonymizationMethod = "redact"
)

var CustomCompressibleContentTypes = []string{
	"text/html",
	"text/css",
	"text/plain",
	"text/javascript",
	"application/javascript",
	"application/x-javascript",
	"application/json",
	"application/atom+xml",
	"application/rss+xml",
	"image/svg+xml",
	"application/graphql",
}

type (
	// Router is the main application instance.
	Router struct {
		Config
		activeServer   *server
		modules        []Module
		WebsocketStats WebSocketsStatistics
	}

	SubgraphTransportOptions struct {
		RequestTimeout         time.Duration
		ResponseHeaderTimeout  time.Duration
		ExpectContinueTimeout  time.Duration
		KeepAliveIdleTimeout   time.Duration
		DialTimeout            time.Duration
		TLSHandshakeTimeout    time.Duration
		KeepAliveProbeInterval time.Duration
	}

	GraphQLMetricsConfig struct {
		Enabled           bool
		CollectorEndpoint string
	}

	IPAnonymizationConfig struct {
		Enabled bool
		Method  IPAnonymizationMethod
	}

	TlsClientAuthConfig struct {
		Required bool
		CertFile string
	}

	TlsConfig struct {
		Enabled  bool
		CertFile string
		KeyFile  string

		ClientAuth *TlsClientAuthConfig
	}

	EnginePubSubProviders struct {
		nats  map[string]pubsub_datasource.NatsPubSub
		kafka map[string]pubsub_datasource.KafkaPubSub
	}

	// Config defines the configuration options for the Router.
	Config struct {
		clusterName              string
		instanceID               string
		logger                   *zap.Logger
		traceConfig              *rtrace.Config
		metricConfig             *rmetric.Config
		tracerProvider           *sdktrace.TracerProvider
		otlpMeterProvider        *sdkmetric.MeterProvider
		promMeterProvider        *sdkmetric.MeterProvider
		gqlMetricsExporter       graphqlmetrics.SchemaUsageExporter
		corsOptions              *cors.Config
		routerConfig             *nodev1.RouterConfig
		gracePeriod              time.Duration
		awsLambda                bool
		shutdown                 bool
		bootstrapped             bool
		ipAnonymization          *IPAnonymizationConfig
		listenAddr               string
		baseURL                  string
		graphqlWebURL            string
		playgroundPath           string
		graphqlPath              string
		playground               bool
		introspection            bool
		compression              bool
		graphApiToken            string
		healthCheckPath          string
		healthChecks             health.Checker
		readinessCheckPath       string
		livenessCheckPath        string
		cdnConfig                config.CDNConfiguration
		cdnPersistentOpClient    *cdn.PersistentOperationClient
		eventsConfig             config.EventsConfiguration
		prometheusServer         *http.Server
		modulesConfig            map[string]interface{}
		routerMiddlewares        []func(http.Handler) http.Handler
		preOriginHandlers        []TransportPreHandler
		postOriginHandlers       []TransportPostHandler
		headerRuleEngine         *HeaderRuleEngine
		headerRules              config.HeaderRules
		subgraphTransportOptions *SubgraphTransportOptions
		graphqlMetricsConfig     *GraphQLMetricsConfig
		routerTrafficConfig      *config.RouterTrafficConfiguration
		accessController         *AccessController
		retryOptions             retrytransport.RetryOptions
		redisClient              *redis.Client
		processStartTime         time.Time
		developmentMode          bool
		// If connecting to localhost inside Docker fails, fallback to the docker internal address for the host
		localhostFallbackInsideDocker bool

		tlsServerConfig *tls.Config
		tlsConfig       *TlsConfig

		// Poller
		configPoller configpoller.ConfigPoller
		selfRegister selfregister.SelfRegister

		registrationInfo *nodev1.RegistrationInfo

		securityConfiguration config.SecurityConfiguration

		engineExecutionConfiguration config.EngineExecutionConfiguration
		// should be removed once the users have migrated to the new overrides config
		overrideRoutingURLConfiguration config.OverrideRoutingURLConfiguration
		// the new overrides config
		overrides config.OverridesConfiguration

		authorization *config.AuthorizationConfiguration

		rateLimit *config.RateLimitConfiguration

		webSocketConfiguration *config.WebSocketConfiguration

		subgraphErrorPropagation config.SubgraphErrorPropagationConfiguration
	}

	Server interface {
		HttpServer() *http.Server
		HealthChecks() health.Checker
		BaseURL() string
	}

	// server is the main router instance.
	server struct {
		Config
		httpServer      *http.Server
		metricStore     rmetric.Store
		routerConfig    *nodev1.RouterConfig
		healthChecks    health.Checker
		pubSubProviders *EnginePubSubProviders
	}

	// Option defines the method to customize server.
	Option func(svr *Router)
)

func (s *server) BaseURL() string {
	return s.baseURL
}

// NewRouter creates a new Router instance. Router.Start() must be called to start the server.
// Alternatively, use Router.NewServer() to create a new server instance without starting it.
func NewRouter(opts ...Option) (*Router, error) {
	r := &Router{
		WebsocketStats: NewNoopWebSocketStats(),
	}

	for _, opt := range opts {
		opt(r)
	}

	if r.logger == nil {
		r.logger = zap.NewNop()
	}

	// Default value for graphql path
	if r.graphqlPath == "" {
		r.graphqlPath = "/graphql"
	}

	if r.graphqlWebURL == "" {
		r.graphqlWebURL = r.graphqlPath
	}

	if r.playgroundPath == "" {
		r.playgroundPath = "/"
	}

	if r.instanceID == "" {
		r.instanceID = nuid.Next()
	}

	r.processStartTime = time.Now()

	// Create noop tracer and meter to avoid nil pointer panics and to avoid checking for nil everywhere

	r.tracerProvider = sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.NeverSample()))
	r.otlpMeterProvider = sdkmetric.NewMeterProvider()
	r.promMeterProvider = sdkmetric.NewMeterProvider()

	// Default values for trace and metric config

	if r.traceConfig == nil {
		r.traceConfig = rtrace.DefaultConfig(Version)
	}

	if r.metricConfig == nil {
		r.metricConfig = rmetric.DefaultConfig(Version)
	}

	if r.corsOptions == nil {
		r.corsOptions = CorsDefaultOptions()
	}

	if r.subgraphTransportOptions == nil {
		r.subgraphTransportOptions = DefaultSubgraphTransportOptions()
	}

	if r.graphqlMetricsConfig == nil {
		r.graphqlMetricsConfig = DefaultGraphQLMetricsConfig()
	}
	if r.routerTrafficConfig == nil {
		r.routerTrafficConfig = DefaultRouterTrafficConfig()
	}
	if r.accessController == nil {
		r.accessController = DefaultAccessController()
	} else {
		if len(r.accessController.authenticators) == 0 && r.accessController.authenticationRequired {
			r.logger.Warn("authentication is required but no authenticators are configured")
		}
	}

	if r.ipAnonymization == nil {
		r.ipAnonymization = &IPAnonymizationConfig{
			Enabled: true,
			Method:  Redact,
		}
	}

	// Default values for health check paths

	if r.healthCheckPath == "" {
		r.healthCheckPath = "/health"
	}
	if r.readinessCheckPath == "" {
		r.readinessCheckPath = "/health/ready"
	}
	if r.livenessCheckPath == "" {
		r.livenessCheckPath = "/health/live"
	}

	hr, err := NewHeaderTransformer(r.headerRules)
	if err != nil {
		return nil, err
	}

	r.headerRuleEngine = hr

	r.preOriginHandlers = append(r.preOriginHandlers, r.headerRuleEngine.OnOriginRequest)

	defaultHeaders := []string{
		// Common headers
		"authorization",
		"origin",
		"content-length",
		"content-type",
		// Semi standard client info headers
		"graphql-client-name",
		"graphql-client-version",
		// Apollo client info headers
		"apollographql-client-name",
		"apollographql-client-version",
		// Required for WunderGraph ART
		"x-wg-trace",
		"x-wg-token",
		// Required for Trace Context propagation
		"traceparent",
		"tracestate",
	}

	defaultMethods := []string{
		"HEAD", "GET", "POST",
	}
	r.corsOptions.AllowHeaders = stringsx.RemoveDuplicates(append(r.corsOptions.AllowHeaders, defaultHeaders...))
	r.corsOptions.AllowMethods = stringsx.RemoveDuplicates(append(r.corsOptions.AllowMethods, defaultMethods...))

	if r.tlsConfig != nil && r.tlsConfig.Enabled {
		r.baseURL = fmt.Sprintf("https://%s", r.listenAddr)
	} else {
		r.baseURL = fmt.Sprintf("http://%s", r.listenAddr)
	}

	if r.tlsConfig != nil && r.tlsConfig.Enabled {
		if r.tlsConfig.CertFile == "" {
			return nil, errors.New("tls cert file not provided")
		}

		if r.tlsConfig.KeyFile == "" {
			return nil, errors.New("tls key file not provided")
		}

		var caCertPool *x509.CertPool
		clientAuthMode := tls.NoClientCert

		if r.tlsConfig.ClientAuth != nil && r.tlsConfig.ClientAuth.CertFile != "" {
			caCert, err := os.ReadFile(r.tlsConfig.ClientAuth.CertFile)
			if err != nil {
				return nil, fmt.Errorf("failed to read cert file: %w", err)
			}

			// Create a CA an empty cert pool and add the CA cert to it to serve as authority to validate client certs
			caPool := x509.NewCertPool()
			if ok := caPool.AppendCertsFromPEM(caCert); !ok {
				return nil, errors.New("failed to append cert to pool")
			}
			caCertPool = caPool

			if r.tlsConfig.ClientAuth.Required {
				clientAuthMode = tls.RequireAndVerifyClientCert
			} else {
				clientAuthMode = tls.VerifyClientCertIfGiven
			}

			r.logger.Debug("Client auth enabled", zap.String("mode", clientAuthMode.String()))
		}

		// Load the server cert and private key
		cer, err := tls.LoadX509KeyPair(r.tlsConfig.CertFile, r.tlsConfig.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load tls cert and key: %w", err)
		}

		r.tlsServerConfig = &tls.Config{
			ClientCAs:    caCertPool,
			Certificates: []tls.Certificate{cer},
			ClientAuth:   clientAuthMode,
		}
	}

	// Add default tracing exporter if needed
	if r.traceConfig.Enabled && len(r.traceConfig.Exporters) == 0 && r.traceConfig.TestMemoryExporter == nil {
		if endpoint := otelconfig.DefaultEndpoint(); endpoint != "" {
			r.logger.Debug("Using default trace exporter", zap.String("endpoint", endpoint))
			r.traceConfig.Exporters = append(r.traceConfig.Exporters, &rtrace.ExporterConfig{
				Endpoint: endpoint,
				Exporter: otelconfig.ExporterOLTPHTTP,
				HTTPPath: "/v1/traces",
				Headers:  otelconfig.DefaultEndpointHeaders(r.graphApiToken),
			})
		}
	}

	// Add default metric exporter if none are configured
	if r.metricConfig.OpenTelemetry.Enabled && len(r.metricConfig.OpenTelemetry.Exporters) == 0 && r.metricConfig.OpenTelemetry.TestReader == nil {
		if endpoint := otelconfig.DefaultEndpoint(); endpoint != "" {
			r.logger.Debug("Using default metrics exporter", zap.String("endpoint", endpoint))
			r.metricConfig.OpenTelemetry.Exporters = append(r.metricConfig.OpenTelemetry.Exporters, &rmetric.OpenTelemetryExporter{
				Endpoint: endpoint,
				Exporter: otelconfig.ExporterOLTPHTTP,
				HTTPPath: "/v1/metrics",
				Headers:  otelconfig.DefaultEndpointHeaders(r.graphApiToken),
			})
		}
	}

	var disabledFeatures []string

	// The user might want to start the server with a static config
	// Disable all features that requires a valid graph token and inform the user
	if r.graphApiToken == "" {
		r.graphqlMetricsConfig.Enabled = false

		disabledFeatures = append(disabledFeatures, "Schema Usage Tracking", "Persistent operations")

		if !r.developmentMode {
			disabledFeatures = append(disabledFeatures, "Advanced Request Tracing")
		}

		if r.traceConfig.Enabled {
			defaultExporter := rtrace.DefaultExporter(r.traceConfig)
			if defaultExporter != nil {
				disabledFeatures = append(disabledFeatures, "Cosmo Cloud Tracing")
				defaultExporter.Disabled = true
			}
		}
		if r.metricConfig.OpenTelemetry.Enabled {
			defaultExporter := rmetric.GetDefaultExporter(r.metricConfig)
			if defaultExporter != nil {
				disabledFeatures = append(disabledFeatures, "Cosmo Cloud Metrics")
				defaultExporter.Disabled = true
			}
		}

		r.logger.Warn("No graph token provided. The following features are disabled. Not recommended for Production.", zap.Strings("features", disabledFeatures))
	}

	if r.graphApiToken != "" {
		routerCDN, err := cdn.NewPersistentOperationClient(r.cdnConfig.URL, r.graphApiToken, cdn.PersistentOperationsOptions{
			CacheSize: r.cdnConfig.CacheSize.Uint64(),
			Logger:    r.logger,
		})
		if err != nil {
			return nil, err
		}
		r.cdnPersistentOpClient = routerCDN
	}

	if r.developmentMode {
		r.logger.Warn("Development mode enabled. This should only be used for testing purposes")
	}

	for _, source := range r.eventsConfig.Providers.Nats {
		r.logger.Info("Nats Event source enabled", zap.String("providerID", source.ID), zap.String("url", source.URL))
	}
	for _, source := range r.eventsConfig.Providers.Kafka {
		r.logger.Info("Kafka Event source enabled", zap.String("providerID", source.ID), zap.Strings("brokers", source.Brokers))
	}

	return r, nil
}

func (r *Router) configureSubgraphOverwrites(cfg *nodev1.RouterConfig) ([]Subgraph, error) {
	subgraphs := make([]Subgraph, 0, len(cfg.Subgraphs))
	for _, sg := range cfg.Subgraphs {

		subgraph := Subgraph{
			Id:   sg.Id,
			Name: sg.Name,
		}

		// Validate subgraph url. Note that it can be empty if the subgraph is virtual
		parsedURL, err := url.Parse(sg.RoutingUrl)
		if err != nil {
			return nil, fmt.Errorf("failed to parse subgraph url '%s': %w", sg.RoutingUrl, err)
		}

		subgraph.Url = parsedURL

		overrideURL, ok := r.overrideRoutingURLConfiguration.Subgraphs[sg.Name]
		overrideSubgraph, overrideSubgraphOk := r.overrides.Subgraphs[sg.Name]

		var overrideSubscriptionURL string
		var overrideSubscriptionProtocol *common.GraphQLSubscriptionProtocol
		var overrideSubscriptionWebsocketSubprotocol *common.GraphQLWebsocketSubprotocol

		if overrideSubgraphOk {
			if overrideSubgraph.RoutingURL != "" {
				overrideURL = overrideSubgraph.RoutingURL
			}
			if overrideSubgraph.SubscriptionURL != "" {
				overrideSubscriptionURL = overrideSubgraph.SubscriptionURL
				_, err := url.Parse(overrideSubscriptionURL)
				if err != nil {
					return nil, fmt.Errorf("failed to parse override url '%s': %w", overrideSubscriptionURL, err)
				}
			}
			if overrideSubgraph.SubscriptionProtocol != "" {
				switch overrideSubgraph.SubscriptionProtocol {
				case "ws":
					overrideSubscriptionProtocol = common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_WS.Enum()
				case "sse":
					overrideSubscriptionProtocol = common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE.Enum()
				case "sse_post":
					overrideSubscriptionProtocol = common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST.Enum()
				default:
					return nil, fmt.Errorf("invalid subscription protocol '%s'", overrideSubgraph.SubscriptionProtocol)
				}
			}
			if overrideSubgraph.SubscriptionWebsocketSubprotocol != "" {
				switch overrideSubgraph.SubscriptionWebsocketSubprotocol {
				case "graphql-ws":
					overrideSubscriptionWebsocketSubprotocol = common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS.Enum()
				case "graphql-transport-ws":
					overrideSubscriptionWebsocketSubprotocol = common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_TRANSPORT_WS.Enum()
				case "auto":
					overrideSubscriptionWebsocketSubprotocol = common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO.Enum()
				default:
					return nil, fmt.Errorf("invalid subscription websocket subprotocol '%s'", overrideSubgraph.SubscriptionWebsocketSubprotocol)
				}
			}
		}

		// check if the subgraph is overridden
		if ok || overrideSubgraphOk {
			if overrideURL != "" {
				parsedURL, err := url.Parse(overrideURL)
				if err != nil {
					return nil, fmt.Errorf("failed to parse override url '%s': %w", overrideURL, err)
				}

				subgraph.Url = parsedURL
			}

			// Override datasource urls
			for _, conf := range cfg.EngineConfig.DatasourceConfigurations {
				if conf.Id == sg.Id {
					if overrideURL != "" {
						conf.CustomGraphql.Fetch.Url.StaticVariableContent = overrideURL
						sg.RoutingUrl = overrideURL
					}
					if overrideSubscriptionURL != "" {
						conf.CustomGraphql.Subscription.Url.StaticVariableContent = overrideSubscriptionURL
					}
					if overrideSubscriptionProtocol != nil {
						conf.CustomGraphql.Subscription.Protocol = overrideSubscriptionProtocol
					}
					if overrideSubscriptionWebsocketSubprotocol != nil {
						conf.CustomGraphql.Subscription.WebsocketSubprotocol = overrideSubscriptionWebsocketSubprotocol
					}

					break
				}
			}
		}

		subgraphs = append(subgraphs, subgraph)
	}

	return subgraphs, nil
}

// UpdateServer creates a new server and swaps the active server with the new one. The old server is shutdown gracefully.
// When the router can't be swapped due to an error the old server kept running. Not safe for concurrent use.
func (r *Router) UpdateServer(ctx context.Context, cfg *nodev1.RouterConfig) (Server, error) {
	// Rebuild server with new router config
	// In case of an error, we return early and keep the old server running
	newServer, err := r.newServer(ctx, cfg)
	if err != nil {
		r.logger.Error("Failed to create a new router instance. Keeping old router running", zap.Error(err))
		return nil, err
	}

	// Shutdown old server
	if r.activeServer != nil {

		// Respect grace period
		if r.gracePeriod > 0 {
			ctxWithTimer, cancel := context.WithTimeout(ctx, r.gracePeriod)
			defer cancel()

			ctx = ctxWithTimer
		}

		if err := r.activeServer.Shutdown(ctx); err != nil {
			r.logger.Error("Could not shutdown router", zap.Error(err))

			if errors.Is(err, context.DeadlineExceeded) {
				r.logger.Warn(
					"Shutdown deadline exceeded. Router took too long to shutdown. Consider increasing the grace period",
					zap.Duration("grace_period", r.gracePeriod),
				)
			}

			return nil, err
		}
	}

	// Swap active server
	r.activeServer = newServer

	return newServer, nil
}

func (r *Router) updateServerAndStart(ctx context.Context, cfg *nodev1.RouterConfig) error {

	if _, err := r.UpdateServer(ctx, cfg); err != nil {
		return err
	}

	// read here to avoid race condition
	version := r.activeServer.routerConfig.GetVersion()

	// Start new server
	go func() {

		r.logger.Info("Server listening and serving",
			zap.String("listen_addr", r.listenAddr),
			zap.Bool("playground", r.playground),
			zap.Bool("introspection", r.introspection),
			zap.Bool("compression", r.compression),
			zap.String("config_version", cfg.GetVersion()),
		)

		r.activeServer.healthChecks.SetReady(true)

		// This is a blocking call
		if err := r.activeServer.listenAndServe(); err != nil {
			r.activeServer.healthChecks.SetReady(false)
			r.logger.Error("Failed to start new server", zap.Error(err))
		}

		r.logger.Info("Server stopped", zap.String("config_version", version))
	}()

	return nil
}

func (r *Router) initModules(ctx context.Context) error {
	for _, moduleInfo := range modules {
		now := time.Now()

		moduleInstance := moduleInfo.New()

		mc := &ModuleContext{
			Context: ctx,
			Module:  moduleInstance,
			Logger:  r.logger.With(zap.String("module", string(moduleInfo.ID))),
		}

		moduleConfig, ok := r.modulesConfig[string(moduleInfo.ID)]
		if ok {
			if err := mapstructure.Decode(moduleConfig, &moduleInstance); err != nil {
				return fmt.Errorf("failed to decode module config from module %s: %w", moduleInfo.ID, err)
			}
		} else {
			r.logger.Debug("No config found for module", zap.String("id", string(moduleInfo.ID)))
		}

		if fn, ok := moduleInstance.(Provisioner); ok {
			if err := fn.Provision(mc); err != nil {
				return fmt.Errorf("failed to provision module '%s': %w", moduleInfo.ID, err)
			}
		}

		if fn, ok := moduleInstance.(RouterMiddlewareHandler); ok {
			r.routerMiddlewares = append(r.routerMiddlewares, func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					reqContext := getRequestContext(request.Context())
					// Ensure we work with latest request in the chain to work with the right context
					reqContext.request = request
					fn.Middleware(reqContext, handler)
				})
			})
		}

		if handler, ok := moduleInstance.(EnginePreOriginHandler); ok {
			r.preOriginHandlers = append(r.preOriginHandlers, handler.OnOriginRequest)
		}

		if handler, ok := moduleInstance.(EnginePostOriginHandler); ok {
			r.postOriginHandlers = append(r.postOriginHandlers, handler.OnOriginResponse)
		}

		r.modules = append(r.modules, moduleInstance)

		r.logger.Info("Module registered",
			zap.String("id", string(moduleInfo.ID)),
			zap.String("duration", time.Since(now).String()),
		)
	}

	return nil
}

// NewServer prepares a new server instance but does not start it. The method should only be used when you want to bootstrap
// the server manually otherwise you can use Router.Start(). You're responsible for setting health checks status to ready with Server.HealthChecks().
// The server can be shutdown with Router.Shutdown(). Use core.WithStaticRouterConfig to pass the initial config otherwise the Router will
// try to fetch the config from the control plane. You can swap the router config by using Router.UpdateServer().
func (r *Router) NewServer(ctx context.Context) (Server, error) {
	if r.shutdown {
		return nil, fmt.Errorf("router is shutdown. Create a new instance with router.NewRouter()")
	}

	if err := r.bootstrap(ctx); err != nil {
		return nil, fmt.Errorf("failed to bootstrap application: %w", err)
	}

	// Start the server with the static config without polling
	if r.routerConfig != nil {
		r.logger.Info("Static router config provided. Polling is disabled. Updating router config is only possible by providing a config.")
		return r.UpdateServer(ctx, r.routerConfig)
	}

	// when no static config is provided and no poller is configured, we can't start the server
	if r.configPoller == nil {
		return nil, fmt.Errorf("config fetcher not provided. Please provide a static router config instead")
	}

	routerConfig, err := r.configPoller.GetRouterConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get initial router config: %w", err)
	}

	if _, err := r.UpdateServer(ctx, routerConfig); err != nil {
		r.logger.Error("Failed to start server with initial config", zap.Error(err))
		return nil, err
	}

	return r.activeServer, nil
}

// bootstrap initializes the Router. It is called by Start() and NewServer().
// It should only be called once for a Router instance. Not safe for concurrent use.
func (r *Router) bootstrap(ctx context.Context) error {
	if r.bootstrapped {
		return fmt.Errorf("router is already bootstrapped")
	}

	r.bootstrapped = true

	cosmoCloudTracingEnabled := r.traceConfig.Enabled && rtrace.DefaultExporter(r.traceConfig) != nil
	artInProductionEnabled := r.engineExecutionConfiguration.EnableRequestTracing && !r.developmentMode
	needsRegistration := cosmoCloudTracingEnabled || artInProductionEnabled

	if needsRegistration && r.selfRegister != nil {

		r.logger.Info("Registering router with control plane because you opted in to send telemetry to Cosmo Cloud or advanced request tracing (ART) in production")

		ri, registerErr := r.selfRegister.Register(ctx)
		if registerErr != nil {
			r.logger.Warn("Failed to register router on the control plane. If this warning persists, please contact support.")
		} else {
			r.registrationInfo = ri

			// Only ensure sampling rate if the user exports traces to Cosmo Cloud
			if cosmoCloudTracingEnabled {
				if r.traceConfig.Sampler > float64(r.registrationInfo.AccountLimits.TraceSamplingRate) {
					r.logger.Warn("Trace sampling rate is higher than account limit. Using account limit instead. Please contact support to increase your account limit.",
						zap.Float64("limit", r.traceConfig.Sampler),
						zap.String("account_limit", fmt.Sprintf("%.2f", r.registrationInfo.AccountLimits.TraceSamplingRate)),
					)
					r.traceConfig.Sampler = float64(r.registrationInfo.AccountLimits.TraceSamplingRate)
				}
			}
		}
	}

	if r.traceConfig.Enabled {
		tp, err := rtrace.NewTracerProvider(ctx, &rtrace.ProviderConfig{
			Logger:            r.logger,
			Config:            r.traceConfig,
			ServiceInstanceID: r.instanceID,
			IPAnonymization: &rtrace.IPAnonymizationConfig{
				Enabled: r.ipAnonymization.Enabled,
				Method:  rtrace.IPAnonymizationMethod(r.ipAnonymization.Method),
			},
			MemoryExporter: r.traceConfig.TestMemoryExporter,
		})
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		r.tracerProvider = tp
	}

	// Prometheus metrics rely on OTLP metrics
	if r.metricConfig.IsEnabled() {
		if r.metricConfig.Prometheus.Enabled {
			mp, registry, err := rmetric.NewPrometheusMeterProvider(ctx, r.metricConfig, r.instanceID)
			if err != nil {
				return fmt.Errorf("failed to create Prometheus exporter: %w", err)
			}
			r.promMeterProvider = mp

			r.prometheusServer = rmetric.NewPrometheusServer(r.logger, r.metricConfig.Prometheus.ListenAddr, r.metricConfig.Prometheus.Path, registry)
			go func() {
				if err := r.prometheusServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
					r.logger.Error("Failed to start Prometheus server", zap.Error(err))
				}
			}()
		}

		if r.metricConfig.OpenTelemetry.Enabled {
			mp, err := rmetric.NewOtlpMeterProvider(ctx, r.logger, r.metricConfig, r.instanceID)
			if err != nil {
				return fmt.Errorf("failed to start trace agent: %w", err)
			}
			r.otlpMeterProvider = mp
		}

	}

	r.gqlMetricsExporter = graphqlmetrics.NewNoopExporter()

	if r.graphqlMetricsConfig.Enabled {
		client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
			http.DefaultClient,
			r.graphqlMetricsConfig.CollectorEndpoint,
			brotli.WithCompression(),
			// Compress requests with Brotli.
			connect.WithSendCompression(brotli.Name),
		)
		ge, err := graphqlmetrics.NewExporter(
			r.logger,
			client,
			r.graphApiToken,
			graphqlmetrics.NewDefaultExporterSettings(),
		)
		if err != nil {
			return fmt.Errorf("failed to validate graphql metrics exporter: %w", err)
		}
		r.gqlMetricsExporter = ge

		r.logger.Info("GraphQL schema coverage metrics enabled")
	}

	if r.Config.rateLimit != nil && r.Config.rateLimit.Enabled {
		options, err := redis.ParseURL(r.Config.rateLimit.Storage.Url)
		if err != nil {
			return fmt.Errorf("failed to parse the redis connection url: %w", err)
		}

		r.redisClient = redis.NewClient(options)
	}

	if r.engineExecutionConfiguration.Debug.ReportWebSocketConnections {
		r.WebsocketStats = NewWebSocketStats(ctx, r.logger)
	}

	if r.engineExecutionConfiguration.Debug.ReportMemoryUsage {
		debug.ReportMemoryUsage(ctx, r.logger)
	}

	// Modules are only initialized once and not on every config change
	if err := r.initModules(ctx); err != nil {
		return fmt.Errorf("failed to init user modules: %w", err)
	}

	return nil
}

// Start starts the server. It does not block. The server can be shutdown with Router.Shutdown().
// Not safe for concurrent use.
func (r *Router) Start(ctx context.Context) error {
	if r.shutdown {
		return fmt.Errorf("router is shutdown. Create a new instance with router.NewRouter()")
	}

	if err := r.bootstrap(ctx); err != nil {
		return fmt.Errorf("failed to bootstrap application: %w", err)
	}

	// Start the server with the static config without polling
	if r.routerConfig != nil {
		r.logger.Info("Static router config provided. Polling is disabled. Updating router config is only possible by providing a config.")
		return r.updateServerAndStart(ctx, r.routerConfig)
	}

	// when no static config is provided and no poller is configured, we can't start the server
	if r.configPoller == nil {
		return fmt.Errorf("config fetcher not provided. Please provide a static router config instead")
	}

	routerConfig, err := r.configPoller.GetRouterConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to get initial router config: %w", err)
	}

	if err := r.updateServerAndStart(ctx, routerConfig); err != nil {
		r.logger.Error("Failed to start server with initial config", zap.Error(err))
		return err
	}

	r.logger.Info("Polling for router config updates in the background")

	r.configPoller.Subscribe(ctx, func(newConfig *nodev1.RouterConfig, oldVersion string) error {
		r.logger.Info("Router execution config has changed, upgrading server",
			zap.String("old_version", oldVersion),
			zap.String("new_version", newConfig.GetVersion()),
		)
		if err := r.updateServerAndStart(ctx, newConfig); err != nil {
			r.logger.Error("Failed to start server with new config. Trying again on the next update cycle.", zap.Error(err))
			return err
		}
		return nil
	})

	return nil
}

func (r *Router) buildPubSubConfiguration(ctx context.Context, routerCfg *nodev1.RouterConfig, routerEngineCfg *RouterEngineConfiguration) (*EnginePubSubProviders, error) {

	natsPubSubByProviderID := make(map[string]pubsub_datasource.NatsPubSub)
	kafkaPubSubByProviderID := make(map[string]pubsub_datasource.KafkaPubSub)

	datasourceConfigurations := routerCfg.EngineConfig.GetDatasourceConfigurations()
	for _, datasourceConfiguration := range datasourceConfigurations {
		if datasourceConfiguration.CustomEvents == nil {
			continue
		}

		for _, eventConfiguration := range datasourceConfiguration.GetCustomEvents().GetNats() {

			providerID := eventConfiguration.EngineEventConfiguration.GetProviderId()
			// if this source name's provider has already been initiated, do not try to initiate again
			_, ok := natsPubSubByProviderID[providerID]
			if ok {
				continue
			}

			for _, eventSource := range routerEngineCfg.Events.Providers.Nats {
				if eventSource.ID == eventConfiguration.EngineEventConfiguration.GetProviderId() {
					options, err := buildNatsOptions(eventSource, r.logger)
					if err != nil {
						return nil, fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", providerID, err)
					}
					natsConnection, err := nats.Connect(eventSource.URL, options...)
					if err != nil {
						return nil, fmt.Errorf("failed to create connection for Nats provider with ID \"%s\": %w", providerID, err)
					}
					js, err := jetstream.New(natsConnection)
					if err != nil {
						return nil, err
					}

					natsPubSubByProviderID[providerID] = pubsubNats.NewConnector(r.logger, natsConnection, js).New(ctx)

					break
				}
			}
		}

		for _, eventConfiguration := range datasourceConfiguration.GetCustomEvents().GetKafka() {

			providerID := eventConfiguration.EngineEventConfiguration.GetProviderId()
			// if this source name's provider has already been initiated, do not try to initiate again
			_, ok := kafkaPubSubByProviderID[providerID]
			if ok {
				continue
			}

			for _, eventSource := range routerEngineCfg.Events.Providers.Kafka {

				if eventSource.ID == providerID {
					options, err := buildKafkaOptions(eventSource)
					if err != nil {
						return nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", providerID, err)
					}
					ps, err := kafka.NewConnector(r.logger, options)
					if err != nil {
						return nil, fmt.Errorf("failed to create connection for Kafka provider with ID \"%s\": %w", providerID, err)
					}

					kafkaPubSubByProviderID[providerID] = ps.New(ctx)

					break
				}
			}
		}

	}

	return &EnginePubSubProviders{
		nats:  natsPubSubByProviderID,
		kafka: kafkaPubSubByProviderID,
	}, nil
}

// newServer creates a new server instance.
// All stateful data is copied from the Router over to the new server instance. Not safe for concurrent use.
func (r *Router) newServer(ctx context.Context, routerConfig *nodev1.RouterConfig) (*server, error) {
	subgraphs, err := r.configureSubgraphOverwrites(routerConfig)
	if err != nil {
		return nil, err
	}

	ro := &server{
		routerConfig: routerConfig,
		Config:       r.Config,
		metricStore:  rmetric.NewNoopMetrics(),
	}

	baseAttributes := []attribute.KeyValue{
		otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
		otel.WgRouterVersion.String(Version),
		otel.WgRouterClusterName.String(r.clusterName),
	}

	if r.graphApiToken != "" {
		claims, err := rjwt.ExtractFederatedGraphTokenClaims(r.graphApiToken)
		if err != nil {
			return nil, err
		}
		baseAttributes = append(baseAttributes, otel.WgFederatedGraphID.String(claims.FederatedGraphID))
	}

	recoveryHandler := recoveryhandler.New(recoveryhandler.WithLogger(r.logger), recoveryhandler.WithPrintStack())
	var traceHandler *rtrace.Middleware
	if r.traceConfig.Enabled {
		spanStartOptions := []oteltrace.SpanStartOption{
			oteltrace.WithAttributes(baseAttributes...),
			oteltrace.WithAttributes(
				otel.RouterServerAttribute,
				otel.WgRouterRootSpan.Bool(true),
			),
		}

		if r.traceConfig.WithNewRoot {
			spanStartOptions = append(spanStartOptions, oteltrace.WithNewRoot())
		}

		traceHandler = rtrace.NewMiddleware(
			r.traceConfig.SpanAttributesMapper,
			otelhttp.WithSpanOptions(spanStartOptions...),
			otelhttp.WithFilter(rtrace.CommonRequestFilter),
			otelhttp.WithFilter(rtrace.PrefixRequestFilter(
				[]string{r.healthCheckPath, r.readinessCheckPath, r.livenessCheckPath}),
			),
			// Disable built-in metricStore through NoopMeterProvider
			otelhttp.WithMeterProvider(sdkmetric.NewMeterProvider()),
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
			otelhttp.WithTracerProvider(r.tracerProvider),
		)
	}

	// Request logger
	requestLoggerOpts := []requestlogger.Option{
		requestlogger.WithDefaultOptions(),
		requestlogger.WithNoTimeField(),
		requestlogger.WithContext(func(request *http.Request) []zapcore.Field {
			return []zapcore.Field{
				zap.String("config_version", routerConfig.GetVersion()),
				zap.String("request_id", middleware.GetReqID(request.Context())),
			}
		}),
	}

	if r.ipAnonymization.Enabled {
		requestLoggerOpts = append(requestLoggerOpts, requestlogger.WithAnonymization(&requestlogger.IPAnonymizationConfig{
			Enabled: r.ipAnonymization.Enabled,
			Method:  requestlogger.IPAnonymizationMethod(r.ipAnonymization.Method),
		}))
	}

	requestLogger := requestlogger.New(
		r.logger,
		requestLoggerOpts...,
	)

	httpRouter := chi.NewRouter()
	httpRouter.Use(recoveryHandler)
	httpRouter.Use(middleware.RequestSize(int64(r.routerTrafficConfig.MaxRequestBodyBytes)))
	
	if(r.compression) {

		httpRouter.Use(middleware.Compress(5, CustomCompressibleContentTypes...))

		brCompressor := middleware.NewCompressor(5, CustomCompressibleContentTypes...)
		brCompressor.SetEncoder("br", func(w io.Writer, level int) io.Writer {
			return br.NewWriterLevel(w, level)
		})
		httpRouter.Use(brCompressor.Handler)
	}

	httpRouter.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(withSubgraphs(r.Context(), subgraphs))
			h.ServeHTTP(w, r)
		})
	})

	httpRouter.Use(middleware.RequestID)
	httpRouter.Use(middleware.RealIP)

	// Register the trace middleware before the request logger, so we can log the trace ID
	if traceHandler != nil {
		httpRouter.Use(traceHandler.Handler)
	}
	httpRouter.Use(requestLogger)
	httpRouter.Use(cors.New(*r.corsOptions))

	if r.healthChecks != nil {
		ro.healthChecks = r.healthChecks
	} else {
		ro.healthChecks = health.New(&health.Options{
			Logger: r.logger,
		})
	}

	httpRouter.Get(r.healthCheckPath, ro.healthChecks.Liveness())
	httpRouter.Get(r.livenessCheckPath, ro.healthChecks.Liveness())
	httpRouter.Get(r.readinessCheckPath, ro.healthChecks.Readiness())

	var (
		planCache ExecutionPlanCache
	)

	// when an execution plan was generated, which can be quite expensive, we want to cache it
	// this means that we can hash the input and cache the generated plan
	// the next time we get the same input, we can just return the cached plan
	// the engine is smart enough to first do normalization and then hash the input
	// this means that we can cache the normalized input and don't have to worry about
	// different inputs that would generate the same execution plan
	if r.engineExecutionConfiguration.ExecutionPlanCacheSize > 0 {
		planCacheConfig := &ristretto.Config{
			MaxCost:     r.engineExecutionConfiguration.ExecutionPlanCacheSize,
			NumCounters: r.engineExecutionConfiguration.ExecutionPlanCacheSize * 10,
			BufferItems: 64,
		}
		planCache, err = ristretto.NewCache(planCacheConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to create planner cache: %w", err)
		}
	} else {
		planCache = NewNoopExecutionPlanCache()
	}

	if r.localhostFallbackInsideDocker && docker.Inside() {
		r.logger.Info("localhost fallback enabled, connections that fail to connect to localhost will be retried using host.docker.internal")
	}

	// Prometheus metricStore rely on OTLP metricStore
	if r.metricConfig.IsEnabled() {
		m, err := rmetric.NewStore(
			rmetric.WithPromMeterProvider(r.promMeterProvider),
			rmetric.WithOtlpMeterProvider(r.otlpMeterProvider),
			rmetric.WithLogger(r.logger),
			rmetric.WithProcessStartTime(r.processStartTime),
			rmetric.WithRouterRuntimeMetrics(r.metricConfig.OpenTelemetry.RouterRuntime),
			rmetric.WithAttributes(baseAttributes...),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create metric handler: %w", err)
		}

		ro.metricStore = m
	}

	routerMetrics := NewRouterMetrics(&routerMetricsConfig{
		metrics:             ro.metricStore,
		gqlMetricsExporter:  r.gqlMetricsExporter,
		exportEnabled:       r.graphqlMetricsConfig.Enabled,
		routerConfigVersion: routerConfig.GetVersion(),
		logger:              r.logger,
	})

	transport := newHTTPTransport(r.subgraphTransportOptions)

	ecb := &ExecutorConfigurationBuilder{
		introspection: r.introspection,
		baseURL:       r.baseURL,
		transport:     transport,
		logger:        r.logger,
		includeInfo:   r.graphqlMetricsConfig.Enabled,
		transportOptions: &TransportOptions{
			RequestTimeout: r.subgraphTransportOptions.RequestTimeout,
			PreHandlers:    r.preOriginHandlers,
			PostHandlers:   r.postOriginHandlers,
			MetricStore:    ro.metricStore,
			RetryOptions: retrytransport.RetryOptions{
				Enabled:       r.retryOptions.Enabled,
				MaxRetryCount: r.retryOptions.MaxRetryCount,
				MaxDuration:   r.retryOptions.MaxDuration,
				Interval:      r.retryOptions.Interval,
				ShouldRetry: func(err error, req *http.Request, resp *http.Response) bool {
					return retrytransport.IsRetryableError(err, resp) && !isMutationRequest(req.Context())
				},
			},
			TracerProvider:                r.tracerProvider,
			AttributesMapper:              r.traceConfig.SpanAttributesMapper,
			LocalhostFallbackInsideDocker: r.localhostFallbackInsideDocker,
			Logger:                        r.logger,
		},
	}

	routerEngineConfig := &RouterEngineConfiguration{
		Execution:                r.engineExecutionConfiguration,
		Headers:                  r.headerRules,
		Events:                   r.eventsConfig,
		SubgraphErrorPropagation: r.subgraphErrorPropagation,
	}

	if r.developmentMode && r.engineExecutionConfiguration.EnableRequestTracing && r.graphApiToken == "" {
		r.logger.Warn("Advanced Request Tracing (ART) is enabled in development mode but requires a graph token to work in production. For more information see https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art")
	}

	pubSubProviders, err := r.buildPubSubConfiguration(ctx, routerConfig, routerEngineConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to build pubsub configuration: %w", err)
	}
	ro.pubSubProviders = pubSubProviders

	executor, err := ecb.Build(ctx, routerConfig, routerEngineConfig, pubSubProviders, r.WebsocketStats)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	operationParser := NewOperationParser(OperationParserOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: int64(r.routerTrafficConfig.MaxRequestBodyBytes),
		PersistentOpClient:      r.cdnPersistentOpClient,
	})
	operationPlanner := NewOperationPlanner(executor, planCache)

	var graphqlPlaygroundHandler func(http.Handler) http.Handler

	if r.playground {
		playgroundUrl, err := url.JoinPath(r.baseURL, r.playgroundPath)
		if err != nil {
			return nil, fmt.Errorf("failed to join playground url: %w", err)
		}
		r.logger.Info("Serving GraphQL playground", zap.String("url", playgroundUrl))
		graphqlPlaygroundHandler = graphiql.NewPlayground(&graphiql.PlaygroundOptions{
			Log:        r.logger,
			Html:       graphiql.PlaygroundHTML(),
			GraphqlURL: r.graphqlWebURL,
		})
	}

	authorizerOptions := &CosmoAuthorizerOptions{
		FieldConfigurations:           routerConfig.EngineConfig.FieldConfigurations,
		RejectOperationIfUnauthorized: false,
	}

	if r.Config.authorization != nil {
		authorizerOptions.RejectOperationIfUnauthorized = r.Config.authorization.RejectOperationIfUnauthorized
	}

	handlerOpts := HandlerOptions{
		Executor:                               executor,
		Log:                                    r.logger,
		EnableExecutionPlanCacheResponseHeader: routerEngineConfig.Execution.EnableExecutionPlanCacheResponseHeader,
		WebSocketStats:                         r.WebsocketStats,
		TracerProvider:                         r.tracerProvider,
		Authorizer:                             NewCosmoAuthorizer(authorizerOptions),
		SubgraphErrorPropagation:               r.subgraphErrorPropagation,
		EngineLoaderHooks:                      NewEngineRequestHooks(ro.metricStore, r.traceConfig.SpanAttributesMapper),
		SpanAttributesMapper:                   r.traceConfig.SpanAttributesMapper,
	}

	if r.Config.redisClient != nil {
		handlerOpts.RateLimitConfig = r.Config.rateLimit
		handlerOpts.RateLimiter = NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			RedisClient: r.Config.redisClient,
			Debug:       r.Config.rateLimit.Debug,
		})
		r.logger.Info("Rate limiting enabled",
			zap.Int("rate", r.Config.rateLimit.SimpleStrategy.Rate),
			zap.Int("burst", r.Config.rateLimit.SimpleStrategy.Burst),
			zap.Duration("duration", r.Config.rateLimit.SimpleStrategy.Period),
			zap.Bool("rejectExceeding", r.Config.rateLimit.SimpleStrategy.RejectExceedingRequests),
		)
	} else {
		r.logger.Info("Rate limiting disabled")
	}

	graphqlHandler := NewGraphQLHandler(handlerOpts)
	executor.Resolver.SetAsyncErrorWriter(graphqlHandler)

	var publicKey *ecdsa.PublicKey

	if r.registrationInfo != nil {
		publicKey, err = jwt.ParseECPublicKeyFromPEM([]byte(r.registrationInfo.GetGraphPublicKey()))
		if err != nil {
			return nil, fmt.Errorf("failed to parse router public key: %w", err)
		}
	}

	operationBlocker := NewOperationBlocker(&OperationBlockerOptions{
		BlockMutations:     r.securityConfiguration.BlockMutations,
		BlockSubscriptions: r.securityConfiguration.BlockSubscriptions,
		BlockNonPersisted:  r.securityConfiguration.BlockNonPersistedOperations,
	})

	graphqlPreHandler := NewPreHandler(&PreHandlerOptions{
		Logger:                      r.logger,
		Executor:                    executor,
		Metrics:                     routerMetrics,
		OperationProcessor:          operationParser,
		Planner:                     operationPlanner,
		AccessController:            r.accessController,
		OperationBlocker:            operationBlocker,
		RouterPublicKey:             publicKey,
		EnableRequestTracing:        r.engineExecutionConfiguration.EnableRequestTracing,
		DevelopmentMode:             r.developmentMode,
		TracerProvider:              r.tracerProvider,
		FlushTelemetryAfterResponse: r.awsLambda,
		TraceExportVariables:        r.traceConfig.ExportGraphQLVariables.Enabled,
		SpanAttributesMapper:        r.traceConfig.SpanAttributesMapper,
	})

	graphqlChiRouter := chi.NewRouter()

	if r.webSocketConfiguration != nil && r.webSocketConfiguration.Enabled {
		wsMiddleware := NewWebsocketMiddleware(ctx, WebsocketMiddlewareOptions{
			OperationProcessor:         operationParser,
			OperationBlocker:           operationBlocker,
			Planner:                    operationPlanner,
			GraphQLHandler:             graphqlHandler,
			Metrics:                    routerMetrics,
			AccessController:           r.accessController,
			Logger:                     r.logger,
			Stats:                      r.WebsocketStats,
			ReadTimeout:                r.engineExecutionConfiguration.WebSocketReadTimeout,
			EnableWebSocketEpollKqueue: r.engineExecutionConfiguration.EnableWebSocketEpollKqueue,
			EpollKqueuePollTimeout:     r.engineExecutionConfiguration.EpollKqueuePollTimeout,
			EpollKqueueConnBufferSize:  r.engineExecutionConfiguration.EpollKqueueConnBufferSize,
			WebSocketConfiguration:     r.webSocketConfiguration,
		})
		// When the playground path is equal to the graphql path, we need to handle
		// ws upgrades and html requests on the same route.
		if r.playground && r.graphqlPath == r.playgroundPath {
			graphqlChiRouter.Use(graphqlPlaygroundHandler, wsMiddleware)
		} else {
			if r.playground {
				httpRouter.Get(r.playgroundPath, graphqlPlaygroundHandler(nil).ServeHTTP)
			}
			graphqlChiRouter.Use(wsMiddleware)
		}
	} else {
		if r.playground {
			httpRouter.Get(r.playgroundPath, graphqlPlaygroundHandler(nil).ServeHTTP)
		}
	}

	graphqlChiRouter.Use(graphqlPreHandler.Handler)

	// Built in and custom modules
	graphqlChiRouter.Use(r.routerMiddlewares...)

	graphqlChiRouter.Post("/", graphqlHandler.ServeHTTP)

	// Serve GraphQL. MetricStore are collected after the request is handled and classified as a GraphQL request.
	httpRouter.Mount(r.graphqlPath, graphqlChiRouter)

	if r.webSocketConfiguration != nil && r.webSocketConfiguration.Enabled && r.webSocketConfiguration.AbsintheProtocol.Enabled {
		// Mount the Absinthe protocol handler for WebSockets
		httpRouter.Mount(r.webSocketConfiguration.AbsintheProtocol.HandlerPath, graphqlChiRouter)
	}

	graphqlEndpointURL, err := url.JoinPath(r.baseURL, r.graphqlPath)
	if err != nil {
		return nil, fmt.Errorf("failed to join graphql endpoint url: %w", err)
	}

	r.logger.Info("GraphQL endpoint",
		zap.String("method", http.MethodPost),
		zap.String("url", graphqlEndpointURL),
	)

	ro.httpServer = &http.Server{
		Addr: r.listenAddr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		Handler:           httpRouter,
		ErrorLog:          zap.NewStdLog(r.logger),
		TLSConfig:         r.tlsServerConfig,
	}

	return ro, nil
}

// listenAndServe starts the server and blocks until the server is shutdown.
func (s *server) listenAndServe() error {
	if s.tlsConfig != nil && s.tlsConfig.Enabled {
		// Leave the cert and key empty to use the default ones
		if err := s.httpServer.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	} else {
		if err := s.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	return nil
}

// Shutdown gracefully shuts down the router. It blocks until the server is shutdown.
// If the router is already shutdown, the method returns immediately without error. Not safe for concurrent use.
func (r *Router) Shutdown(ctx context.Context) (err error) {

	if r.shutdown {
		return nil
	}

	r.shutdown = true

	if r.configPoller != nil {
		if subErr := r.configPoller.Stop(ctx); subErr != nil {
			err = errors.Join(err, fmt.Errorf("failed to stop config poller: %w", subErr))
		}
	}

	if r.activeServer != nil {
		if subErr := r.activeServer.Shutdown(ctx); subErr != nil {
			err = errors.Join(err, fmt.Errorf("failed to shutdown primary server: %w", subErr))
		}
	}

	var wg sync.WaitGroup

	if r.prometheusServer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if subErr := r.prometheusServer.Close(); subErr != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown prometheus server: %w", subErr))
			}
		}()
	}

	if r.tracerProvider != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.tracerProvider.Shutdown(ctx); subErr != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown tracer: %w", subErr))
			}
		}()
	}

	if r.gqlMetricsExporter != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.gqlMetricsExporter.Shutdown(ctx); subErr != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown graphql metrics exporter: %w", subErr))
			}
		}()
	}

	if r.promMeterProvider != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.promMeterProvider.Shutdown(ctx); subErr != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown prometheus meter provider: %w", subErr))
			}
		}()
	}

	if r.otlpMeterProvider != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.otlpMeterProvider.Shutdown(ctx); subErr != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown OTLP meter provider: %w", subErr))
			}
		}()
	}

	if r.redisClient != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.redisClient.FlushAll(ctx); subErr.Err() != nil {
				err = errors.Join(err, fmt.Errorf("failed to flush redis client: %w", subErr.Err()))
			}
			if closeErr := r.redisClient.Close(); closeErr != nil {
				err = errors.Join(err, fmt.Errorf("failed to close redis client: %w", closeErr))
			}
		}()
	}

	wg.Add(1)
	go func() {
		defer wg.Done()

		for _, module := range r.modules {
			if cleaner, ok := module.(Cleaner); ok {
				if subErr := cleaner.Cleanup(); subErr != nil {
					err = errors.Join(err, fmt.Errorf("failed to clean module %s: %w", module.Module().ID, subErr))
				}
			}
		}
	}()

	wg.Wait()

	return err
}

// Shutdown gracefully shutdown the server.
func (s *server) Shutdown(ctx context.Context) error {

	s.healthChecks.SetReady(false)

	s.logger.Info("Gracefully shutting down the router ...",
		zap.String("config_version", s.routerConfig.GetVersion()),
		zap.String("grace_period", s.gracePeriod.String()),
	)

	var finalErr error

	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			s.logger.Error("Failed to shutdown HTTP server", zap.Error(err))
			finalErr = errors.Join(finalErr, err)
		}
	}

	if err := s.metricStore.Flush(ctx); err != nil {
		s.logger.Error("Failed to flush metric store", zap.Error(err))
		finalErr = errors.Join(finalErr, err)
	}

	if s.pubSubProviders != nil {

		s.logger.Debug("Shutting down pubsub providers")

		for _, pubSub := range s.pubSubProviders.nats {
			if p, ok := pubSub.(pubsub.Lifecycle); ok {
				if err := p.Shutdown(ctx); err != nil {
					s.logger.Error("Failed to shutdown Nats pubsub provider", zap.Error(err))
					finalErr = errors.Join(finalErr, err)
				}
			}
		}
		for _, pubSub := range s.pubSubProviders.kafka {
			if p, ok := pubSub.(pubsub.Lifecycle); ok {
				if err := p.Shutdown(ctx); err != nil {
					s.logger.Error("Failed to shutdown Kafka pubsub provider", zap.Error(err))
					finalErr = errors.Join(finalErr, err)
				}
			}
		}
	}

	return finalErr
}

func (s *server) HealthChecks() health.Checker {
	return s.healthChecks
}

func (s *server) HttpServer() *http.Server {
	return s.httpServer
}

func WithListenerAddr(addr string) Option {
	return func(r *Router) {
		r.listenAddr = addr
	}
}

func WithLogger(logger *zap.Logger) Option {
	return func(r *Router) {
		r.logger = logger
	}
}

func WithPlayground(enable bool) Option {
	return func(r *Router) {
		r.playground = enable
	}
}

func WithIntrospection(enable bool) Option {
	return func(r *Router) {
		r.introspection = enable
	}
}

func WithCompression(enable bool) Option {
	return func(r *Router) {
		r.compression = enable
	}
}

func WithTracing(cfg *rtrace.Config) Option {
	return func(r *Router) {
		r.traceConfig = cfg
	}
}

func WithCors(corsOpts *cors.Config) Option {
	return func(r *Router) {
		r.corsOptions = corsOpts
	}
}

// WithGraphQLPath sets the path where the GraphQL endpoint is served.
func WithGraphQLPath(p string) Option {
	return func(r *Router) {
		r.graphqlPath = p
	}
}

// WithGraphQLWebURL sets the URL to the GraphQL endpoint used by the GraphQL Playground.
// This is useful when the path differs from the actual GraphQL endpoint e.g. when the router is behind a reverse proxy.
// If not set, the GraphQL Playground uses the same URL as the GraphQL endpoint.
func WithGraphQLWebURL(p string) Option {
	return func(r *Router) {
		r.graphqlWebURL = p
	}
}

// WithPlaygroundPath sets the path where the GraphQL Playground is served.
func WithPlaygroundPath(p string) Option {
	return func(r *Router) {
		r.playgroundPath = p
	}
}

func WithConfigPoller(cf configpoller.ConfigPoller) Option {
	return func(r *Router) {
		r.configPoller = cf
	}
}

func WithSelfRegistration(sr selfregister.SelfRegister) Option {
	return func(r *Router) {
		r.selfRegister = sr
	}
}

func WithGracePeriod(timeout time.Duration) Option {
	return func(r *Router) {
		r.gracePeriod = timeout
	}
}

func WithMetrics(cfg *rmetric.Config) Option {
	return func(r *Router) {
		r.metricConfig = cfg
	}
}

// CorsDefaultOptions returns the default CORS options for the rs/cors package.
func CorsDefaultOptions() *cors.Config {
	return &cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{
			http.MethodHead,
			http.MethodGet,
			http.MethodPost,
		},
		AllowHeaders:     []string{},
		AllowCredentials: false,
	}
}

func WithGraphApiToken(token string) Option {
	return func(r *Router) {
		r.graphApiToken = token
	}
}

func WithModulesConfig(config map[string]interface{}) Option {
	return func(r *Router) {
		r.modulesConfig = config
	}
}

func WithStaticRouterConfig(cfg *nodev1.RouterConfig) Option {
	return func(r *Router) {
		r.routerConfig = cfg
	}
}

// WithAwsLambdaRuntime enables the AWS Lambda behaviour.
// This flushes all telemetry data synchronously after the request is handled.
func WithAwsLambdaRuntime() Option {
	return func(r *Router) {
		r.awsLambda = true
	}
}

func WithHealthCheckPath(path string) Option {
	return func(r *Router) {
		r.healthCheckPath = path
	}
}

func WithHealthChecks(healthChecks health.Checker) Option {
	return func(r *Router) {
		r.healthChecks = healthChecks
	}
}

func WithReadinessCheckPath(path string) Option {
	return func(r *Router) {
		r.readinessCheckPath = path
	}
}

func WithLivenessCheckPath(path string) Option {
	return func(r *Router) {
		r.livenessCheckPath = path
	}
}

// WithCDN sets the configuration for the CDN client
func WithCDN(cfg config.CDNConfiguration) Option {
	return func(r *Router) {
		r.cdnConfig = cfg
	}
}

// WithEvents sets the configuration for the events client
func WithEvents(cfg config.EventsConfiguration) Option {
	return func(r *Router) {
		r.eventsConfig = cfg
	}
}

func WithHeaderRules(headers config.HeaderRules) Option {
	return func(r *Router) {
		r.headerRules = headers
	}
}

func WithOverrideRoutingURL(overrideRoutingURL config.OverrideRoutingURLConfiguration) Option {
	return func(r *Router) {
		r.overrideRoutingURLConfiguration = overrideRoutingURL
	}
}

func WithOverrides(overrides config.OverridesConfiguration) Option {
	return func(r *Router) {
		r.overrides = overrides
	}
}

func WithSecurityConfig(cfg config.SecurityConfiguration) Option {
	return func(r *Router) {
		r.securityConfiguration = cfg
	}
}

func WithEngineExecutionConfig(cfg config.EngineExecutionConfiguration) Option {
	return func(r *Router) {
		r.engineExecutionConfiguration = cfg
	}
}

func WithSubgraphTransportOptions(opts *SubgraphTransportOptions) Option {
	return func(r *Router) {
		r.subgraphTransportOptions = opts
	}
}

func WithSubgraphRetryOptions(enabled bool, maxRetryCount int, retryMaxDuration, retryInterval time.Duration) Option {
	return func(r *Router) {
		r.retryOptions = retrytransport.RetryOptions{
			Enabled:       enabled,
			MaxRetryCount: maxRetryCount,
			MaxDuration:   retryMaxDuration,
			Interval:      retryInterval,
		}
	}
}

func WithRouterTrafficConfig(cfg *config.RouterTrafficConfiguration) Option {
	return func(r *Router) {
		r.routerTrafficConfig = cfg
	}
}

func WithAccessController(controller *AccessController) Option {
	return func(r *Router) {
		r.accessController = controller
	}
}

func WithAuthorizationConfig(cfg *config.AuthorizationConfiguration) Option {
	return func(r *Router) {
		r.Config.authorization = cfg
	}
}

func WithRateLimitConfig(cfg *config.RateLimitConfiguration) Option {
	return func(r *Router) {
		r.Config.rateLimit = cfg
	}
}

func WithLocalhostFallbackInsideDocker(fallback bool) Option {
	return func(r *Router) {
		r.localhostFallbackInsideDocker = fallback
	}
}

func DefaultRouterTrafficConfig() *config.RouterTrafficConfiguration {
	return &config.RouterTrafficConfiguration{
		MaxRequestBodyBytes: 1000 * 1000 * 5, // 5 MB
	}
}

func DefaultSubgraphTransportOptions() *SubgraphTransportOptions {
	return &SubgraphTransportOptions{
		RequestTimeout:         60 * time.Second,
		TLSHandshakeTimeout:    10 * time.Second,
		ResponseHeaderTimeout:  0 * time.Second,
		ExpectContinueTimeout:  0 * time.Second,
		KeepAliveProbeInterval: 30 * time.Second,
		KeepAliveIdleTimeout:   0 * time.Second,
		DialTimeout:            30 * time.Second,
	}
}

func DefaultGraphQLMetricsConfig() *GraphQLMetricsConfig {
	return &GraphQLMetricsConfig{
		Enabled:           false,
		CollectorEndpoint: "",
	}
}

func WithGraphQLMetrics(cfg *GraphQLMetricsConfig) Option {
	return func(r *Router) {
		r.graphqlMetricsConfig = cfg
	}
}

// WithDevelopmentMode enables development mode. This should only be used for testing purposes.
// Development mode allows e.g. to use ART (Advanced Request Tracing) without request signing.
func WithDevelopmentMode(enabled bool) Option {
	return func(r *Router) {
		r.developmentMode = enabled
	}
}

func WithClusterName(name string) Option {
	return func(r *Router) {
		r.clusterName = name
	}
}

func WithInstanceID(id string) Option {
	return func(r *Router) {
		r.instanceID = id
	}
}

func WithAnonymization(ipConfig *IPAnonymizationConfig) Option {
	return func(r *Router) {
		r.ipAnonymization = ipConfig
	}
}

func WithWebSocketConfiguration(cfg *config.WebSocketConfiguration) Option {
	return func(r *Router) {
		r.Config.webSocketConfiguration = cfg
	}
}

func WithWithSubgraphErrorPropagation(cfg config.SubgraphErrorPropagationConfiguration) Option {
	return func(r *Router) {
		r.Config.subgraphErrorPropagation = cfg
	}
}

func WithTLSConfig(cfg *TlsConfig) Option {
	return func(r *Router) {
		r.tlsConfig = cfg
	}
}

func newHTTPTransport(opts *SubgraphTransportOptions) *http.Transport {
	dialer := &net.Dialer{
		Timeout:   opts.DialTimeout,
		KeepAlive: opts.KeepAliveProbeInterval,
	}
	// Great source of inspiration: https://gitlab.com/gitlab-org/gitlab-pages
	// A pages proxy in go that handles tls to upstreams, rate limiting, and more
	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, addr)
		},
		// The defaults value 0 = unbounded.
		// We set to some value to prevent resource exhaustion e.g max requests and ports.
		MaxConnsPerHost: 100,
		// The defaults value 0 = unbounded. 100 is used by the default go transport.
		// This value should be significant higher than MaxIdleConnsPerHost.
		MaxIdleConns: 1024,
		// The default value is 2. Such a low limit will open and close connections too often.
		// Details: https://gitlab.com/gitlab-org/gitlab-pages/-/merge_requests/274
		MaxIdleConnsPerHost: 20,
		ForceAttemptHTTP2:   true,
		IdleConnTimeout:     opts.KeepAliveIdleTimeout,
		// Set more timeouts https://gitlab.com/gitlab-org/gitlab-pages/-/issues/495
		TLSHandshakeTimeout:   opts.TLSHandshakeTimeout,
		ResponseHeaderTimeout: opts.ResponseHeaderTimeout,
		ExpectContinueTimeout: opts.ExpectContinueTimeout,
	}
}

func TraceConfigFromTelemetry(cfg *config.Telemetry) *rtrace.Config {
	var exporters []*rtrace.ExporterConfig
	for _, exp := range cfg.Tracing.Exporters {
		exporters = append(exporters, &rtrace.ExporterConfig{
			Disabled:      exp.Disabled,
			Endpoint:      exp.Endpoint,
			Exporter:      exp.Exporter,
			BatchTimeout:  exp.BatchTimeout,
			ExportTimeout: exp.ExportTimeout,
			Headers:       exp.Headers,
			HTTPPath:      exp.HTTPPath,
		})
	}

	var propagators []rtrace.Propagator

	if cfg.Tracing.Propagation.TraceContext {
		propagators = append(propagators, rtrace.PropagatorTraceContext)
	}
	if cfg.Tracing.Propagation.B3 {
		propagators = append(propagators, rtrace.PropagatorB3)
	}
	if cfg.Tracing.Propagation.Jaeger {
		propagators = append(propagators, rtrace.PropagatorJaeger)
	}
	if cfg.Tracing.Propagation.Baggage {
		propagators = append(propagators, rtrace.PropagatorBaggage)
	}

	return &rtrace.Config{
		Enabled:            cfg.Tracing.Enabled,
		Name:               cfg.ServiceName,
		Version:            Version,
		Sampler:            cfg.Tracing.SamplingRate,
		ParentBasedSampler: cfg.Tracing.ParentBasedSampler,
		WithNewRoot:        cfg.Tracing.WithNewRoot,
		ExportGraphQLVariables: rtrace.ExportGraphQLVariables{
			Enabled: cfg.Tracing.ExportGraphQLVariables,
		},
		SpanAttributesMapper: buildAttributesMapper(cfg.Attributes),
		ResourceAttributes:   buildResourceAttributes(cfg.ResourceAttributes),
		Exporters:            exporters,
		Propagators:          propagators,
	}
}

func buildAttributesMapper(attributes []config.OtelAttribute) func(req *http.Request) []attribute.KeyValue {
	return func(req *http.Request) []attribute.KeyValue {
		var result []attribute.KeyValue

		for _, attr := range attributes {
			if attr.ValueFrom != nil {
				if req != nil && attr.ValueFrom.RequestHeader != "" {
					hv := req.Header.Get(attr.ValueFrom.RequestHeader)
					if hv != "" {
						result = append(result, attribute.String(attr.Key, hv))
					} else if attr.Default != "" {
						result = append(result, attribute.String(attr.Key, attr.Default))
					}
				} else if attr.Default != "" {
					result = append(result, attribute.String(attr.Key, attr.Default))
				}
			} else if attr.Default != "" {
				result = append(result, attribute.String(attr.Key, attr.Default))
			}
		}

		return result
	}
}

func buildResourceAttributes(attributes []config.OtelResourceAttribute) []attribute.KeyValue {
	var result []attribute.KeyValue
	for _, attr := range attributes {
		result = append(result, attribute.String(attr.Key, attr.Value))
	}
	r := attribute.NewSet(result...)
	return r.ToSlice()
}

func MetricConfigFromTelemetry(cfg *config.Telemetry) *rmetric.Config {
	var openTelemetryExporters []*rmetric.OpenTelemetryExporter
	for _, exp := range cfg.Metrics.OTLP.Exporters {
		openTelemetryExporters = append(openTelemetryExporters, &rmetric.OpenTelemetryExporter{
			Disabled: exp.Disabled,
			Endpoint: exp.Endpoint,
			Exporter: exp.Exporter,
			Headers:  exp.Headers,
			HTTPPath: exp.HTTPPath,
		})
	}

	return &rmetric.Config{
		Name:               cfg.ServiceName,
		Version:            Version,
		AttributesMapper:   buildAttributesMapper(cfg.Attributes),
		ResourceAttributes: buildResourceAttributes(cfg.ResourceAttributes),
		OpenTelemetry: rmetric.OpenTelemetry{
			Enabled:       cfg.Metrics.OTLP.Enabled,
			RouterRuntime: cfg.Metrics.OTLP.RouterRuntime,
			Exporters:     openTelemetryExporters,
		},
		Prometheus: rmetric.PrometheusConfig{
			Enabled:             cfg.Metrics.Prometheus.Enabled,
			ListenAddr:          cfg.Metrics.Prometheus.ListenAddr,
			Path:                cfg.Metrics.Prometheus.Path,
			ExcludeMetrics:      cfg.Metrics.Prometheus.ExcludeMetrics,
			ExcludeMetricLabels: cfg.Metrics.Prometheus.ExcludeMetricLabels,
		},
	}
}
