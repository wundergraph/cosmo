package core

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/mitchellh/mapstructure"
	"github.com/nats-io/nuid"
	"github.com/wundergraph/cosmo/router/internal/track"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/circuit"
	"github.com/wundergraph/cosmo/router/internal/debug"
	"github.com/wundergraph/cosmo/router/internal/docker"
	"github.com/wundergraph/cosmo/router/internal/graphiql"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage/cdn"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage/fs"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage/s3"
	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/stringsx"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"github.com/wundergraph/cosmo/router/pkg/mcpserver"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/cosmo/router/pkg/watcher"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/netpoll"
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
		httpServer           *server
		modules              []Module
		EngineStats          statistics.EngineStatistics
		playgroundHandler    func(http.Handler) http.Handler
		proxy                ProxyFunc
		disableUsageTracking bool
		usage                UsageTracker
	}

	UsageTracker interface {
		Close()
		TrackUptime(ctx context.Context)
		TrackRouterConfigUsage(usage map[string]any)
		TrackExecutionConfigUsage(usage map[string]any)
	}

	TransportRequestOptions struct {
		RequestTimeout         time.Duration
		ResponseHeaderTimeout  time.Duration
		ExpectContinueTimeout  time.Duration
		KeepAliveIdleTimeout   time.Duration
		DialTimeout            time.Duration
		TLSHandshakeTimeout    time.Duration
		KeepAliveProbeInterval time.Duration

		MaxConnsPerHost     int
		MaxIdleConns        int
		MaxIdleConnsPerHost int
	}

	SubgraphTransportOptions struct {
		*TransportRequestOptions
		SubgraphMap map[string]*TransportRequestOptions
	}

	GraphQLMetricsConfig struct {
		Enabled           bool
		CollectorEndpoint string
	}

	BatchingConfig struct {
		Enabled               bool
		MaxConcurrentRoutines int
		MaxEntriesPerBatch    int
		OmitExtensions        bool
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
		PollJitter   time.Duration
		GraphSignKey string
	}

	ExecutionConfig struct {
		Watch         bool
		WatchInterval time.Duration
		Path          string
	}

	AccessLogsConfig struct {
		Attributes            []config.CustomAttribute
		Logger                *zap.Logger
		SubgraphEnabled       bool
		SubgraphAttributes    []config.CustomAttribute
		IgnoreQueryParamsList []string
	}

	// Option defines the method to customize server.
	Option func(svr *Router)
)

type SubgraphCircuitBreakerOptions struct {
	CircuitBreaker circuit.CircuitBreakerConfig
	SubgraphMap    map[string]circuit.CircuitBreakerConfig
}

func (r *SubgraphCircuitBreakerOptions) IsEnabled() bool {
	if r == nil {
		return false
	}
	return r.CircuitBreaker.Enabled || len(r.SubgraphMap) > 0
}

// NewRouter creates a new Router instance. Router.Start() must be called to start the server.
// Alternatively, use Router.NewServer() to create a new server instance without starting it.
func NewRouter(opts ...Option) (*Router, error) {
	r := &Router{
		EngineStats: statistics.NewNoopEngineStats(),
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

	// this is set via the deprecated method
	if !r.playground {
		r.playgroundConfig.Enabled = r.playground
		r.logger.Warn("The playground_enabled option is deprecated. Use the playground.enabled option in the config instead.")
	}
	if r.playgroundPath != "" && r.playgroundPath != "/" {
		r.playgroundConfig.Path = r.playgroundPath
		r.logger.Warn("The playground_path option is deprecated. Use the playground.path option in the config instead.")
	}

	if r.playgroundConfig.Path == "" {
		r.playgroundConfig.Path = "/"
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

	if r.accessController != nil {
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

	r.headerRules = AddCacheControlPolicyToRules(r.headerRules, r.cacheControlPolicy)
	hr, err := NewHeaderPropagation(r.headerRules)
	if err != nil {
		return nil, err
	}

	if hr.HasRequestRules() {
		r.preOriginHandlers = append(r.preOriginHandlers, hr.OnOriginRequest)
	}
	if hr.HasResponseRules() {
		r.postOriginHandlers = append(r.postOriginHandlers, hr.OnOriginResponse)
	}

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
		"x-wg-disable-tracing",
		"x-wg-token",
		"x-wg-skip-loader",
		"x-wg-include-query-plan",
		// Required for Trace Context propagation
		"traceparent",
		"tracestate",
		// Required for feature flags
		"x-feature-flag",
	}

	if r.clientHeader.Name != "" {
		defaultHeaders = append(defaultHeaders, r.clientHeader.Name)
	}
	if r.clientHeader.Version != "" {
		defaultHeaders = append(defaultHeaders, r.clientHeader.Version)
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

	if r.traceConfig.Enabled {
		if len(r.traceConfig.Propagators) > 0 {
			propagators, err := rtrace.BuildPropagators(r.traceConfig.Propagators...)
			if err != nil {
				r.logger.Error("creating propagators", zap.Error(err))
				return nil, err
			}

			r.tracePropagators = propagators
		}

		// Add default tracing exporter if needed
		if len(r.traceConfig.Exporters) == 0 && r.traceConfig.TestMemoryExporter == nil {
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

	if r.persistedOperationsConfig.Safelist.Enabled && r.automaticPersistedQueriesConfig.Enabled {
		return nil, errors.New("automatic persisted queries and safelist cannot be enabled at the same time (as APQ would permit queries that are not in the safelist)")
	}

	if r.securityConfiguration.BlockPersistedOperations.Enabled &&
		r.securityConfiguration.BlockNonPersistedOperations.Enabled {

		// Both have no condition, unusable state
		if r.securityConfiguration.BlockPersistedOperations.Condition == "" &&
			r.securityConfiguration.BlockNonPersistedOperations.Condition == "" {
			return nil, errors.New("persisted and non-persisted operations are both unconditionally blocked")
		}

		// One or both have a condition, could be intentional for edge cases
		r.logger.Warn("The security configuration fields 'block_persisted_operations' and 'block_non_persisted_operations' are both enabled. Take care to ensure this is intentional.")
	}

	if r.persistedOperationsConfig.Safelist.Enabled && r.securityConfiguration.BlockPersistedOperations.Enabled {
		// Both have no condition, unusable state
		if r.securityConfiguration.BlockPersistedOperations.Condition == "" {
			return nil, errors.New("safelist cannot be enabled while persisted operations are unconditionally blocked")
		}

		// Has a condition, could be intentional for edge cases
		r.logger.Warn("The security configuration field 'block_persisted_operations' is enabled alongside the persisted operations safelist. Take care to ensure this is intentional. Misconfiguration will result in safelisted queries being blocked.")
	}

	if r.securityConfiguration.DepthLimit != nil {
		r.logger.Warn("The security configuration field 'depth_limit' is deprecated, and will be removed. Use 'security.complexity_limits.depth' instead.")

		if r.securityConfiguration.ComplexityCalculationCache == nil {
			r.securityConfiguration.ComplexityCalculationCache = &config.ComplexityCalculationCache{
				Enabled:   true,
				CacheSize: r.securityConfiguration.DepthLimit.CacheSize,
			}
		}

		if r.securityConfiguration.ComplexityLimits == nil {
			r.securityConfiguration.ComplexityLimits = &config.ComplexityLimits{}
		}
		if r.securityConfiguration.ComplexityLimits.Depth == nil {
			r.securityConfiguration.ComplexityLimits.Depth = &config.ComplexityLimit{
				Enabled:                   r.securityConfiguration.DepthLimit.Enabled,
				Limit:                     r.securityConfiguration.DepthLimit.Limit,
				IgnorePersistedOperations: r.securityConfiguration.DepthLimit.IgnorePersistedOperations,
			}
		} else {
			r.logger.Warn("Ignoring deprecated security configuration field 'depth_limit', in favor of the `security_complexity_limits.depth` configuration")
		}
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
		r.logger.Info("Nats Event source enabled", zap.String("provider_id", source.ID))
	}
	for _, source := range r.eventsConfig.Providers.Kafka {
		r.logger.Info("Kafka Event source enabled", zap.String("provider_id", source.ID), zap.Strings("brokers", source.Brokers))
	}

	if !r.engineExecutionConfiguration.EnableNetPoll {
		r.logger.Warn("Net poller is disabled by configuration. Falling back to less efficient connection handling method.")
	} else if err := netpoll.Supported(); err != nil {

		// Disable netPoll if it's not supported. This flag is used everywhere to decide whether to use netPoll or not.
		r.engineExecutionConfiguration.EnableNetPoll = false

		if errors.Is(err, netpoll.ErrUnsupported) {
			r.logger.Warn(
				"Net poller is only available on Linux and MacOS. Falling back to less efficient connection handling method.",
				zap.Error(err),
			)
		} else {
			r.logger.Warn(
				"Net poller is not functional by the environment. Ensure that the system supports epoll/kqueue and that necessary syscall permissions are granted. Falling back to less efficient connection handling method.",
				zap.Error(err),
			)
		}
	}

	if r.hostName == "" {
		r.hostName, err = os.Hostname()
		if err != nil {
			r.logger.Warn("Failed to get hostname", zap.Error(err))
		}
	}

	return r, nil
}

// newGraphServer creates a new server.
func (r *Router) newServer(ctx context.Context, cfg *nodev1.RouterConfig) error {
	server, err := newGraphServer(ctx, r, cfg, r.proxy)
	if err != nil {
		r.logger.Error("Failed to create graph server. Keeping the old server", zap.Error(err))
		return err
	}

	r.httpServer.SwapGraphServer(ctx, server)

	return nil
}

func (r *Router) listenAndServe() error {
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
	moduleList := make([]ModuleInfo, 0, len(modules)+len(r.customModules))

	for _, module := range modules {
		moduleList = append(moduleList, module)
	}

	for _, module := range r.customModules {
		moduleList = append(moduleList, module.Module())
	}

	moduleList = sortModules(moduleList)

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

		if fn, ok := moduleInstance.(RouterOnRequestHandler); ok {
			r.routerOnRequestHandlers = append(r.routerOnRequestHandlers, func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
					reqContext := getRequestContext(request.Context())
					// Ensure we work with latest request in the chain to work with the right context
					reqContext.request = request
					fn.RouterOnRequest(reqContext, handler)
				})
			})
		}

		if handler, ok := moduleInstance.(EnginePreOriginHandler); ok {
			r.preOriginHandlers = append(r.preOriginHandlers, handler.OnOriginRequest)
		}

		if handler, ok := moduleInstance.(EnginePostOriginHandler); ok {
			r.postOriginHandlers = append(r.postOriginHandlers, handler.OnOriginResponse)
		}

		if handler, ok := moduleInstance.(TracePropagationProvider); ok {
			modulePropagators := handler.TracePropagators()
			if len(modulePropagators) > 0 {
				r.tracePropagators = append(r.tracePropagators, modulePropagators...)
			}
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
		addr:               r.listenAddr,
		logger:             r.logger,
		tlsConfig:          r.tlsConfig,
		tlsServerConfig:    r.tlsServerConfig,
		healthcheck:        r.healthcheck,
		baseURL:            r.baseURL,
		maxHeaderBytes:     int(r.routerTrafficConfig.MaxHeaderBytes.Uint64()),
		livenessCheckPath:  r.livenessCheckPath,
		readinessCheckPath: r.readinessCheckPath,
		healthCheckPath:    r.healthCheckPath,
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
// It should only be called once for a Router instance.
func (r *Router) bootstrap(ctx context.Context) error {
	if !r.bootstrapped.CompareAndSwap(false, true) {
		return fmt.Errorf("router is already bootstrapped")
	}

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

	if r.graphqlMetricsConfig.Enabled {
		client := graphqlmetricsv1connect.NewGraphQLMetricsServiceClient(
			http.DefaultClient,
			r.graphqlMetricsConfig.CollectorEndpoint,
			connect.WithSendGzip(),
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
		var err error
		r.redisClient, err = rd.NewRedisCloser(&rd.RedisCloserOptions{
			URLs:           r.Config.rateLimit.Storage.URLs,
			ClusterEnabled: r.Config.rateLimit.Storage.ClusterEnabled,
			Logger:         r.logger,
		})
		if err != nil {
			return fmt.Errorf("failed to create redis client: %w", err)
		}
	}

	if r.mcp.Enabled {
		var operationsDir string

		// If storage provider ID is set, resolve it to a directory path
		if r.mcp.Storage.ProviderID != "" {
			r.logger.Debug("Resolving storage provider for MCP operations",
				zap.String("provider_id", r.mcp.Storage.ProviderID))

			// Find the provider in storage_providers
			found := false

			// Check for file_system providers
			for _, provider := range r.storageProviders.FileSystem {
				if provider.ID == r.mcp.Storage.ProviderID {
					r.logger.Debug("Found file_system storage provider for MCP",
						zap.String("id", provider.ID),
						zap.String("path", provider.Path))

					// Use the resolved file system path
					operationsDir = provider.Path
					found = true
					break
				}
			}

			if !found {
				return fmt.Errorf("storage provider with id '%s' for mcp server not found", r.mcp.Storage.ProviderID)
			}
		}

		logFields := []zap.Field{
			zap.String("storage_provider_id", r.mcp.Storage.ProviderID),
		}

		// Initialize the MCP server with the resolved operations directory
		mcpOpts := []func(*mcpserver.Options){
			mcpserver.WithGraphName(r.mcp.GraphName),
			mcpserver.WithOperationsDir(operationsDir),
			mcpserver.WithListenAddr(r.mcp.Server.ListenAddr),
			mcpserver.WithBaseURL(r.mcp.Server.BaseURL),
			mcpserver.WithLogger(r.logger.With(logFields...)),
			mcpserver.WithExcludeMutations(r.mcp.ExcludeMutations),
			mcpserver.WithEnableArbitraryOperations(r.mcp.EnableArbitraryOperations),
			mcpserver.WithExposeSchema(r.mcp.ExposeSchema),
			mcpserver.WithStateless(r.mcp.Session.Stateless),
		}

		// Determine the router GraphQL endpoint
		var routerGraphQLEndpoint string

		// Use the custom URL if provided
		if r.mcp.RouterURL != "" {
			routerGraphQLEndpoint = r.mcp.RouterURL
		} else {
			routerGraphQLEndpoint = path.Join(r.listenAddr, r.graphqlPath)
		}

		mcpss, err := mcpserver.NewGraphQLSchemaServer(
			routerGraphQLEndpoint,
			mcpOpts...,
		)
		if err != nil {
			return fmt.Errorf("failed to create mcp server: %w", err)
		}

		err = mcpss.Start()
		if err != nil {
			return fmt.Errorf("failed to start MCP server: %w", err)
		}

		r.mcpServer = mcpss
	}

	if r.metricConfig.OpenTelemetry.EngineStats.Enabled() || r.metricConfig.Prometheus.EngineStats.Enabled() || r.engineExecutionConfiguration.Debug.ReportWebSocketConnections {
		r.EngineStats = statistics.NewEngineStats(ctx, r.logger, r.engineExecutionConfiguration.Debug.ReportWebSocketConnections)
	}

	if r.engineExecutionConfiguration.Debug.ReportMemoryUsage {
		debug.ReportMemoryUsage(ctx, r.logger)
	}

	if r.playgroundConfig.Enabled {
		playgroundUrl, err := url.JoinPath(r.baseURL, r.playgroundConfig.Path)
		if err != nil {
			return fmt.Errorf("failed to join playground url: %w", err)
		}
		r.logger.Info("Serving GraphQL playground", zap.String("url", playgroundUrl))
		r.playgroundHandler = graphiql.NewPlayground(&graphiql.PlaygroundOptions{
			Html:             graphiql.PlaygroundHTML(),
			GraphqlURL:       r.graphqlWebURL,
			PlaygroundPath:   r.playgroundPath,
			ConcurrencyLimit: int64(r.playgroundConfig.ConcurrencyLimit),
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

	if r.traceConfig.Enabled && len(r.tracePropagators) > 0 {
		r.compositePropagator = propagation.NewCompositeTextMapPropagator(r.tracePropagators...)

		// Don't set it globally when we use the router in tests.
		// In practice, setting it globally only makes sense for module development.
		if r.traceConfig.TestMemoryExporter == nil {
			otel.SetTextMapPropagator(r.compositePropagator)
		}
	}

	return nil
}

// buildClients initializes the storage clients for persisted operations and router config.
func (r *Router) buildClients() error {
	s3Providers := map[string]config.S3StorageProvider{}
	cdnProviders := map[string]config.CDNStorageProvider{}
	redisProviders := map[string]config.RedisStorageProvider{}
	fileSystemProviders := map[string]config.FileSystemStorageProvider{}

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

	for _, provider := range r.storageProviders.Redis {
		if _, ok := redisProviders[provider.ID]; ok {
			return fmt.Errorf("duplicate Redis storage provider with id '%s'", provider.ID)
		}
		redisProviders[provider.ID] = provider
	}

	for _, provider := range r.storageProviders.FileSystem {
		if _, ok := fileSystemProviders[provider.ID]; ok {
			return fmt.Errorf("duplicate file system storage provider with id '%s'", provider.ID)
		}
		fileSystemProviders[provider.ID] = provider
	}

	var pClient persistedoperation.StorageClient

	if !r.persistedOperationsConfig.Disabled {
		if provider, ok := cdnProviders[r.persistedOperationsConfig.Storage.ProviderID]; ok {
			if r.graphApiToken == "" {
				return errors.New("graph token is required to fetch persisted operations from CDN")
			}

			c, err := cdn.NewClient(provider.URL, r.graphApiToken, cdn.Options{
				Logger: r.logger,
			})
			if err != nil {
				return err
			}
			pClient = c

			r.logger.Info("Use CDN as storage provider for persisted operations",
				zap.String("provider_id", provider.ID),
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
				zap.String("provider_id", provider.ID),
			)
		} else if provider, ok := fileSystemProviders[r.persistedOperationsConfig.Storage.ProviderID]; ok {
			c, err := fs.NewClient(provider.Path, &fs.Options{
				ObjectPathPrefix: r.persistedOperationsConfig.Storage.ObjectPrefix,
			})
			if err != nil {
				return err
			}
			pClient = c

			r.logger.Info("Use file system as storage provider for persisted operations",
				zap.String("provider_id", provider.ID),
			)
		} else if r.graphApiToken != "" {
			if r.persistedOperationsConfig.Storage.ProviderID != "" {
				return fmt.Errorf("unknown storage provider id '%s' for persisted operations", r.persistedOperationsConfig.Storage.ProviderID)
			}

			c, err := cdn.NewClient(r.cdnConfig.URL, r.graphApiToken, cdn.Options{
				Logger: r.logger,
			})
			if err != nil {
				return err
			}
			pClient = c

			r.logger.Debug("Default to Cosmo CDN as persisted operations provider",
				zap.String("url", r.cdnConfig.URL),
			)
		}
	}

	var kvClient apq.KVClient
	if provider, ok := redisProviders[r.automaticPersistedQueriesConfig.Storage.ProviderID]; ok {
		c, err := apq.NewRedisClient(&apq.RedisOptions{
			Logger:        r.logger,
			StorageConfig: &provider,
			Prefix:        r.automaticPersistedQueriesConfig.Storage.ObjectPrefix,
		})
		if err != nil {
			return err
		}
		kvClient = c
		r.logger.Info("Use redis as storage provider for automatic persisted operations",
			zap.String("provider_id", provider.ID),
		)
	}

	var apqClient apq.Client
	if r.automaticPersistedQueriesConfig.Enabled {
		var err error
		apqClient, err = apq.NewClient(&apq.Options{
			Logger:    r.logger,
			ApqConfig: &r.automaticPersistedQueriesConfig,
			KVClient:  kvClient,
		})
		if err != nil {
			return err
		}
	}

	if pClient != nil || apqClient != nil {
		// For backwards compatibility with cdn config field
		cacheSize := r.persistedOperationsConfig.Cache.Size.Uint64()
		if cacheSize <= 0 {
			cacheSize = r.cdnConfig.CacheSize.Uint64()
		}

		c, err := persistedoperation.NewClient(&persistedoperation.Options{
			CacheSize:      cacheSize,
			Logger:         r.logger,
			ProviderClient: pClient,
			ApqClient:      apqClient,
		})
		if err != nil {
			return err
		}

		r.persistedOperationClient = c
	}

	configPoller, err := InitializeConfigPoller(r, cdnProviders, s3Providers)
	if err != nil {
		return err
	}
	if configPoller != nil {
		r.configPoller = *configPoller
	}

	return nil
}

// Start starts the router. It does block until the router has been initialized. After that the server is listening
// on a separate goroutine. The server can be shutdown with Router.Shutdown(). Not safe for concurrent use.
// During initialization, the router will register itself with the control plane and poll the config from the CDN
// if the user opted in to connect to Cosmo Cloud.
func (r *Router) Start(ctx context.Context) error {
	if r.shutdown.Load() {
		return fmt.Errorf("router is shutdown. Create a new instance with router.NewRouter()")
	}

	if err := r.bootstrap(ctx); err != nil {
		return fmt.Errorf("failed to bootstrap router: %w", err)
	}

	if err := r.configureUsageTracking(ctx); err != nil {
		return err
	}

	r.trackRouterConfigUsage()

	r.httpServer = newServer(&httpServerOptions{
		addr:               r.listenAddr,
		logger:             r.logger,
		tlsConfig:          r.tlsConfig,
		tlsServerConfig:    r.tlsServerConfig,
		healthcheck:        r.healthcheck,
		baseURL:            r.baseURL,
		maxHeaderBytes:     int(r.routerTrafficConfig.MaxHeaderBytes.Uint64()),
		livenessCheckPath:  r.livenessCheckPath,
		readinessCheckPath: r.readinessCheckPath,
		healthCheckPath:    r.healthCheckPath,
	})

	// Start the server with the static config without polling
	if r.staticExecutionConfig != nil {

		r.trackExecutionConfigUsage(r.staticExecutionConfig, true)

		if err := r.listenAndServe(); err != nil {
			return err
		}

		if err := r.newServer(ctx, r.staticExecutionConfig); err != nil {
			return err
		}

		defer func() {
			r.httpServer.healthcheck.SetReady(true)

			r.logger.Info("Server initialized and ready to serve requests",
				zap.String("listen_addr", r.listenAddr),
				zap.Bool("playground", r.playgroundConfig.Enabled),
				zap.Bool("introspection", r.introspection),
				zap.String("config_version", r.staticExecutionConfig.Version),
			)
		}()

		if r.executionConfig != nil && r.executionConfig.Watch {
			ll := r.logger.With(zap.String("watcher_label", "execution_config"))

			w, err := watcher.New(watcher.Options{
				Logger:   ll,
				Paths:    []string{r.executionConfig.Path},
				Interval: r.executionConfig.WatchInterval,
				Callback: func() {
					if r.shutdown.Load() {
						ll.Warn("Router is in shutdown state. Skipping config update")
						return
					}

					data, err := os.ReadFile(r.executionConfig.Path)
					if err != nil {
						ll.Error("Failed to read config file", zap.Error(err))
						return
					}

					ll.Info("Config file changed. Updating server with new config", zap.String("path", r.executionConfig.Path))

					cfg, err := execution_config.UnmarshalConfig(data)
					if err != nil {
						ll.Error("Failed to unmarshal config file", zap.Error(err))
						return
					}

					if err := r.newServer(ctx, cfg); err != nil {
						ll.Error("Failed to update server with new config", zap.Error(err))
						return
					}
				},
			})

			if err != nil {
				return fmt.Errorf("failed to create watcher: %w", err)
			}

			go func() {
				if err := w(ctx); err != nil {
					if !errors.Is(err, context.Canceled) {
						ll.Error("Error watching execution config", zap.Error(err))
					} else {
						ll.Debug("Watcher context cancelled, shutting down")
					}
				}
			}()

			r.logger.Info("Watching config file for changes. Router will hot-reload automatically without downtime",
				zap.String("path", r.executionConfig.Path),
			)

			return nil
		}

		r.logger.Info("Static execution config provided. Polling and watching is disabled. Updating execution config is only possible by restarting the router")

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

	r.trackExecutionConfigUsage(cfg.Config, false)

	if err := r.listenAndServe(); err != nil {
		r.logger.Error("Failed to start server with initial config", zap.Error(err))
		return err
	}

	if err := r.newServer(ctx, cfg.Config); err != nil {
		return err
	}

	if r.playgroundConfig.Enabled {
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

	r.configPoller.Subscribe(ctx, func(newConfig *nodev1.RouterConfig, oldVersion string) error {
		if r.shutdown.Load() {
			r.logger.Warn("Router is in shutdown state. Skipping config update")
			return nil
		}

		r.trackExecutionConfigUsage(newConfig, false)

		if err := r.newServer(ctx, newConfig); err != nil {
			return err
		}

		return nil
	})

	// Mark the server as ready
	r.httpServer.healthcheck.SetReady(true)

	r.logger.Info("Server initialized and ready to serve requests",
		zap.String("listen_addr", r.listenAddr),
		zap.Bool("playground", r.playgroundConfig.Enabled),
		zap.Bool("introspection", r.introspection),
		zap.String("config_version", cfg.Config.GetVersion()),
	)

	return nil
}

type UsageTrackerNoOp struct{}

func (u *UsageTrackerNoOp) TrackExecutionConfigUsage(_ map[string]any) {}

func (u *UsageTrackerNoOp) TrackRouterConfigUsage(_ map[string]any) {}

func (u *UsageTrackerNoOp) Close() {}

func (u *UsageTrackerNoOp) TrackUptime(_ context.Context) {}

func (r *Router) configureUsageTracking(ctx context.Context) (err error) {
	if r.disableUsageTracking {
		r.usage = &UsageTrackerNoOp{}
		return nil
	}
	if os.Getenv("COSMO_TELEMETRY_DISABLED") == "true" || os.Getenv("DO_NOT_TRACK") == "1" {
		r.usage = &UsageTrackerNoOp{}
		r.logger.Info("Usage tracking is disabled.")
		return nil
	}
	cfg := track.UsageTrackerConfig{
		GraphApiToken: r.graphApiToken,
		Version:       Version,
		Commit:        Commit,
		Date:          Date,
		InstanceID:    r.instanceID,
		ClusterName:   r.clusterName,
	}
	r.usage, err = track.NewUsageTracker(r.logger, cfg)
	if err != nil {
		return fmt.Errorf("failed to create usage tracker: %w", err)
	}
	go r.usage.TrackUptime(ctx)
	return nil
}

func (r *Router) trackRouterConfigUsage() {
	r.usage.TrackRouterConfigUsage(r.Config.Usage())
}

type concSafeErrorJoiner struct {
	errs []error
	mu   sync.Mutex
}

func (e *concSafeErrorJoiner) Append(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.errs = append(e.errs, err)
}

func (e *concSafeErrorJoiner) ErrOrNil() error {
	return errors.Join(e.errs...)
}

// Shutdown gracefully shuts down the router. It blocks until the server is shutdown.
// If the router is already shutdown, the method returns immediately without error.
func (r *Router) Shutdown(ctx context.Context) error {
	var err concSafeErrorJoiner

	if !r.shutdown.CompareAndSwap(false, true) {
		return nil
	}

	// Respect grace period
	if r.routerGracePeriod > 0 {
		ctxWithTimer, cancel := context.WithTimeout(ctx, r.routerGracePeriod)
		defer cancel()

		ctx = ctxWithTimer
	}

	if r.configPoller != nil {
		if subErr := r.configPoller.Stop(ctx); subErr != nil {
			err.Append(fmt.Errorf("failed to stop config poller: %w", subErr))
		}
	}

	if r.httpServer != nil {
		if subErr := r.httpServer.Shutdown(ctx); subErr != nil {
			if errors.Is(subErr, context.DeadlineExceeded) {
				r.logger.Warn(
					"Shutdown deadline exceeded. Router took too long to shutdown. Consider increasing the grace period",
					zap.Duration("grace_period", r.routerGracePeriod),
				)
			}
			err.Append(fmt.Errorf("failed to shutdown router: %w", subErr))
		}
	}

	var wg sync.WaitGroup

	if r.prometheusServer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if subErr := r.prometheusServer.Close(); subErr != nil {
				err.Append(fmt.Errorf("failed to shutdown prometheus server: %w", subErr))
			}
		}()
	}

	if r.mcpServer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if subErr := r.mcpServer.Stop(ctx); subErr != nil {
				err.Append(fmt.Errorf("failed to shutdown mcp server: %w", subErr))
			}
		}()
	}

	if r.tracerProvider != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.tracerProvider.Shutdown(ctx); subErr != nil {
				err.Append(fmt.Errorf("failed to shutdown tracer: %w", subErr))
			}
		}()
	}

	if r.gqlMetricsExporter != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.gqlMetricsExporter.Shutdown(ctx); subErr != nil {
				err.Append(fmt.Errorf("failed to shutdown graphql metrics exporter: %w", subErr))
			}
		}()
	}

	if r.promMeterProvider != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.promMeterProvider.Shutdown(ctx); subErr != nil {
				err.Append(fmt.Errorf("failed to shutdown prometheus meter provider: %w", subErr))
			}
		}()
	}

	if r.otlpMeterProvider != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if subErr := r.otlpMeterProvider.Shutdown(ctx); subErr != nil {
				err.Append(fmt.Errorf("failed to shutdown OTLP meter provider: %w", subErr))
			}
		}()
	}

	if r.redisClient != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if closeErr := r.redisClient.Close(); closeErr != nil {
				err.Append(fmt.Errorf("failed to close redis client: %w", closeErr))
			}
		}()
	}

	wg.Add(1)
	go func() {
		defer wg.Done()

		for _, module := range r.modules {
			if cleaner, ok := module.(Cleaner); ok {
				if subErr := cleaner.Cleanup(); subErr != nil {
					err.Append(fmt.Errorf("failed to clean module %s: %w", module.Module().ID, subErr))
				}
			}
		}
	}()

	// Shutdown the CDN operation client and free up resources
	if r.persistedOperationClient != nil {
		r.persistedOperationClient.Close()
	}

	r.usage.Close()

	wg.Wait()

	return err.ErrOrNil()
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

func WithQueryPlans(enabled bool) Option {
	return func(r *Router) {
		r.queryPlansEnabled = enabled
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

// WithSubscriptionHeartbeatInterval sets the interval for the engine to send heartbeats for multipart subscriptions.
func WithSubscriptionHeartbeatInterval(interval time.Duration) Option {
	return func(r *Router) {
		r.subscriptionHeartbeatInterval = interval
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

// WithPlaygroundConfig sets the path where the GraphQL Playground is served.
func WithPlaygroundConfig(c config.PlaygroundConfig) Option {
	return func(r *Router) {
		r.playgroundConfig = c
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

func WithProxy(proxy ProxyFunc) Option {
	return func(r *Router) {
		r.proxy = proxy
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
		r.headerRules = &headers
	}
}

func WithCacheControlPolicy(cfg config.CacheControlPolicy) Option {
	return func(r *Router) {
		r.cacheControlPolicy = cfg
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

func WithCustomModules(modules ...Module) Option {
	return func(r *Router) {
		r.customModules = modules
	}
}

func WithSubgraphTransportOptions(opts *SubgraphTransportOptions) Option {
	return func(r *Router) {
		r.subgraphTransportOptions = opts
	}
}

func WithSubgraphCircuitBreakerOptions(opts *SubgraphCircuitBreakerOptions) Option {
	return func(r *Router) {
		r.subgraphCircuitBreakerOptions = opts
	}
}

func WithSubgraphRetryOptions(
	enabled bool,
	algorithm string,
	maxRetryCount int,
	retryMaxDuration, retryInterval time.Duration,
	expression string,
	onRetryFunc retrytransport.OnRetryFunc,
) Option {
	return func(r *Router) {
		r.retryOptions = retrytransport.RetryOptions{
			Enabled:       enabled,
			Algorithm:     algorithm,
			MaxRetryCount: maxRetryCount,
			MaxDuration:   retryMaxDuration,
			Interval:      retryInterval,
			Expression:    expression,

			// Test case overrides
			OnRetry: onRetryFunc,
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

func WithDisableUsageTracking() Option {
	return func(r *Router) {
		r.disableUsageTracking = true
	}
}

func DefaultRouterTrafficConfig() *config.RouterTrafficConfiguration {
	return &config.RouterTrafficConfiguration{
		MaxRequestBodyBytes:        1000 * 1000 * 5, // 5 MB
		ResponseCompressionMinSize: 1024 * 4,        // 4 KiB
	}
}

func DefaultFileUploadConfig() *config.FileUpload {
	return &config.FileUpload{
		Enabled:          true,
		MaxFileSizeBytes: 1000 * 1000 * 50, // 50 MB,
		MaxFiles:         10,
	}
}

// NewTransportRequestOptions creates a new TransportRequestOptions instance with the given configuration and defaults.
// If defaults is nil, it uses the global default values.
func NewTransportRequestOptions(cfg config.GlobalSubgraphRequestRule, defaults *TransportRequestOptions) *TransportRequestOptions {
	if defaults == nil {
		defaults = DefaultTransportRequestOptions()
	}

	return &TransportRequestOptions{
		RequestTimeout:         or(cfg.RequestTimeout, defaults.RequestTimeout),
		TLSHandshakeTimeout:    or(cfg.TLSHandshakeTimeout, defaults.TLSHandshakeTimeout),
		ResponseHeaderTimeout:  or(cfg.ResponseHeaderTimeout, defaults.ResponseHeaderTimeout),
		ExpectContinueTimeout:  or(cfg.ExpectContinueTimeout, defaults.ExpectContinueTimeout),
		KeepAliveProbeInterval: or(cfg.KeepAliveProbeInterval, defaults.KeepAliveProbeInterval),
		KeepAliveIdleTimeout:   or(cfg.KeepAliveIdleTimeout, defaults.KeepAliveIdleTimeout),
		DialTimeout:            or(cfg.DialTimeout, defaults.DialTimeout),
		MaxConnsPerHost:        or(cfg.MaxConnsPerHost, defaults.MaxConnsPerHost),
		MaxIdleConns:           or(cfg.MaxIdleConns, defaults.MaxIdleConns),
		MaxIdleConnsPerHost:    or(cfg.MaxIdleConnsPerHost, defaults.MaxIdleConnsPerHost),
	}
}

func DefaultTransportRequestOptions() *TransportRequestOptions {
	return &TransportRequestOptions{
		RequestTimeout:         60 * time.Second,
		TLSHandshakeTimeout:    10 * time.Second,
		ResponseHeaderTimeout:  0 * time.Second,
		ExpectContinueTimeout:  0 * time.Second,
		KeepAliveProbeInterval: 30 * time.Second,
		KeepAliveIdleTimeout:   90 * time.Second,
		DialTimeout:            30 * time.Second,

		MaxConnsPerHost:     100,
		MaxIdleConns:        1024,
		MaxIdleConnsPerHost: 20,
	}
}

func NewSubgraphTransportOptions(cfg config.TrafficShapingRules) *SubgraphTransportOptions {
	allRequestOptions := NewTransportRequestOptions(cfg.All, nil)

	base := &SubgraphTransportOptions{
		TransportRequestOptions: allRequestOptions,
		SubgraphMap:             map[string]*TransportRequestOptions{},
	}

	for k, v := range cfg.Subgraphs {
		base.SubgraphMap[k] = NewTransportRequestOptions(v, allRequestOptions)
	}

	return base
}

func NewSubgraphCircuitBreakerOptions(cfg config.TrafficShapingRules) *SubgraphCircuitBreakerOptions {
	entry := &SubgraphCircuitBreakerOptions{
		SubgraphMap: map[string]circuit.CircuitBreakerConfig{},
	}
	// If we have a global default
	if cfg.All.CircuitBreaker.Enabled {
		entry.CircuitBreaker = newCircuitBreakerConfig(cfg.All.CircuitBreaker)
	}
	// Subgraph specific circuit breakers
	for k, v := range cfg.Subgraphs {
		entry.SubgraphMap[k] = newCircuitBreakerConfig(v.CircuitBreaker)

	}

	return entry
}

func newCircuitBreakerConfig(cb config.CircuitBreaker) circuit.CircuitBreakerConfig {
	return circuit.CircuitBreakerConfig{
		Enabled:                    cb.Enabled,
		ErrorThresholdPercentage:   cb.ErrorThresholdPercentage,
		RequestThreshold:           cb.RequestThreshold,
		SleepWindow:                cb.SleepWindow,
		HalfOpenAttempts:           cb.HalfOpenAttempts,
		RequiredSuccessfulAttempts: cb.RequiredSuccessfulAttempts,
		RollingDuration:            cb.RollingDuration,
		NumBuckets:                 cb.NumBuckets,
		ExecutionTimeout:           cb.ExecutionTimeout,
		MaxConcurrentRequests:      cb.MaxConcurrentRequests,
	}
}

func DefaultSubgraphTransportOptions() *SubgraphTransportOptions {
	return &SubgraphTransportOptions{
		TransportRequestOptions: DefaultTransportRequestOptions(),
		SubgraphMap:             map[string]*TransportRequestOptions{},
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

func WithBatching(cfg *BatchingConfig) Option {
	return func(r *Router) {
		r.batchingConfig = cfg
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

func WithAccessLogs(cfg *AccessLogsConfig) Option {
	return func(r *Router) {
		r.accessLogsConfig = cfg
	}
}

func WithTLSConfig(cfg *TlsConfig) Option {
	return func(r *Router) {
		r.tlsConfig = cfg
	}
}

func WithTelemetryAttributes(attributes []config.CustomAttribute) Option {
	return func(r *Router) {
		r.telemetryAttributes = attributes
	}
}

func WithTracingAttributes(attributes []config.CustomAttribute) Option {
	return func(r *Router) {
		r.tracingAttributes = attributes
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

func WithAutomatedPersistedQueriesConfig(cfg config.AutomaticPersistedQueriesConfig) Option {
	return func(r *Router) {
		r.automaticPersistedQueriesConfig = cfg
	}
}

func WithApolloCompatibilityFlagsConfig(cfg config.ApolloCompatibilityFlags) Option {
	return func(r *Router) {
		if cfg.EnableAll {
			cfg.ValueCompletion.Enabled = true
			cfg.TruncateFloats.Enabled = true
			cfg.SuppressFetchErrors.Enabled = true
			cfg.ReplaceInvalidVarErrors.Enabled = true
			cfg.ReplaceValidationErrorStatus.Enabled = true
			cfg.SubscriptionMultipartPrintBoundary.Enabled = true
			cfg.UseGraphQLValidationFailedStatus.Enabled = true
		}

		if cfg.ReplaceUndefinedOpFieldErrors.Enabled {
			cfg.UseGraphQLValidationFailedStatus.Enabled = true
			r.logger.Warn("option apollo_compatibility_flags/replace_undefined_op_field_errors is deprecated, and has automatically been converted to apollo_compatibility_flags/use_graphql_validation_failed_status, please update your configuration")
		}

		r.apolloCompatibilityFlags = cfg
	}
}

func WithApolloRouterCompatibilityFlags(cfg config.ApolloRouterCompatibilityFlags) Option {
	return func(r *Router) {
		r.apolloRouterCompatibilityFlags = cfg
	}
}

func WithStorageProviders(cfg config.StorageProviders) Option {
	return func(r *Router) {
		r.storageProviders = cfg
	}
}

func WithClientHeader(cfg config.ClientHeader) Option {
	return func(r *Router) {
		r.clientHeader = cfg
	}
}

func WithCacheWarmupConfig(cfg *config.CacheWarmupConfiguration) Option {
	return func(r *Router) {
		r.cacheWarmup = cfg
	}
}

func WithMCP(cfg config.MCPConfiguration) Option {
	return func(r *Router) {
		r.mcp = cfg
	}
}

func WithPlugins(cfg config.PluginsConfiguration) Option {
	return func(r *Router) {
		r.plugins = cfg
	}
}

func WithDemoMode(demoMode bool) Option {
	return func(r *Router) {
		r.demoMode = demoMode
	}
}

type ProxyFunc func(req *http.Request) (*url.URL, error)

func newHTTPTransport(opts *TransportRequestOptions, proxy ProxyFunc, traceDialer *TraceDialer, subgraph string) *http.Transport {
	dialer := &net.Dialer{
		Timeout:   opts.DialTimeout,
		KeepAlive: opts.KeepAliveProbeInterval,
	}
	// Great source of inspiration: https://gitlab.com/gitlab-org/gitlab-pages
	// A pages proxy in go that handles tls to upstreams, rate limiting, and more
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, addr)
		},
		// The defaults value 0 = unbounded.
		// We set to some value to prevent resource exhaustion e.g max requests and ports.
		MaxConnsPerHost: opts.MaxConnsPerHost,
		// The defaults value 0 = unbounded. 100 is used by the default go transport.
		// This value should be significant higher than MaxIdleConnsPerHost.
		MaxIdleConns: opts.MaxIdleConns,
		// The default value is 2. Such a low limit will open and close connections too often.
		// Details: https://gitlab.com/gitlab-org/gitlab-pages/-/merge_requests/274
		MaxIdleConnsPerHost: opts.MaxIdleConnsPerHost,
		ForceAttemptHTTP2:   true,
		IdleConnTimeout:     opts.KeepAliveIdleTimeout,
		// Set more timeouts https://gitlab.com/gitlab-org/gitlab-pages/-/issues/495
		TLSHandshakeTimeout:   opts.TLSHandshakeTimeout,
		ResponseHeaderTimeout: opts.ResponseHeaderTimeout,
		ExpectContinueTimeout: opts.ExpectContinueTimeout,
		// Will return nil when HTTP(S)_PROXY does not exist or is empty.
		// This will prevent the transport from handling the proxy when it is not needed.
		Proxy: proxy,
	}

	if traceDialer != nil {
		transport.DialContext = traceDialer.WrapDial(transport.DialContext, subgraph)
		traceDialer.connectionPoolStats.AddSubgraphHostCount(subgraph, int64(opts.MaxConnsPerHost))
	}

	return transport
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
	if cfg.Tracing.Propagation.Datadog {
		propagators = append(propagators, rtrace.PropagatorDatadog)
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
		Attributes:         nil,
		ExportGraphQLVariables: rtrace.ExportGraphQLVariables{
			Enabled: cfg.Tracing.ExportGraphQLVariables,
		},
		ResourceAttributes:  buildResourceAttributes(cfg.ResourceAttributes),
		Exporters:           exporters,
		Propagators:         propagators,
		ResponseTraceHeader: cfg.Tracing.ResponseTraceHeader,
	}
}

// buildAttributesMap returns a map of custom attributes to quickly check if a field is used in the custom attributes.
func buildAttributesMap(attributes []config.CustomAttribute) map[string]string {
	result := make(map[string]string)
	for _, attr := range attributes {
		if attr.ValueFrom != nil && attr.ValueFrom.ContextField != "" {
			result[attr.ValueFrom.ContextField] = attr.Key
		}
	}
	return result
}

// buildHeaderAttributesMapper returns a function that maps custom attributes to the request headers.
func buildHeaderAttributesMapper(attributes []config.CustomAttribute) func(req *http.Request) []attribute.KeyValue {
	if len(attributes) == 0 {
		return nil
	}

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

func buildResourceAttributes(attributes []config.CustomStaticAttribute) []attribute.KeyValue {
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
			Disabled:    exp.Disabled,
			Endpoint:    exp.Endpoint,
			Exporter:    exp.Exporter,
			Headers:     exp.Headers,
			HTTPPath:    exp.HTTPPath,
			Temporality: exp.Temporality,
		})
	}

	return &rmetric.Config{
		Name:               cfg.ServiceName,
		Version:            Version,
		Attributes:         cfg.Metrics.Attributes,
		ResourceAttributes: buildResourceAttributes(cfg.ResourceAttributes),
		CardinalityLimit:   cfg.Metrics.CardinalityLimit,
		OpenTelemetry: rmetric.OpenTelemetry{
			Enabled:         cfg.Metrics.OTLP.Enabled,
			RouterRuntime:   cfg.Metrics.OTLP.RouterRuntime,
			GraphqlCache:    cfg.Metrics.OTLP.GraphqlCache,
			ConnectionStats: cfg.Metrics.OTLP.ConnectionStats,
			EngineStats: rmetric.EngineStatsConfig{
				Subscription: cfg.Metrics.OTLP.EngineStats.Subscriptions,
			},
			Exporters:           openTelemetryExporters,
			CircuitBreaker:      cfg.Metrics.OTLP.CircuitBreaker,
			Streams:             cfg.Metrics.OTLP.Streams,
			ExcludeMetrics:      cfg.Metrics.OTLP.ExcludeMetrics,
			ExcludeMetricLabels: cfg.Metrics.OTLP.ExcludeMetricLabels,
		},
		Prometheus: rmetric.PrometheusConfig{
			Enabled:         cfg.Metrics.Prometheus.Enabled,
			ListenAddr:      cfg.Metrics.Prometheus.ListenAddr,
			Path:            cfg.Metrics.Prometheus.Path,
			GraphqlCache:    cfg.Metrics.Prometheus.GraphqlCache,
			ConnectionStats: cfg.Metrics.Prometheus.ConnectionStats,
			EngineStats: rmetric.EngineStatsConfig{
				Subscription: cfg.Metrics.Prometheus.EngineStats.Subscriptions,
			},
			CircuitBreaker:      cfg.Metrics.Prometheus.CircuitBreaker,
			ExcludeMetrics:      cfg.Metrics.Prometheus.ExcludeMetrics,
			ExcludeMetricLabels: cfg.Metrics.Prometheus.ExcludeMetricLabels,
			Streams:             cfg.Metrics.Prometheus.Streams,
			ExcludeScopeInfo:    cfg.Metrics.Prometheus.ExcludeScopeInfo,
			PromSchemaFieldUsage: rmetric.PrometheusSchemaFieldUsage{
				Enabled:             cfg.Metrics.Prometheus.SchemaFieldUsage.Enabled,
				IncludeOperationSha: cfg.Metrics.Prometheus.SchemaFieldUsage.IncludeOperationSha,
			},
		},
	}
}

func or[T any](maybe *T, or T) T {
	if maybe != nil {
		return *maybe
	}
	return or
}
