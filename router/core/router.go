package core

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/cdn"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/s3"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/file_watcher"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	configCDNProvider "github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
	configs3Provider "github.com/wundergraph/cosmo/router/pkg/routerconfig/s3"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/internal/docker"
	"github.com/wundergraph/cosmo/router/internal/graphiql"
	"go.uber.org/atomic"
	brotli "go.withmatt.com/connect-brotli"

	"github.com/nats-io/nuid"
	"github.com/redis/go-redis/v9"

	"connectrpc.com/connect"
	"github.com/mitchellh/mapstructure"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/debug"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/stringsx"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/health"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
)

type IPAnonymizationMethod string

const (
	Hash   IPAnonymizationMethod = "hash"
	Redact IPAnonymizationMethod = "redact"
)

var CompressibleContentTypes = []string{
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
	"application/graphql-response+json",
	"application/graphql+json",
}

type (
	// Router is the main application instance.
	Router struct {
		Config
		httpServer        *server
		modules           []Module
		WebsocketStats    WebSocketsStatistics
		playgroundHandler func(http.Handler) http.Handler
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

	RouterConfigPollerConfig struct {
		config.ExecutionConfig
		PollInterval time.Duration
		GraphSignKey string
	}

	ExecutionConfig struct {
		Watch bool
		Path  string
	}

	// Config defines the configuration options for the Router.
	Config struct {
		clusterName               string
		instanceID                string
		logger                    *zap.Logger
		traceConfig               *rtrace.Config
		metricConfig              *rmetric.Config
		tracerProvider            *sdktrace.TracerProvider
		otlpMeterProvider         *sdkmetric.MeterProvider
		promMeterProvider         *sdkmetric.MeterProvider
		gqlMetricsExporter        graphqlmetrics.SchemaUsageExporter
		corsOptions               *cors.Config
		setConfigVersionHeader    bool
		routerGracePeriod         time.Duration
		staticExecutionConfig     *nodev1.RouterConfig
		awsLambda                 bool
		shutdown                  atomic.Bool
		bootstrapped              bool
		ipAnonymization           *IPAnonymizationConfig
		listenAddr                string
		baseURL                   string
		graphqlWebURL             string
		playgroundPath            string
		graphqlPath               string
		playground                bool
		introspection             bool
		graphApiToken             string
		healthCheckPath           string
		readinessCheckPath        string
		livenessCheckPath         string
		routerConfigPollerConfig  *RouterConfigPollerConfig
		cdnConfig                 config.CDNConfiguration
		persistedOperationClient  persistedoperation.Client
		persistedOperationsConfig config.PersistedOperationsConfig
		storageProviders          config.StorageProviders
		eventsConfig              config.EventsConfiguration
		prometheusServer          *http.Server
		modulesConfig             map[string]interface{}
		executionConfig           *ExecutionConfig
		routerMiddlewares         []func(http.Handler) http.Handler
		preOriginHandlers         []TransportPreHandler
		postOriginHandlers        []TransportPostHandler
		headerRuleEngine          *HeaderRuleEngine
		headerRules               config.HeaderRules
		subgraphTransportOptions  *SubgraphTransportOptions
		graphqlMetricsConfig      *GraphQLMetricsConfig
		routerTrafficConfig       *config.RouterTrafficConfiguration
		fileUploadConfig          *config.FileUpload
		accessController          *AccessController
		retryOptions              retrytransport.RetryOptions
		redisClient               *redis.Client
		processStartTime          time.Time
		developmentMode           bool
		healthcheck               health.Checker
		configFileWatcher         *file_watcher.Watcher
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
	// Option defines the method to customize server.
	Option func(svr *Router)
)

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
	if r.fileUploadConfig == nil {
		r.fileUploadConfig = DefaultFileUploadConfig()
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
		// Required for feature flags
		"x-feature-flag",
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

		r.logger.Warn("No graph token provided. The following Cosmo Cloud features are disabled. Not recommended for Production.",
			zap.Strings("features", disabledFeatures),
		)
	}

	if r.developmentMode {
		r.logger.Warn("Development mode enabled. This should only be used for testing purposes")
	}

	if r.healthcheck == nil {
		r.healthcheck = health.New(&health.Options{
			Logger: r.logger,
		})
	}

	for _, source := range r.eventsConfig.Providers.Nats {
		r.logger.Info("Nats Event source enabled", zap.String("providerID", source.ID), zap.String("url", source.URL))
	}
	for _, source := range r.eventsConfig.Providers.Kafka {
		r.logger.Info("Kafka Event source enabled", zap.String("providerID", source.ID), zap.Strings("brokers", source.Brokers))
	}

	return r, nil
}

// newGraphServer creates a new server.
func (r *Router) newServer(ctx context.Context, cfg *nodev1.RouterConfig) error {
	server, err := newGraphServer(ctx, r, cfg)
	if err != nil {
		r.logger.Error("Failed to create graph server. Keeping the old server", zap.Error(err))
		return err
	}

	r.httpServer.SwapGraphServer(ctx, server)

	return nil
}

func (r *Router) listenAndServe(cfg *nodev1.RouterConfig) error {
	r.logger.Info("Server listening and serving",
		zap.String("listen_addr", r.listenAddr),
		zap.Bool("playground", r.playground),
		zap.Bool("introspection", r.introspection),
		zap.String("config_version", cfg.GetVersion()),
	)

	// Mark the server as ready
	r.httpServer.healthcheck.SetReady(true)

	go func() {
		// Mark the server as not ready when the server is stopped
		defer r.httpServer.healthcheck.SetReady(false)

		// This is a blocking call
		if err := r.httpServer.listenAndServe(); err != nil {
			r.logger.Error("Failed to start new server", zap.Error(err))
		}
	}()

	return nil
}

func (r *Router) initModules(ctx context.Context) error {
	var moduleList = sortModules(modules)

	for _, moduleInfo := range moduleList {
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

func (r *Router) BaseURL() string {
	return r.baseURL
}

// NewServer prepares a new server instance but does not start it. The method should only be used when you want to bootstrap
// the server manually otherwise you can use Router.Start(). You're responsible for setting health checks status to ready with Server.HealthChecks().
// The server can be shutdown with Router.Shutdown(). Use core.WithExecutionConfig to pass the initial config otherwise the Router will
// try to fetch the config from the control plane. You can swap the router config by using Router.newGraphServer().
func (r *Router) NewServer(ctx context.Context) (Server, error) {
	if r.shutdown.Load() {
		return nil, fmt.Errorf("router is shutdown. Create a new instance with router.NewRouter()")
	}

	if err := r.bootstrap(ctx); err != nil {
		return nil, fmt.Errorf("failed to bootstrap application: %w", err)
	}

	r.httpServer = newServer(&httpServerOptions{
		addr:            r.listenAddr,
		logger:          r.logger,
		tlsConfig:       r.tlsConfig,
		tlsServerConfig: r.tlsServerConfig,
		healthcheck:     r.healthcheck,
		baseURL:         r.baseURL,
	})

	// Start the server with the static config without polling
	if r.staticExecutionConfig != nil {
		r.logger.Info("Static execution config provided. Polling is disabled. Updating execution config is only possible by providing a config.")
		return r.httpServer, r.newServer(ctx, r.staticExecutionConfig)
	}

	// when no static config is provided and no poller is configured, we can't start the server
	if r.configPoller == nil {
		return nil, fmt.Errorf("config fetcher not provided. Please provide a static execution config instead")
	}

	cfg, err := r.configPoller.GetRouterConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get initial execution config: %w", err)
	}

	if err := r.newServer(ctx, cfg.Config); err != nil {
		r.logger.Error("Failed to start server with initial config", zap.Error(err))
		return nil, err
	}

	return r.httpServer, nil
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

	if r.playground {
		playgroundUrl, err := url.JoinPath(r.baseURL, r.playgroundPath)
		if err != nil {
			return fmt.Errorf("failed to join playground url: %w", err)
		}
		r.logger.Info("Serving GraphQL playground", zap.String("url", playgroundUrl))
		r.playgroundHandler = graphiql.NewPlayground(&graphiql.PlaygroundOptions{
			Html:       graphiql.PlaygroundHTML(),
			GraphqlURL: r.graphqlWebURL,
		})
	}

	if r.executionConfig != nil && r.executionConfig.Path != "" {
		executionConfig, err := execution_config.FromFile(r.executionConfig.Path)
		if err != nil {
			return fmt.Errorf("failed to read execution config: %w", err)
		}
		r.staticExecutionConfig = executionConfig
	}

	if err := r.buildClients(); err != nil {
		return err
	}

	// Modules are only initialized once and not on every config change
	if err := r.initModules(ctx); err != nil {
		return fmt.Errorf("failed to init user modules: %w", err)
	}

	return nil
}

// buildClients initializes the storage clients for persisted operations and router config.
func (r *Router) buildClients() error {
	s3Providers := map[string]config.S3StorageProvider{}
	cdnProviders := map[string]config.CDNStorageProvider{}

	for _, provider := range r.storageProviders.S3 {
		if _, ok := s3Providers[provider.ID]; ok {
			return fmt.Errorf("duplicate s3 storage provider with id '%s'", provider.ID)
		}
		s3Providers[provider.ID] = provider
	}

	for _, provider := range r.storageProviders.CDN {
		if _, ok := cdnProviders[provider.ID]; ok {
			return fmt.Errorf("duplicate cdn storage provider with id '%s'", provider.ID)
		}
		cdnProviders[provider.ID] = provider
	}

	var pClient persistedoperation.Client

	if provider, ok := cdnProviders[r.persistedOperationsConfig.Storage.ProviderID]; ok {

		if r.graphApiToken == "" {
			return errors.New("graph token is required to fetch persisted operations from CDN")
		}

		c, err := cdn.NewClient(provider.URL, r.graphApiToken, cdn.Options{
			Logger:        r.logger,
			TraceProvider: r.tracerProvider,
		})
		if err != nil {
			return err
		}
		pClient = c

		r.logger.Info("Use CDN as storage provider for persisted operations",
			zap.String("providerID", provider.ID),
		)
	} else if provider, ok := s3Providers[r.persistedOperationsConfig.Storage.ProviderID]; ok {

		c, err := s3.NewClient(provider.Endpoint, &s3.Options{
			AccessKeyID:      provider.AccessKey,
			SecretAccessKey:  provider.SecretKey,
			Region:           provider.Region,
			UseSSL:           provider.Secure,
			BucketName:       provider.Bucket,
			ObjectPathPrefix: r.persistedOperationsConfig.Storage.ObjectPrefix,
			TraceProvider:    r.tracerProvider,
		})
		if err != nil {
			return err
		}
		pClient = c

		r.logger.Info("Use S3 as storage provider for persisted operations",
			zap.String("providerID", provider.ID),
		)
	} else if r.graphApiToken != "" {
		if r.persistedOperationsConfig.Storage.ProviderID != "" {
			return fmt.Errorf("unknown storage provider id '%s' for persisted operations", r.persistedOperationsConfig.Storage.ProviderID)
		}

		c, err := cdn.NewClient(r.cdnConfig.URL, r.graphApiToken, cdn.Options{
			Logger:        r.logger,
			TraceProvider: r.tracerProvider,
		})
		if err != nil {
			return err
		}
		pClient = c

		r.logger.Debug("Default to Cosmo CDN as persisted operations provider",
			zap.String("url", r.cdnConfig.URL),
		)
	}

	// For backwards compatibility with cdn config field
	cacheSize := r.persistedOperationsConfig.Cache.Size.Uint64()
	if cacheSize <= 0 {
		cacheSize = r.cdnConfig.CacheSize.Uint64()
	}

	c, err := persistedoperation.NewClient(&persistedoperation.Options{
		CacheSize:      cacheSize,
		Logger:         r.logger,
		ProviderClient: pClient,
	})
	if err != nil {
		return err
	}

	r.persistedOperationClient = c

	var rClient routerconfig.Client

	// Poller is only initialized when a config poller is configured and the router is not started with a static config
	if r.staticExecutionConfig == nil && r.routerConfigPollerConfig != nil && r.configPoller == nil {

		if provider, ok := cdnProviders[r.routerConfigPollerConfig.Storage.ProviderID]; ok {

			if r.graphApiToken == "" {
				return errors.New(
					"graph token is required to fetch execution config from CDN. " +
						"Alternatively, configure a custom storage provider or specify a static execution config",
				)
			}

			c, err := configCDNProvider.NewClient(
				provider.URL,
				r.graphApiToken,
				&configCDNProvider.Options{
					Logger:       r.logger,
					SignatureKey: r.routerConfigPollerConfig.GraphSignKey,
				})
			if err != nil {
				return err
			}
			rClient = c

			r.logger.Info("Polling for execution config updates from CDN in the background",
				zap.String("providerID", provider.ID),
				zap.String("interval", r.routerConfigPollerConfig.PollInterval.String()),
			)
		} else if provider, ok := s3Providers[r.routerConfigPollerConfig.Storage.ProviderID]; ok {

			c, err := configs3Provider.NewClient(provider.Endpoint, &configs3Provider.ClientOptions{
				AccessKeyID:     provider.AccessKey,
				SecretAccessKey: provider.SecretKey,
				BucketName:      provider.Bucket,
				Region:          provider.Region,
				ObjectPath:      r.routerConfigPollerConfig.Storage.ObjectPath,
				Secure:          provider.Secure,
			})
			if err != nil {
				return err
			}
			rClient = c

			r.logger.Info("Polling for execution config updates from S3 storage in the background",
				zap.String("providerID", provider.ID),
				zap.String("interval", r.routerConfigPollerConfig.PollInterval.String()),
			)
		} else {
			if r.routerConfigPollerConfig.Storage.ProviderID != "" {
				return fmt.Errorf("unknown storage provider id '%s' for execution config", r.routerConfigPollerConfig.Storage.ProviderID)
			}

			if r.graphApiToken == "" {
				return errors.New(
					"graph token is required to fetch execution config from CDN. " +
						"Alternatively, configure a custom storage provider or specify a static execution config",
				)
			}

			c, err := configCDNProvider.NewClient(r.cdnConfig.URL, r.graphApiToken, &configCDNProvider.Options{
				Logger:       r.logger,
				SignatureKey: r.routerConfigPollerConfig.GraphSignKey,
			})
			if err != nil {
				return err
			}
			rClient = c

			r.logger.Info("Polling for execution config updates from Cosmo CDN in the background",
				zap.String("interval", r.routerConfigPollerConfig.PollInterval.String()),
			)
		}

		r.configPoller = configpoller.New(r.graphApiToken,
			configpoller.WithLogger(r.logger),
			configpoller.WithPollInterval(r.routerConfigPollerConfig.PollInterval),
			configpoller.WithClient(rClient),
		)

	}

	return nil
}

// Start starts the server. It does not block. The server can be shutdown with Router.Shutdown().
// Not safe for concurrent use.
func (r *Router) Start(ctx context.Context) error {
	if r.shutdown.Load() {
		return fmt.Errorf("router is shutdown. Create a new instance with router.NewRouter()")
	}

	if err := r.bootstrap(ctx); err != nil {
		return fmt.Errorf("failed to bootstrap router: %w", err)
	}

	r.httpServer = newServer(&httpServerOptions{
		addr:            r.listenAddr,
		logger:          r.logger,
		tlsConfig:       r.tlsConfig,
		tlsServerConfig: r.tlsServerConfig,
		healthcheck:     r.healthcheck,
		baseURL:         r.baseURL,
	})

	// Start the server with the static config without polling
	if r.staticExecutionConfig != nil {
		if err := r.newServer(ctx, r.staticExecutionConfig); err != nil {
			return err
		}

		if err := r.listenAndServe(r.staticExecutionConfig); err != nil {
			return err
		}

		if r.executionConfig != nil && r.executionConfig.Watch {
			watcher, err := file_watcher.FileWatcher(r.logger, r.executionConfig.Path)
			if err != nil {
				return fmt.Errorf("failed to watch config file: %w", err)
			}
			err = watcher.Watch(func() {
				if r.shutdown.Load() {
					r.logger.Warn("Router is in shutdown state. Skipping config update")
				}

				data, err := os.ReadFile(r.executionConfig.Path)
				if err != nil {
					r.logger.Error("Failed to read config file", zap.Error(err))
					return
				}

				r.logger.Info("Config file changed. Updating server with new config")

				cfg, err := execution_config.UnmarshalConfig(data)
				if err != nil {
					r.logger.Error("Failed to serialize config file", zap.Error(err))
					return
				}

				if err := r.newServer(ctx, cfg); err != nil {
					r.logger.Error("Failed to update server with new config", zap.Error(err))
				}
			})
			if err != nil {
				return fmt.Errorf("failed to watch config file: %w", err)
			}
			r.logger.Info("Watching config file for changes. Router will hot-reload automatically without downtime",
				zap.String("path", r.executionConfig.Path),
			)
			r.configFileWatcher = watcher

			return nil
		}

		r.logger.Info("Static execution config provided. Polling is disabled. Updating execution config is only possible by restarting the server")

		return nil
	}

	// when no static config is provided and no poller is configured, we can't start the server
	if r.configPoller == nil {
		return fmt.Errorf("execution config fetcher not provided. Please provide a static execution config instead")
	}

	cfg, err := r.configPoller.GetRouterConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to get initial execution config: %w", err)
	}

	if err := r.newServer(ctx, cfg.Config); err != nil {
		return err
	}

	if r.playground {
		graphqlEndpointURL, err := url.JoinPath(r.baseURL, r.graphqlPath)
		if err != nil {
			return fmt.Errorf("failed to join graphql endpoint url: %w", err)
		}
		r.logger.Info("GraphQL endpoint",
			zap.String("method", http.MethodPost),
			zap.String("url", graphqlEndpointURL),
		)
	}

	/**
	* Server logging after features has been initialized / disabled
	 */

	if r.localhostFallbackInsideDocker && docker.Inside() {
		r.logger.Info("localhost fallback enabled, connections that fail to connect to localhost will be retried using host.docker.internal")
	}

	if r.developmentMode && r.engineExecutionConfiguration.EnableRequestTracing && r.graphApiToken == "" {
		r.logger.Warn("Advanced Request Tracing (ART) is enabled in development mode but requires a graph token to work in production. For more information see https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art")
	}

	if r.redisClient != nil {
		r.logger.Info("Rate limiting enabled",
			zap.Int("rate", r.rateLimit.SimpleStrategy.Rate),
			zap.Int("burst", r.rateLimit.SimpleStrategy.Burst),
			zap.Duration("duration", r.Config.rateLimit.SimpleStrategy.Period),
			zap.Bool("rejectExceeding", r.Config.rateLimit.SimpleStrategy.RejectExceedingRequests),
		)
	}

	if err := r.listenAndServe(cfg.Config); err != nil {
		r.logger.Error("Failed to start server with initial config", zap.Error(err))
		return err
	}

	r.configPoller.Subscribe(ctx, func(newConfig *nodev1.RouterConfig, oldVersion string) error {
		if r.shutdown.Load() {
			r.logger.Warn("Router is in shutdown state. Skipping config update")
			return nil
		}

		if err := r.newServer(ctx, newConfig); err != nil {
			return err
		}

		return nil
	})

	return nil
}

// Shutdown gracefully shuts down the router. It blocks until the server is shutdown.
// If the router is already shutdown, the method returns immediately without error. Not safe for concurrent use.
func (r *Router) Shutdown(ctx context.Context) (err error) {

	if r.shutdown.Load() {
		return nil
	}

	r.shutdown.Store(true)

	// Respect grace period
	if r.routerGracePeriod > 0 {
		ctxWithTimer, cancel := context.WithTimeout(ctx, r.routerGracePeriod)
		defer cancel()

		ctx = ctxWithTimer
	}

	if r.configFileWatcher != nil {
		if subErr := r.configFileWatcher.Close(); subErr != nil {
			err = errors.Join(err, fmt.Errorf("failed to close config file watcher: %w", subErr))
		}
	}

	if r.configPoller != nil {
		if subErr := r.configPoller.Stop(ctx); subErr != nil {
			err = errors.Join(err, fmt.Errorf("failed to stop config poller: %w", subErr))
		}
	}

	if r.httpServer != nil {
		if subErr := r.httpServer.Shutdown(ctx); subErr != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				r.logger.Warn(
					"Shutdown deadline exceeded. Router took too long to shutdown. Consider increasing the grace period",
					zap.Duration("grace_period", r.routerGracePeriod),
				)
			}
			err = errors.Join(err, fmt.Errorf("failed to shutdown router: %w", subErr))
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

	// Shutdown the CDN operation client and free up resources
	if r.persistedOperationClient != nil {
		r.persistedOperationClient.Close()
	}

	wg.Wait()

	return err
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

// WithConfigPoller sets the poller client to fetch the router config. If not set, WithConfigPollerConfig should be set.
func WithConfigPoller(cf configpoller.ConfigPoller) Option {
	return func(r *Router) {
		r.configPoller = cf
	}
}

// WithSelfRegistration sets the self registration client to register the router with the control plane.
func WithSelfRegistration(sr selfregister.SelfRegister) Option {
	return func(r *Router) {
		r.selfRegister = sr
	}
}

// WithGracePeriod sets the grace period for the router to shutdown.
func WithGracePeriod(timeout time.Duration) Option {
	return func(r *Router) {
		r.routerGracePeriod = timeout
	}
}

// WithMetrics sets the metrics configuration for the router.
func WithMetrics(cfg *rmetric.Config) Option {
	return func(r *Router) {
		r.metricConfig = cfg
	}
}

// CorsDefaultOptions returns the default CORS options for the rs/cors package.
func CorsDefaultOptions() *cors.Config {
	return &cors.Config{
		Enabled:      true,
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

func WithExecutionConfig(cfg *ExecutionConfig) Option {
	return func(r *Router) {
		r.executionConfig = cfg
	}
}

// WithStaticExecutionConfig sets the static execution config. This disables polling and file watching.
func WithStaticExecutionConfig(cfg *nodev1.RouterConfig) Option {
	return func(r *Router) {
		r.staticExecutionConfig = cfg
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
		r.healthcheck = healthChecks
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

func WithFileUploadConfig(cfg *config.FileUpload) Option {
	return func(r *Router) {
		r.fileUploadConfig = cfg
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

func DefaultFileUploadConfig() *config.FileUpload {
	return &config.FileUpload{
		Enabled:          true,
		MaxFileSizeBytes: 1000 * 1000 * 50, // 50 MB,
		MaxFiles:         10,
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

func WithConfigVersionHeader(include bool) Option {
	return func(r *Router) {
		r.setConfigVersionHeader = include
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

func WithSubgraphErrorPropagation(cfg config.SubgraphErrorPropagationConfiguration) Option {
	return func(r *Router) {
		r.Config.subgraphErrorPropagation = cfg
	}
}

func WithTLSConfig(cfg *TlsConfig) Option {
	return func(r *Router) {
		r.tlsConfig = cfg
	}
}

func WithConfigPollerConfig(cfg *RouterConfigPollerConfig) Option {
	return func(r *Router) {
		r.routerConfigPollerConfig = cfg
	}
}

func WithPersistedOperationsConfig(cfg config.PersistedOperationsConfig) Option {
	return func(r *Router) {
		r.persistedOperationsConfig = cfg
	}
}

func WithStorageProviders(cfg config.StorageProviders) Option {
	return func(r *Router) {
		r.storageProviders = cfg
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
