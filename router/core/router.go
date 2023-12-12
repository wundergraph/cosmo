package core

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router/internal/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/internal/controlplane/selfregister"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/docker"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	brotli "go.withmatt.com/connect-brotli"

	"github.com/wundergraph/cosmo/router/internal/otel/otelconfig"

	"github.com/dgraph-io/ristretto"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/mitchellh/mapstructure"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/wundergraph/cosmo/router/config"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/health"
	"github.com/wundergraph/cosmo/router/internal/graphiql"
	"github.com/wundergraph/cosmo/router/internal/handler/cors"
	"github.com/wundergraph/cosmo/router/internal/handler/recovery"
	"github.com/wundergraph/cosmo/router/internal/handler/requestlogger"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/stringsx"
	"github.com/wundergraph/cosmo/router/internal/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type (
	// Router is the main application instance.
	Router struct {
		Config
		activeRouter *Server
		modules      []Module
		mu           sync.Mutex
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

	// Config defines the configuration options for the Router.
	Config struct {
		transport                *http.Transport
		logger                   *zap.Logger
		traceConfig              *trace.Config
		metricConfig             *metric.Config
		tracerProvider           *sdktrace.TracerProvider
		meterProvider            *sdkmetric.MeterProvider
		gqlMetricsExporter       *graphqlmetrics.Exporter
		corsOptions              *cors.Config
		routerConfig             *nodev1.RouterConfig
		gracePeriod              time.Duration
		shutdown                 bool
		listenAddr               string
		baseURL                  string
		graphqlPath              string
		playground               bool
		introspection            bool
		federatedGraphName       string
		graphApiToken            string
		healthCheckPath          string
		healthChecks             health.Checker
		readinessCheckPath       string
		livenessCheckPath        string
		cdnConfig                config.CDNConfiguration
		cdn                      *cdn.CDN
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
		developmentMode          bool
		// If connecting to localhost inside Docker fails, fallback to the docker internal address for the host
		localhostFallbackInsideDocker bool

		// Poller
		configPoller configpoller.ConfigPoller
		selfRegister selfregister.SelfRegister

		registrationInfo *nodev1.RegistrationInfo

		engineExecutionConfiguration config.EngineExecutionConfiguration

		overrideRoutingURLConfiguration config.OverrideRoutingURLConfiguration
	}

	// Server is the main router instance.
	Server struct {
		Config
		Server *http.Server
		// rootContext that all services depending on the router should
		// use as a parent context
		rootContext       context.Context
		rootContextCancel func()
		routerConfig      *nodev1.RouterConfig
		healthChecks      health.Checker
	}

	// Option defines the method to customize Server.
	Option func(svr *Router)
)

// NewRouter creates a new Router instance. Router.Start() must be called to start the server.
// Alternatively, use Router.NewTestServer() to create a new Server instance without starting it for testing purposes.
func NewRouter(opts ...Option) (*Router, error) {
	r := &Router{}

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

	// Default values for trace and metric config

	if r.traceConfig == nil {
		r.traceConfig = trace.DefaultConfig()
	}

	if r.metricConfig == nil {
		r.metricConfig = metric.DefaultConfig()
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
		"graphql-client-name",
		"graphql-client-version",
		"apollographql-client-name",
		"apollographql-client-version",
		"x-wg-trace",
		"x-wg-token",
		"authorization",
	}

	defaultMethods := []string{
		"HEAD", "GET", "POST",
	}
	r.corsOptions.AllowHeaders = stringsx.RemoveDuplicates(append(r.corsOptions.AllowHeaders, defaultHeaders...))
	r.corsOptions.AllowMethods = stringsx.RemoveDuplicates(append(r.corsOptions.AllowMethods, defaultMethods...))

	r.baseURL = fmt.Sprintf("http://%s", r.listenAddr)

	if r.transport == nil {
		r.transport = newHTTPTransport(r.subgraphTransportOptions)
	}

	// Add default tracing exporter if needed
	if r.traceConfig.Enabled && len(r.traceConfig.Exporters) == 0 {
		if endpoint := otelconfig.DefaultEndpoint(); endpoint != "" {
			r.logger.Debug("Using default trace exporter", zap.String("endpoint", endpoint))
			r.traceConfig.Exporters = append(r.traceConfig.Exporters, &trace.Exporter{
				Endpoint: endpoint,
				Exporter: otelconfig.ExporterOLTPHTTP,
				HTTPPath: "/v1/traces",
				Headers:  otelconfig.DefaultEndpointHeaders(r.graphApiToken),
			})
		}
	}

	// Add default metric exporter if none are configured
	if r.metricConfig.OpenTelemetry.Enabled && len(r.metricConfig.OpenTelemetry.Exporters) == 0 {
		if endpoint := otelconfig.DefaultEndpoint(); endpoint != "" {
			r.logger.Debug("Using default metrics exporter", zap.String("endpoint", endpoint))
			r.metricConfig.OpenTelemetry.Exporters = append(r.metricConfig.OpenTelemetry.Exporters, &metric.OpenTelemetryExporter{
				Endpoint: endpoint,
				Exporter: otelconfig.ExporterOLTPHTTP,
				HTTPPath: "/v1/metrics",
				Headers:  otelconfig.DefaultEndpointHeaders(r.graphApiToken),
			})
		}
	}

	// The user might want to start the server with a static config
	// Disable all features that requires a valid graph token and inform the user
	if r.graphApiToken == "" {
		r.graphqlMetricsConfig.Enabled = false
		r.logger.Warn("No graph token provided. Disabling schema usage tracking, thus breaking change detection. Not recommended for production use.")

		if !r.developmentMode {
			r.logger.Warn("No graph token provided. Advanced Request Tracing disabled and can only be used with a graph token or in dev mode.")
		}

		if r.traceConfig.Enabled {
			defaultExporter := trace.GetDefaultExporter(r.traceConfig)
			if defaultExporter != nil {
				r.logger.Warn("No graph token provided. Tracing ingestion to Cosmo Cloud disabled. Please specify a custom trace exporter or provide a graph token.")
				defaultExporter.Disabled = true
			}
		}
		if r.metricConfig.OpenTelemetry.Enabled {
			defaultExporter := metric.GetDefaultExporter(r.metricConfig)
			if defaultExporter != nil {
				r.logger.Warn("No graph token provided. Metrics ingestion to Cosmo Cloud disabled. Please specify a custom trace exporter or provide a graph token.")
				defaultExporter.Disabled = true
			}
		}
	}

	routerCDN, err := cdn.New(cdn.CDNOptions{
		URL:                 r.cdnConfig.URL,
		AuthenticationToken: r.graphApiToken,
		CacheSize:           r.cdnConfig.CacheSize.Uint64(),
	})
	if err != nil {
		return nil, err
	}
	r.cdn = routerCDN

	if r.developmentMode {
		r.logger.Warn("Development mode enabled. This should only be used for testing purposes")
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

		// Validate subgraph url
		if sg.RoutingUrl == "" {
			return nil, fmt.Errorf("subgraph '%s' has no routing url", sg.Name)
		}

		parsedURL, err := url.Parse(sg.RoutingUrl)
		if err != nil {
			return nil, fmt.Errorf("failed to parse subgraph url '%s': %w", sg.RoutingUrl, err)
		}

		subgraph.Url = parsedURL

		overrideURL, ok := r.overrideRoutingURLConfiguration.Subgraphs[sg.Name]

		// check if the subgraph is overridden
		if ok && overrideURL != "" {
			parsedURL, err := url.Parse(overrideURL)
			if err != nil {
				return nil, fmt.Errorf("failed to parse override url '%s': %w", overrideURL, err)
			}

			subgraph.Url = parsedURL

			// Override datasource urls
			for _, conf := range cfg.EngineConfig.DatasourceConfigurations {
				if conf.Id == sg.Id {
					conf.CustomGraphql.Fetch.Url.StaticVariableContent = overrideURL
					conf.CustomGraphql.Subscription.Url.StaticVariableContent = overrideURL
					sg.RoutingUrl = overrideURL
					break
				}
			}
		}

		subgraphs = append(subgraphs, subgraph)
	}

	return subgraphs, nil
}

// updateServer starts a new Server. It swaps the active Server with a new Server instance when the config has changed.
// This method is safe for concurrent use. When the router can't be swapped due to an error the old server kept running.
func (r *Router) updateServer(ctx context.Context, cfg *nodev1.RouterConfig) error {
	// Rebuild Server with new router config
	// In case of an error, we return early and keep the old Server running
	newRouter, err := r.newServer(ctx, cfg)
	if err != nil {
		r.logger.Error("Failed to create a new router instance. Keeping old router running", zap.Error(err))
		return err
	}

	prevRouter := r.activeRouter

	if prevRouter != nil {
		if err := prevRouter.Shutdown(ctx); err != nil {
			r.logger.Error("Could not shutdown router", zap.Error(err))
			return err
		}
	}

	// Swap active Server
	r.mu.Lock()
	r.activeRouter = newRouter
	r.mu.Unlock()

	// Start new Server
	go func() {
		r.logger.Info("Server listening",
			zap.String("listen_addr", r.listenAddr),
			zap.Bool("playground", r.playground),
			zap.Bool("introspection", r.introspection),
			zap.String("config_version", cfg.GetVersion()),
		)

		r.activeRouter.healthChecks.SetReady(true)

		// This is a blocking call
		if err := r.activeRouter.listenAndServe(); err != nil {
			r.activeRouter.healthChecks.SetReady(true)
			r.logger.Error("Failed to start new server", zap.Error(err))
		}

		r.logger.Info("Server stopped", zap.String("config_version", newRouter.routerConfig.GetVersion()))
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

// NewTestServer prepares a new Server instance but does not start it. The method should be only used for testing purposes.
// Use core.WithStaticRouterConfig to pass the initial config otherwise the engine will error.
func (r *Router) NewTestServer(ctx context.Context) (*Server, error) {
	if err := r.bootstrap(ctx); err != nil {
		return nil, fmt.Errorf("failed to bootstrap application: %w", err)
	}

	newRouter, err := r.newServer(ctx, r.routerConfig)
	if err != nil {
		r.logger.Error("Failed to create new server", zap.Error(err))
		return nil, err
	}

	return newRouter, nil
}

func (r *Router) bootstrap(ctx context.Context) error {
	if r.traceConfig.Enabled {
		tp, err := trace.NewTracerProvider(ctx, r.logger, r.traceConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		r.tracerProvider = tp
	}

	// Prometheus metrics rely on OTLP metrics
	if r.metricConfig.IsEnabled() {
		mp, pr, err := metric.NewMeterProvider(ctx, r.logger, r.metricConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		r.meterProvider = mp

		if pr != nil && r.metricConfig.Prometheus.Enabled {
			promSvr := createPrometheus(r.logger, pr, r.metricConfig.Prometheus.ListenAddr, r.metricConfig.Prometheus.Path)
			go func() {
				if err := promSvr.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
					r.logger.Error("Failed to start Prometheus server", zap.Error(err))
				}
			}()
		}
	}

	if r.graphqlMetricsConfig.Enabled {
		client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
			http.DefaultClient,
			r.graphqlMetricsConfig.CollectorEndpoint,
			brotli.WithCompression(),
			// Compress requests with Brotli.
			connect.WithSendCompression(brotli.Name),
		)
		r.gqlMetricsExporter = graphqlmetrics.NewExporter(
			r.logger,
			client,
			r.graphApiToken,
			graphqlmetrics.NewDefaultExporterSettings(),
		)
		if err := r.gqlMetricsExporter.Validate(); err != nil {
			return fmt.Errorf("failed to validate graphql metrics exporter: %w", err)
		}

		r.gqlMetricsExporter.Start()

		r.logger.Info("GraphQL schema coverage metrics enabled")
	}

	// Modules are only initialized once and not on every config change
	if err := r.initModules(ctx); err != nil {
		return fmt.Errorf("failed to init user modules: %w", err)
	}

	return nil
}

// Start starts the Server. It blocks until the context is cancelled or when the initial config could not be fetched.
func (r *Router) Start(ctx context.Context) error {
	if r.shutdown {
		return fmt.Errorf("router is closed. Create a new instance with router.NewRouter()")
	}

	cosmoCloudTracingEnabled := r.traceConfig.Enabled && trace.GetDefaultExporter(r.traceConfig) != nil
	artInProductionEnabled := r.engineExecutionConfiguration.EnableRequestTracing && !r.developmentMode
	needsRegistration := cosmoCloudTracingEnabled || artInProductionEnabled

	if needsRegistration && r.selfRegister != nil {

		r.logger.Info("Registering router with control plane because you opted in to send telemetry to Cosmo Cloud or advanced request tracing (ART) in production")

		ri, registerErr := r.selfRegister.Register(ctx)
		if registerErr != nil {
			r.logger.Error("Failed to register router. If this error persists, please contact support.", zap.Error(registerErr))
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

	if err := r.bootstrap(ctx); err != nil {
		return fmt.Errorf("failed to bootstrap application: %w", err)
	}

	// Start the server with the static config without polling
	if r.routerConfig != nil {
		r.logger.Info("Static router config provided. Polling is disabled. Updating router config is only possible by providing a config.")
		return r.updateServer(ctx, r.routerConfig)
	}

	if r.configPoller == nil {
		return fmt.Errorf("config fetcher not provided. Please provide a static router config instead")
	}

	routerConfig, err := r.configPoller.GetRouterConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to get initial router config: %w", err)
	}

	if err := r.updateServer(ctx, routerConfig); err != nil {
		r.logger.Error("Failed to start server with initial config", zap.Error(err))
		return err
	}

	r.logger.Info("Polling for router config updates in the background")

	r.configPoller.Subscribe(ctx, func(newConfig *nodev1.RouterConfig, oldVersion string) error {
		r.logger.Info("Router config has changed, upgrading server",
			zap.String("old_version", oldVersion),
			zap.String("new_version", newConfig.GetVersion()),
		)
		if err := r.updateServer(ctx, newConfig); err != nil {
			r.logger.Error("Failed to start server with new config. Trying again on the next update cycle.", zap.Error(err))
			return err
		}
		return nil
	})

	return nil
}

// newServer creates a new Server instance.
// All stateful data is copied from the Router over to the new server instance.
func (r *Router) newServer(ctx context.Context, routerConfig *nodev1.RouterConfig) (*Server, error) {
	subgraphs, err := r.configureSubgraphOverwrites(routerConfig)
	if err != nil {
		return nil, err
	}

	rootContext, rootContextCancel := context.WithCancel(ctx)
	ro := &Server{
		rootContext:       rootContext,
		rootContextCancel: rootContextCancel,
		routerConfig:      routerConfig,
		Config:            r.Config,
	}

	recoveryHandler := recovery.New(recovery.WithLogger(r.logger), recovery.WithPrintStack())
	var traceHandler *trace.Middleware
	if r.traceConfig.Enabled {
		traceHandler = trace.NewMiddleware(otel.RouterServerAttribute,
			otelhttp.WithSpanOptions(
				oteltrace.WithAttributes(
					otel.WgRouterGraphName.String(r.federatedGraphName),
					otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
					otel.WgRouterVersion.String(Version),
				),
			),
			// Disable built-in metrics
			otelhttp.WithMeterProvider(sdkmetric.NewMeterProvider()),
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
		)
	}
	requestLogger := requestlogger.New(
		r.logger,
		requestlogger.WithDefaultOptions(),
		requestlogger.WithContext(func(request *http.Request) []zapcore.Field {
			return []zapcore.Field{
				zap.String("config_version", routerConfig.GetVersion()),
				zap.String("request_id", middleware.GetReqID(request.Context())),
				zap.String("federated_graph_name", r.federatedGraphName),
			}
		}),
	)

	httpRouter := chi.NewRouter()
	httpRouter.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(withSubgraphs(r.Context(), subgraphs))
			h.ServeHTTP(w, r)
		})
	})
	httpRouter.Use(recoveryHandler)
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

	// when an execution plan was generated, which can be quite expensive, we want to cache it
	// this means that we can hash the input and cache the generated plan
	// the next time we get the same input, we can just return the cached plan
	// the engine is smart enough to first do normalization and then hash the input
	// this means that we can cache the normalized input and don't have to worry about
	// different inputs that would generate the same execution plan
	planCache, err := ristretto.NewCache(&ristretto.Config{
		MaxCost:     1024 * 10,      // keep 10k execution plans in the cache
		NumCounters: 1024 * 10 * 10, // 10k * 10
		BufferItems: 64,             // number of keys per Get buffer.
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create planner cache: %w", err)
	}

	if r.localhostFallbackInsideDocker && docker.Inside() {
		r.logger.Info("localhost fallback enabled, connections that fail to connect to localhost will be retried using host.docker.internal")
	}

	ecb := &ExecutorConfigurationBuilder{
		introspection: r.introspection,
		baseURL:       r.baseURL,
		transport:     r.transport,
		logger:        r.logger,
		includeInfo:   r.graphqlMetricsConfig.Enabled,
		transportOptions: &TransportOptions{
			RequestTimeout: r.subgraphTransportOptions.RequestTimeout,
			PreHandlers:    r.preOriginHandlers,
			PostHandlers:   r.postOriginHandlers,
			RetryOptions: retrytransport.RetryOptions{
				Enabled:       r.retryOptions.Enabled,
				MaxRetryCount: r.retryOptions.MaxRetryCount,
				MaxDuration:   r.retryOptions.MaxDuration,
				Interval:      r.retryOptions.Interval,
				ShouldRetry: func(err error, req *http.Request, resp *http.Response) bool {
					return retrytransport.IsRetryableError(err, resp) && !isMutationRequest(req.Context())
				},
			},
			LocalhostFallbackInsideDocker: r.localhostFallbackInsideDocker,
			Logger:                        r.logger,
		},
	}

	routerEngineConfig := &RouterEngineConfiguration{
		Execution: r.engineExecutionConfiguration,
		Headers:   r.headerRules,
	}

	if r.developmentMode && r.engineExecutionConfiguration.EnableRequestTracing && r.graphApiToken == "" {
		r.logger.Warn("Request tracing is enabled in development mode but requires a graph token to work in production. For more information see https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art")
	}

	executor, err := ecb.Build(ctx, routerConfig, routerEngineConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	operationParser := NewOperationParser(OperationParserOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: int64(r.routerTrafficConfig.MaxRequestBodyBytes),
		CDN:                     r.cdn,
	})
	operationPlanner := NewOperationPlanner(executor, planCache)

	var graphqlPlaygroundHandler func(http.Handler) http.Handler

	if r.playground {
		r.logger.Info("Serving GraphQL playground", zap.String("url", r.baseURL))
		graphqlPlaygroundHandler = graphiql.NewPlayground(&graphiql.PlaygroundOptions{
			Log:        r.logger,
			Html:       graphiql.PlaygroundHTML(),
			GraphqlURL: r.graphqlPath,
		})
	}

	graphqlHandler := NewGraphQLHandler(HandlerOptions{
		Executor:                               executor,
		Log:                                    r.logger,
		EnableExecutionPlanCacheResponseHeader: routerEngineConfig.Execution.EnableExecutionPlanCacheResponseHeader,
	})

	var metricStore *metric.Metrics

	// Prometheus metrics rely on OTLP metrics
	if r.metricConfig.IsEnabled() {
		m, err := metric.NewMetrics(
			r.meterProvider,
			metric.WithApplicationVersion(Version),
			metric.WithAttributes(
				otel.WgRouterGraphName.String(r.federatedGraphName),
				otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
				otel.WgRouterVersion.String(Version),
			),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create metric handler: %w", err)
		}

		metricStore = m
	}

	routerMetrics := NewRouterMetrics(metricStore, r.gqlMetricsExporter, routerConfig.GetVersion())

	var publicKey *ecdsa.PublicKey

	if r.registrationInfo != nil {
		publicKey, err = jwt.ParseECPublicKeyFromPEM([]byte(r.registrationInfo.GetGraphPublicKey()))
		if err != nil {
			return nil, fmt.Errorf("failed to parse router public key: %w", err)
		}
	}

	graphqlPreHandler := NewPreHandler(&PreHandlerOptions{
		Logger:               r.logger,
		Executor:             executor,
		Metrics:              routerMetrics,
		Parser:               operationParser,
		Planner:              operationPlanner,
		AccessController:     r.accessController,
		RouterPublicKey:      publicKey,
		EnableRequestTracing: r.engineExecutionConfiguration.EnableRequestTracing,
		DevelopmentMode:      r.developmentMode,
	})

	wsMiddleware := NewWebsocketMiddleware(rootContext, WebsocketMiddlewareOptions{
		Parser:           operationParser,
		Planner:          operationPlanner,
		Metrics:          routerMetrics,
		GraphQLHandler:   graphqlHandler,
		AccessController: r.accessController,
		Logger:           r.logger,
	})

	graphqlChiRouter := chi.NewRouter()

	// When the playground path is equal to the graphql path, we need to handle
	// ws upgrades and html requests on the same route
	if r.playground && r.graphqlPath == "/" {
		graphqlChiRouter.Use(graphqlPlaygroundHandler, wsMiddleware)
	} else {
		if r.playground {
			httpRouter.Get("/", graphqlPlaygroundHandler(nil).ServeHTTP)
		}
		graphqlChiRouter.Use(wsMiddleware)
	}

	graphqlChiRouter.Use(graphqlPreHandler.Handler)
	graphqlChiRouter.Use(r.routerMiddlewares...)

	graphqlChiRouter.Post("/", graphqlHandler.ServeHTTP)

	// Serve GraphQL. Metrics are collected after the request is handled and classified as r GraphQL request.
	httpRouter.Mount(r.graphqlPath, graphqlChiRouter)

	r.logger.Info("GraphQL endpoint",
		zap.String("method", http.MethodPost),
		zap.String("url", r.baseURL+r.graphqlPath),
	)

	ro.Server = &http.Server{
		Addr: r.listenAddr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		Handler:           httpRouter,
		ErrorLog:          zap.NewStdLog(r.logger),
	}

	return ro, nil
}

// listenAndServe starts the Server and blocks until the Server is shutdown.
func (r *Server) listenAndServe() error {
	if err := r.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	return nil
}

// Shutdown gracefully shuts down the router.
func (r *Router) Shutdown(ctx context.Context) (err error) {
	r.shutdown = true

	if r.configPoller != nil {
		if subErr := r.configPoller.Stop(ctx); subErr != nil {
			err = errors.Join(err, fmt.Errorf("failed to stop config poller: %w", subErr))
		}
	}

	if r.selfRegister != nil {
		if subErr := r.selfRegister.Stop(ctx); subErr != nil {
			err = errors.Join(err, fmt.Errorf("failed to stop self registration: %w", subErr))
		}
	}

	if r.activeRouter != nil {
		if subErr := r.activeRouter.Shutdown(ctx); subErr != nil {
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
				err = errors.Join(err, fmt.Errorf("failed to stop graphql metrics exporter: %w", subErr))
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

// Shutdown gracefully shutdown the Server.
func (r *Server) Shutdown(ctx context.Context) (err error) {
	r.logger.Info("Gracefully shutting down the router ...",
		zap.String("config_version", r.routerConfig.GetVersion()),
		zap.String("grace_period", r.gracePeriod.String()),
	)

	r.rootContextCancel()

	if r.gracePeriod > 0 {
		ctxWithTimer, cancel := context.WithTimeout(ctx, r.gracePeriod)
		ctx = ctxWithTimer
		defer cancel()
	}

	r.healthChecks.SetReady(false)

	if r.Server != nil {
		if err := r.Server.Shutdown(ctx); err != nil {
			return err
		}
	}

	return err
}

func createPrometheus(logger *zap.Logger, registry *metric.PromRegistry, listenAddr, path string) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Handle(path, promhttp.HandlerFor(registry, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		ErrorLog:          zap.NewStdLog(logger),
		Registry:          registry,
		Timeout:           0,
	}))

	svr := &http.Server{
		Addr:              listenAddr,
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		ErrorLog:          zap.NewStdLog(logger),
		Handler:           r,
	}

	logger.Info("Prometheus metrics enabled", zap.String("listen_addr", svr.Addr), zap.String("endpoint", path))

	return svr
}

func WithListenerAddr(addr string) Option {
	return func(r *Router) {
		r.listenAddr = addr
	}
}

func WithTransport(transport *http.Transport) Option {
	return func(r *Router) {
		r.transport = transport
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

func WithTracing(cfg *trace.Config) Option {
	return func(r *Router) {
		r.traceConfig = cfg
	}
}

func WithCors(corsOpts *cors.Config) Option {
	return func(r *Router) {
		r.corsOptions = corsOpts
	}
}

func WithGraphQLPath(path string) Option {
	return func(r *Router) {
		r.graphqlPath = path
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

func WithMetrics(cfg *metric.Config) Option {
	return func(r *Router) {
		r.metricConfig = cfg
	}
}

func WithFederatedGraphName(name string) Option {
	return func(r *Router) {
		r.federatedGraphName = name
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
