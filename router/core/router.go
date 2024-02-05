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

	"github.com/wundergraph/cosmo/router/internal/recoveryhandler"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/health"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"

	"connectrpc.com/connect"
	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/internal/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/internal/debug"
	"github.com/wundergraph/cosmo/router/internal/docker"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	rjwt "github.com/wundergraph/cosmo/router/internal/jwt"
	brotli "go.withmatt.com/connect-brotli"

	"github.com/dgraph-io/ristretto"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/mitchellh/mapstructure"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/graphiql"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/stringsx"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
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
		activeServer *server
		modules      []Module

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

	// Config defines the configuration options for the Router.
	Config struct {
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
		listenAddr               string
		baseURL                  string
		graphqlWebURL            string
		playgroundPath           string
		graphqlPath              string
		playground               bool
		introspection            bool
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
		developmentMode          bool
		// If connecting to localhost inside Docker fails, fallback to the docker internal address for the host
		localhostFallbackInsideDocker bool

		// Poller
		configPoller configpoller.ConfigPoller
		selfRegister selfregister.SelfRegister

		registrationInfo *nodev1.RegistrationInfo

		engineExecutionConfiguration config.EngineExecutionConfiguration

		overrideRoutingURLConfiguration config.OverrideRoutingURLConfiguration

		authorization *config.AuthorizationConfiguration
	}

	Server interface {
		HttpServer() *http.Server
		HealthChecks() health.Checker
	}

	// server is the main router instance.
	server struct {
		Config
		server *http.Server
		// rootContext that all services depending on the router should
		// use as a parent context
		rootContext       context.Context
		rootContextCancel func()
		routerConfig      *nodev1.RouterConfig
		healthChecks      health.Checker
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

	r.baseURL = fmt.Sprintf("http://%s", r.listenAddr)

	// Add default tracing exporter if needed
	if r.traceConfig.Enabled && len(r.traceConfig.Exporters) == 0 {
		if endpoint := otelconfig.DefaultEndpoint(); endpoint != "" {
			r.logger.Debug("Using default trace exporter", zap.String("endpoint", endpoint))
			r.traceConfig.Exporters = append(r.traceConfig.Exporters, &rtrace.Exporter{
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

	for _, source := range r.eventsConfig.Sources {
		r.logger.Info("Event source enabled", zap.String("provider", source.Provider), zap.String("url", source.URL))
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

// UpdateServer starts a new server and swaps the active server with the new one. The old server is shutdown gracefully.
// When the router can't be swapped due to an error the old server kept running. Not safe for concurrent use.
func (r *Router) UpdateServer(ctx context.Context, cfg *nodev1.RouterConfig) (Server, error) {
	// Rebuild server with new router config
	// In case of an error, we return early and keep the old server running
	newServer, err := r.newServer(ctx, cfg)
	if err != nil {
		r.logger.Error("Failed to create a new router instance. Keeping old router running", zap.Error(err))
		return nil, err
	}

	if r.activeServer != nil {
		if err := r.activeServer.Shutdown(ctx); err != nil {
			r.logger.Error("Could not shutdown router", zap.Error(err))
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
		r.logger.Info("Server listening",
			zap.String("listen_addr", r.listenAddr),
			zap.Bool("playground", r.playground),
			zap.Bool("introspection", r.introspection),
			zap.String("config_version", cfg.GetVersion()),
		)

		r.activeServer.healthChecks.SetReady(true)

		// This is a blocking call
		if err := r.activeServer.listenAndServe(); err != nil {
			r.activeServer.healthChecks.SetReady(true)
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
// It should only be called once for a Router instance.
func (r *Router) bootstrap(ctx context.Context) error {
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
		tp, err := rtrace.NewTracerProvider(ctx, r.logger, r.traceConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		r.tracerProvider = tp
	}

	// Prometheus metrics rely on OTLP metrics
	if r.metricConfig.IsEnabled() {
		if r.metricConfig.Prometheus.Enabled {
			mp, registry, err := rmetric.NewPrometheusMeterProvider(ctx, r.metricConfig)
			if err != nil {
				return fmt.Errorf("failed to create Prometheus exporter: %w", err)
			}
			r.promMeterProvider = mp
			r.prometheusServer = rmetric.ServePrometheus(r.logger, r.metricConfig.Prometheus.ListenAddr, r.metricConfig.Prometheus.Path, registry)
			go func() {
				if err := r.prometheusServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
					r.logger.Error("Failed to start Prometheus server", zap.Error(err))
				}
			}()
		}
		mp, err := rmetric.NewOtlpMeterProvider(ctx, r.logger, r.metricConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		r.otlpMeterProvider = mp
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
		r.logger.Info("Router config has changed, upgrading server",
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

// newServer creates a new server instance.
// All stateful data is copied from the Router over to the new server instance.
func (r *Router) newServer(ctx context.Context, routerConfig *nodev1.RouterConfig) (*server, error) {
	subgraphs, err := r.configureSubgraphOverwrites(routerConfig)
	if err != nil {
		return nil, err
	}

	rootContext, rootContextCancel := context.WithCancel(ctx)
	ro := &server{
		rootContext:       rootContext,
		rootContextCancel: rootContextCancel,
		routerConfig:      routerConfig,
		Config:            r.Config,
	}

	baseAttributes := []attribute.KeyValue{
		otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
		otel.WgRouterVersion.String(Version),
		otel.WgRouterRootSpan.Bool(true),
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
		traceHandler = rtrace.NewMiddleware(otel.RouterServerAttribute,
			otelhttp.WithSpanOptions(
				oteltrace.WithAttributes(
					baseAttributes...,
				),
			),
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
	requestLogger := requestlogger.New(
		r.logger,
		requestlogger.WithDefaultOptions(),
		requestlogger.WithNoTimeField(),
		requestlogger.WithContext(func(request *http.Request) []zapcore.Field {
			return []zapcore.Field{
				zap.String("config_version", routerConfig.GetVersion()),
				zap.String("request_id", middleware.GetReqID(request.Context())),
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

	metricStore := rmetric.NewNoopMetrics()

	// Prometheus metricStore rely on OTLP metricStore
	if r.metricConfig.IsEnabled() {
		m, err := rmetric.NewMetrics(
			r.metricConfig.Name,
			Version,
			rmetric.WithPromMeterProvider(r.promMeterProvider),
			rmetric.WithOtlpMeterProvider(r.otlpMeterProvider),
			rmetric.WithLogger(r.logger),
			rmetric.WithAttributes(
				baseAttributes...,
			),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create metric handler: %w", err)
		}

		metricStore = m
	}

	routerMetrics := NewRouterMetrics(&routerMetricsConfig{
		metrics:             metricStore,
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
			MetricStore:    metricStore,
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
		Events:    r.eventsConfig,
	}

	if r.developmentMode && r.engineExecutionConfiguration.EnableRequestTracing && r.graphApiToken == "" {
		r.logger.Warn("Advanced Request Tracing (ART) is enabled in development mode but requires a graph token to work in production. For more information see https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art")
	}

	executor, err := ecb.Build(ctx, routerConfig, routerEngineConfig, r.WebsocketStats)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	operationParser := NewOperationParser(OperationParserOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: int64(r.routerTrafficConfig.MaxRequestBodyBytes),
		PersistentOpClient:      r.cdnPersistentOpClient,
	})
	// Pre-hash all data source IDs to avoid races
	// TODO: Ideally, we would do this in the engine itself
	// Context:
	// In case we have 2 concurrent requests that need planning and use the same data source
	// it's possible that we run into a race by either calling Hash() on the same data source
	// or by calling Planner(), which might have side effects.
	// E.g. in a Data Source Factory, we might be lazily initializing a client
	for i := range executor.PlanConfig.DataSources {
		executor.PlanConfig.DataSources[i].Hash()
		// Pre-init the Planner for each data source
		executor.PlanConfig.DataSources[i].Factory.Planner(ctx)
	}
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

	graphqlHandler := NewGraphQLHandler(HandlerOptions{
		Executor:                               executor,
		Log:                                    r.logger,
		EnableExecutionPlanCacheResponseHeader: routerEngineConfig.Execution.EnableExecutionPlanCacheResponseHeader,
		WebSocketStats:                         r.WebsocketStats,
		TracerProvider:                         r.tracerProvider,
		Authorizer:                             NewCosmoAuthorizer(authorizerOptions),
	})

	var publicKey *ecdsa.PublicKey

	if r.registrationInfo != nil {
		publicKey, err = jwt.ParseECPublicKeyFromPEM([]byte(r.registrationInfo.GetGraphPublicKey()))
		if err != nil {
			return nil, fmt.Errorf("failed to parse router public key: %w", err)
		}
	}

	graphqlPreHandler := NewPreHandler(&PreHandlerOptions{
		Logger:                      r.logger,
		Executor:                    executor,
		Metrics:                     routerMetrics,
		OperationProcessor:          operationParser,
		Planner:                     operationPlanner,
		AccessController:            r.accessController,
		RouterPublicKey:             publicKey,
		EnableRequestTracing:        r.engineExecutionConfiguration.EnableRequestTracing,
		DevelopmentMode:             r.developmentMode,
		TracerProvider:              r.tracerProvider,
		FlushTelemetryAfterResponse: r.awsLambda,
		TraceExportVariables:        r.traceConfig.ExportGraphQLVariables.Enabled,
	})

	wsMiddleware := NewWebsocketMiddleware(rootContext, WebsocketMiddlewareOptions{
		OperationProcessor:         operationParser,
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
	})

	graphqlChiRouter := chi.NewRouter()

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

	graphqlChiRouter.Use(graphqlPreHandler.Handler)

	// Built in and custom modules
	graphqlChiRouter.Use(r.routerMiddlewares...)

	graphqlChiRouter.Post("/", graphqlHandler.ServeHTTP)

	// Serve GraphQL. MetricStore are collected after the request is handled and classified as r GraphQL request.
	httpRouter.Mount(r.graphqlPath, graphqlChiRouter)

	graphqlEndpointURL, err := url.JoinPath(r.baseURL, r.graphqlPath)
	if err != nil {
		return nil, fmt.Errorf("failed to join graphql endpoint url: %w", err)
	}

	r.logger.Info("GraphQL endpoint",
		zap.String("method", http.MethodPost),
		zap.String("url", graphqlEndpointURL),
	)

	ro.server = &http.Server{
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

// listenAndServe starts the server and blocks until the server is shutdown.
func (r *server) listenAndServe() error {
	if err := r.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
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

// Shutdown gracefully shutdown the server.
func (r *server) Shutdown(ctx context.Context) (err error) {
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

	if r.server != nil {
		// HTTP server shutdown
		if err := r.server.Shutdown(ctx); err != nil {
			return err
		}
	}

	return err
}

func (r *server) HealthChecks() health.Checker {
	return r.healthChecks
}

func (r *server) HttpServer() *http.Server {
	return r.server
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
