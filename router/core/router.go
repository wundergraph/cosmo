package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/dgraph-io/ristretto"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/mitchellh/mapstructure"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/config"
	"github.com/wundergraph/cosmo/router/internal/controlplane"
	graphiql2 "github.com/wundergraph/cosmo/router/internal/graphiql"
	"github.com/wundergraph/cosmo/router/internal/handler/cors"
	"github.com/wundergraph/cosmo/router/internal/handler/health"
	"github.com/wundergraph/cosmo/router/internal/handler/recovery"
	"github.com/wundergraph/cosmo/router/internal/handler/requestlogger"
	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/stringsx"
	"github.com/wundergraph/cosmo/router/internal/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/sync/errgroup"
	"net"
	"net/http"
	"sync"
	"time"
)

type (
	// Router is the main application instance.
	Router struct {
		Config
		activeRouter *Server
		modules      []Module
		mu           sync.Mutex
	}

	// Config defines the configuration options for the Router.
	Config struct {
		transport           *http.Transport
		logger              *zap.Logger
		traceConfig         *trace.Config
		metricConfig        *metric.Config
		tracerProvider      *sdktrace.TracerProvider
		meterProvider       *sdkmetric.MeterProvider
		corsOptions         *cors.Config
		configFetcher       controlplane.ConfigFetcher
		initialRouterConfig *nodev1.RouterConfig
		gracePeriod         time.Duration
		shutdown            bool
		listenAddr          string
		baseURL             string
		graphqlPath         string
		playground          bool
		introspection       bool
		production          bool
		federatedGraphName  string
		graphApiToken       string
		healthCheckPath     string
		readinessCheckPath  string
		livenessCheckPath   string
		prometheusServer    *http.Server
		modulesConfig       map[string]interface{}
		routerMiddlewares   []func(http.Handler) http.Handler
		preOriginHandlers   []TransportPreHandler
		postOriginHandlers  []TransportPostHandler
		headerRuleEngine    *HeaderRuleEngine
		headerRules         config.HeaderRules
	}

	// Server is the main router instance.
	Server struct {
		Config
		Server       *http.Server
		routerConfig *nodev1.RouterConfig
		healthChecks *health.Checks
	}

	// Option defines the method to customize Server.
	Option func(svr *Router)
)

// NewRouter creates a new Router instance. Router.Start() must be called to start the server.
// Alternatively, use Router.NewTestServer() to create a new Server instance without starting it for testing purposes.
func NewRouter(opts ...Option) (*Router, error) {
	r := &Router{}
	r.graphqlPath = "/graphql"

	for _, opt := range opts {
		opt(r)
	}

	if r.logger == nil {
		r.logger = zap.NewNop()
	}

	if r.traceConfig == nil {
		r.traceConfig = trace.DefaultConfig()
	}

	if r.metricConfig == nil {
		r.metricConfig = metric.DefaultConfig()
	}

	if r.corsOptions == nil {
		r.corsOptions = CorsDefaultOptions()
	}

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
	}

	defaultMethods := []string{
		"HEAD", "GET", "POST",
	}
	r.corsOptions.AllowHeaders = stringsx.RemoveDuplicates(append(r.corsOptions.AllowHeaders, defaultHeaders...))
	r.corsOptions.AllowMethods = stringsx.RemoveDuplicates(append(r.corsOptions.AllowMethods, defaultMethods...))

	r.baseURL = fmt.Sprintf("http://%s", r.listenAddr)

	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	// Great source of inspiration: https://gitlab.com/gitlab-org/gitlab-pages
	// A pages proxy in go that handles tls to upstreams, rate limiting, and more
	r.transport = &http.Transport{
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
		IdleConnTimeout:     90 * time.Second,
		// Set more timeouts https://gitlab.com/gitlab-org/gitlab-pages/-/issues/495
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		ExpectContinueTimeout: 15 * time.Second,
	}

	if r.traceConfig.OtlpHeaders == nil {
		r.traceConfig.OtlpHeaders = make(map[string]string)
	}
	r.traceConfig.OtlpHeaders["Authorization"] = fmt.Sprintf("Bearer %s", r.graphApiToken)

	if r.metricConfig.OtlpHeaders == nil {
		r.metricConfig.OtlpHeaders = make(map[string]string)
	}
	r.metricConfig.OtlpHeaders["Authorization"] = fmt.Sprintf("Bearer %s", r.graphApiToken)

	return r, nil
}

// startAndSwapServer starts a new Server. It swaps the active Server with a new Server instance when the config has changed.
// This method is not safe for concurrent use.
func (r *Router) startAndSwapServer(ctx context.Context, cfg *nodev1.RouterConfig) error {
	// Rebuild Server with new router config
	// In case of an error, we return early and keep the old Server running

	newRouter, err := r.newServer(ctx, cfg)
	if err != nil {
		r.logger.Error("Failed to create r new router. Keeping old router running", zap.Error(err))
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

		if prevRouter != nil {
			r.logger.Info("Starting Server with new config",
				zap.String("version", cfg.GetVersion()),
			)
		} else {
			r.logger.Info("Server listening",
				zap.String("listen_addr", r.listenAddr),
				zap.Bool("playground", r.playground),
				zap.Bool("introspection", r.introspection),
				zap.String("version", cfg.GetVersion()),
			)

			if r.playground && r.introspection {
				r.logger.Info("Playground available at", zap.String("url", r.baseURL+"/graphql"))
			}
		}

		r.activeRouter.healthChecks.SetReady(true)

		// This is r blocking call
		if err := r.activeRouter.listenAndServe(); err != nil {
			r.activeRouter.healthChecks.SetReady(true)
			r.logger.Error("Failed to start new server", zap.Error(err))
		}

		r.logger.Info("Server stopped", zap.String("version", newRouter.routerConfig.GetVersion()))
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

	newRouter, err := r.newServer(ctx, r.initialRouterConfig)
	if err != nil {
		r.logger.Error("Failed to create r new router", zap.Error(err))
		return nil, err
	}

	return newRouter, nil
}

func (r *Router) bootstrap(ctx context.Context) error {

	if r.traceConfig.Enabled {
		tp, err := trace.StartAgent(r.logger, r.traceConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		r.tracerProvider = tp
	}

	// Prometheus metrics rely on OTLP metrics
	if r.metricConfig.Enabled || r.metricConfig.Prometheus.Enabled {
		mp, err := metric.StartAgent(r.logger, r.metricConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		r.meterProvider = mp
	}

	if r.metricConfig.Prometheus.Enabled {
		promSvr := createPrometheus(r.logger, r.metricConfig.Prometheus.ListenAddr, r.metricConfig.Prometheus.Path)
		go func() {
			if err := promSvr.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				r.logger.Error("Failed to start Prometheus server", zap.Error(err))
			}
		}()
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
		return fmt.Errorf("router is closed. Create r new instance with router.NewRouter()")
	}

	eg, ctx := errgroup.WithContext(ctx)

	if err := r.bootstrap(ctx); err != nil {
		return fmt.Errorf("failed to bootstrap application: %w", err)
	}

	var initCh = make(chan *nodev1.RouterConfig, 1)

	eg.Go(func() error {
		for {
			select {
			case <-ctx.Done(): // context cancelled
				return nil
			case cfg := <-initCh: // initial config
				if err := r.startAndSwapServer(ctx, cfg); err != nil {
					return fmt.Errorf("failed to start server with initial config: %w", err)
				}
			case cfg := <-r.configFetcher.Subscribe(ctx): // new config
				if err := r.startAndSwapServer(ctx, cfg); err != nil {
					r.logger.Error("Failed to start server with new config", zap.Error(err))
					continue
				}
			}
		}
	})

	// Get initial router config from static config file
	if r.initialRouterConfig != nil {
		initCh <- r.initialRouterConfig
	} else {
		// Load initial router config from controlplane
		initialCfg, err := r.configFetcher.GetRouterConfig(ctx)
		if err != nil {
			return fmt.Errorf("failed to get initial router config: %w", err)
		}

		initCh <- initialCfg
	}

	return eg.Wait()
}

// newServer creates a new Server instance.
// All stateful data is copied from the Router over to the new server instance.
func (r *Router) newServer(ctx context.Context, routerConfig *nodev1.RouterConfig) (*Server, error) {
	ro := &Server{
		routerConfig: routerConfig,
		Config:       r.Config,
	}

	recoveryHandler := recovery.New(recovery.WithLogger(r.logger), recovery.WithPrintStack())
	requestLogger := requestlogger.New(
		r.logger,
		requestlogger.WithDefaultOptions(),
		requestlogger.WithContext(func(request *http.Request) []zapcore.Field {
			return []zapcore.Field{
				zap.String("configVersion", routerConfig.GetVersion()),
				zap.String("requestID", middleware.GetReqID(request.Context())),
				zap.String("federatedGraphName", r.federatedGraphName),
			}
		}),
	)

	httpRouter := chi.NewRouter()
	httpRouter.Use(recoveryHandler)
	httpRouter.Use(middleware.RequestID)
	httpRouter.Use(middleware.RealIP)
	httpRouter.Use(requestLogger)
	httpRouter.Use(cors.New(*r.corsOptions))

	ro.healthChecks = health.New(&health.Options{
		Logger: r.logger,
	})
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

	pb := &Planner{
		introspection: true,
		baseURL:       r.baseURL,
		transport:     r.transport,
		logger:        r.logger,
		preHandlers:   r.preOriginHandlers,
		postHandlers:  r.postOriginHandlers,
	}

	plan, err := pb.Build(ctx, routerConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	graphqlHandler := NewGraphQLHandler(HandlerOptions{
		PlanConfig: plan.PlanConfig,
		Definition: plan.Definition,
		Resolver:   plan.Resolver,
		Pool:       plan.Pool,
		Cache:      planCache,
		Log:        r.logger,
	})

	graphqlPreHandler := NewPreHandler(&PreHandlerOptions{
		Logger:          r.logger,
		Pool:            plan.Pool,
		RenameTypeNames: plan.RenameTypeNames,
		PlanConfig:      plan.PlanConfig,
		Definition:      plan.Definition,
	})

	var metricHandler *metric.Handler

	// Prometheus metrics rely on OTLP metrics
	metricsEnabled := r.metricConfig.Enabled || r.metricConfig.Prometheus.Enabled

	if metricsEnabled {
		h, err := metric.NewMetricHandler(
			r.meterProvider,
			metric.WithAttributes(
				otel.WgRouterGraphName.String(r.federatedGraphName),
				otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
			),
			metric.WithRequestAttributes(func(r *http.Request) (attributes []attribute.KeyValue) {
				opCtx := getOperationContext(r.Context())

				if opCtx != nil {
					// Metric values must not be empty
					// M3 does not like empty values
					if opCtx.Name() != "" {
						attributes = append(attributes, otel.WgOperationName.String(opCtx.Name()))
					}
					if opCtx.Type() != "" {
						attributes = append(attributes, otel.WgOperationType.String(opCtx.Type()))
					}
				}

				return attributes
			}),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create metric handler: %w", err)
		}

		metricHandler = h
	}

	var traceHandler *trace.Middleware

	if metricsEnabled {
		h := trace.NewMiddleware(otel.RouterServerAttribute,
			otelhttp.WithSpanOptions(
				oteltrace.WithAttributes(
					otel.WgRouterGraphName.String(r.federatedGraphName),
					otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
				),
			),
			// Disable built-in metrics
			otelhttp.WithMeterProvider(sdkmetric.NewMeterProvider()),
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
		)

		traceHandler = h
	}

	// Serve GraphQL. Metrics are collected after the request is handled and classified as r GraphQL request.
	httpRouter.Route(r.graphqlPath, func(subChiRouter chi.Router) {
		if traceHandler != nil {
			subChiRouter.Use(traceHandler.Handler)
		}

		subChiRouter.Use(graphqlPreHandler.Handler)

		if metricHandler != nil {
			subChiRouter.Use(metricHandler.Handler)
		}

		// Create r custom request context that provides access to the request and response.
		// It is used by custom modules and handlers. It must be added before custom user middlewares
		subChiRouter.Use(func(handler http.Handler) http.Handler {
			return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				operationContext := getOperationContext(request.Context())
				requestContext := &requestContext{
					logger:         r.logger.With(logging.WithRequestID(middleware.GetReqID(request.Context()))),
					mu:             sync.RWMutex{},
					keys:           map[string]any{},
					responseWriter: writer,
					request:        request,
					operation:      operationContext,
				}
				handler.ServeHTTP(writer, request.WithContext(WithRequestContext(request.Context(), requestContext)))
			})
		})

		subChiRouter.Use(r.routerMiddlewares...)
		subChiRouter.Post("/", graphqlHandler.ServeHTTP)
	})

	r.logger.Debug("GraphQLHandler registered",
		zap.String("method", http.MethodPost),
		zap.String("path", r.graphqlPath),
	)

	if r.playground {
		graphqlPlaygroundHandler := graphiql2.NewPlayground(&graphiql2.PlaygroundOptions{
			Log:  r.logger,
			Html: graphiql2.GetGraphiqlPlaygroundHTML(),
			// Empty url to use the same url as the playground
			GraphqlURL: "",
		})
		httpRouter.Get(r.graphqlPath, graphqlPlaygroundHandler)
		r.logger.Debug("PlaygroundHandler registered",
			zap.String("method", http.MethodGet),
			zap.String("path", r.graphqlPath),
		)
	}

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

	var wg sync.WaitGroup

	if r.prometheusServer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.prometheusServer.Close(); err != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown prometheus server: %w", err))
			}
		}()
	}

	if r.tracerProvider != nil {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if err := r.tracerProvider.ForceFlush(ctx); err != nil {
				err = errors.Join(err, fmt.Errorf("failed to force flush tracer: %w", err))
			}
			if err := r.tracerProvider.Shutdown(ctx); err != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown tracer: %w", err))
			}
		}()
	}

	wg.Add(1)
	go func() {
		defer wg.Done()

		for _, module := range r.modules {
			if cleaner, ok := module.(Cleaner); ok {
				if err := cleaner.Cleanup(); err != nil {
					err = errors.Join(err, fmt.Errorf("failed to clean module %s: %w", module.Module().ID, err))
				}
			}
		}
	}()

	wg.Wait()

	if r.activeRouter != nil {
		if err := r.activeRouter.Shutdown(ctx); err != nil {
			err = errors.Join(err, fmt.Errorf("failed to shutdown primary server: %w", err))
		}
	}

	return err
}

// Shutdown gracefully shutdown the Server.
func (r *Server) Shutdown(ctx context.Context) (err error) {
	r.logger.Info("Gracefully shutting down the router ...",
		zap.String("version", r.routerConfig.GetVersion()),
		zap.String("gracePeriod", r.gracePeriod.String()),
	)

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

func createPrometheus(logger *zap.Logger, listenAddr, path string) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Handle(path, promhttp.Handler())

	svr := &http.Server{
		Addr:              listenAddr,
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		ErrorLog:          zap.NewStdLog(logger),
		Handler:           r,
	}

	logger.Info("Serve Prometheus metrics", zap.String("listenAddr", svr.Addr), zap.String("endpoint", path))

	return svr
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

func WithConfigFetcher(cf controlplane.ConfigFetcher) Option {
	return func(r *Router) {
		r.configFetcher = cf
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
		r.initialRouterConfig = cfg
	}
}

func WithHealthCheckPath(path string) Option {
	return func(r *Router) {
		r.healthCheckPath = path
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

func WithHeaderRules(headers config.HeaderRules) Option {
	return func(r *Router) {
		r.headerRules = headers
	}
}
