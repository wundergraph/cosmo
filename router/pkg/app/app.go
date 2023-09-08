package app

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
	"github.com/wundergraph/cosmo/router/pkg/controlplane"
	"github.com/wundergraph/cosmo/router/pkg/graphiql"
	"github.com/wundergraph/cosmo/router/pkg/graphql"
	"github.com/wundergraph/cosmo/router/pkg/handler/cors"
	"github.com/wundergraph/cosmo/router/pkg/handler/health"
	"github.com/wundergraph/cosmo/router/pkg/handler/recovery"
	"github.com/wundergraph/cosmo/router/pkg/handler/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/stringsx"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
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
	// App is the main application instance.
	App struct {
		Options
		activeRouter *Router
		modules      []Module
		mu           sync.Mutex
	}

	// Options defines the configurable options for the router.
	Options struct {
		transport                *http.Transport
		logger                   *zap.Logger
		traceConfig              *trace.Config
		metricConfig             *metric.Config
		tracerProvider           *sdktrace.TracerProvider
		meterProvider            *sdkmetric.MeterProvider
		corsOptions              *cors.Config
		configFetcher            controlplane.ConfigFetcher
		initialRouterConfig      *nodev1.RouterConfig
		gracePeriod              time.Duration
		shutdown                 bool
		listenAddr               string
		baseURL                  string
		graphqlPath              string
		playground               bool
		introspection            bool
		production               bool
		federatedGraphName       string
		graphApiToken            string
		healthCheckPath          string
		readinessCheckPath       string
		livenessCheckPath        string
		prometheusServer         *http.Server
		modulesConfig            map[string]interface{}
		moduleMiddlewares        []func(http.Handler) http.Handler
		modulePreOriginHandlers  []graphql.TransportPreHandler
		modulePostOriginHandlers []graphql.TransportPostHandler
	}

	// Router is the main router instance.
	Router struct {
		Options
		Server       *http.Server
		routerConfig *nodev1.RouterConfig
		healthChecks *health.Checks
	}

	// Option defines the method to customize Router.
	Option func(svr *App)
)

// New creates a new App instance.
func New(opts ...Option) (*App, error) {
	r := &App{}
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
func (a *App) startAndSwapServer(ctx context.Context, cfg *nodev1.RouterConfig) error {
	// Rebuild Server with new router config
	// In case of an error, we return early and keep the old Server running

	newRouter, err := a.newRouter(ctx, cfg)
	if err != nil {
		a.logger.Error("Failed to create a new router. Keeping old router running", zap.Error(err))
		return err
	}

	prevRouter := a.activeRouter

	if prevRouter != nil {
		if err := prevRouter.Shutdown(ctx); err != nil {
			a.logger.Error("Could not shutdown router", zap.Error(err))
			return err
		}
	}

	// Swap active Server
	a.mu.Lock()
	a.activeRouter = newRouter
	a.mu.Unlock()

	// Start new Server
	go func() {

		if prevRouter != nil {
			a.logger.Info("Starting Server with new config",
				zap.String("version", cfg.GetVersion()),
			)
		} else {
			a.logger.Info("Server listening",
				zap.String("listen_addr", a.listenAddr),
				zap.Bool("playground", a.playground),
				zap.Bool("introspection", a.introspection),
				zap.String("version", cfg.GetVersion()),
			)

			if a.playground && a.introspection {
				a.logger.Info("Playground available at", zap.String("url", a.baseURL+"/graphql"))
			}
		}

		a.activeRouter.healthChecks.SetReady(true)

		// This is a blocking call
		if err := a.activeRouter.listenAndServe(); err != nil {
			a.activeRouter.healthChecks.SetReady(true)
			a.logger.Error("Failed to start new server", zap.Error(err))
		}

		a.logger.Info("Server stopped", zap.String("version", newRouter.routerConfig.GetVersion()))
	}()

	return nil
}

func (a *App) initModules(ctx context.Context) error {
	for _, moduleInfo := range modules {
		now := time.Now()

		moduleInstance := moduleInfo.New()

		mc := &ModuleContext{
			Context: ctx,
			module:  moduleInstance,
			logger:  a.logger,
		}

		moduleConfig, ok := a.modulesConfig[string(moduleInfo.ID)]
		if ok {
			if err := mapstructure.Decode(moduleConfig, &moduleInstance); err != nil {
				return fmt.Errorf("failed to decode module config from module %s: %w", moduleInfo.ID, err)
			}
		} else {
			a.logger.Debug("No config found for module", zap.String("id", string(moduleInfo.ID)))
		}

		if fn, ok := moduleInstance.(Provisioner); ok {
			if err := fn.Provision(mc); err != nil {
				return fmt.Errorf("failed to provision module '%s': %w", moduleInfo.ID, err)
			}
		}

		if fn, ok := moduleInstance.(RouterMiddlewareHandler); ok {
			a.moduleMiddlewares = append(a.moduleMiddlewares, func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
					fn.Middleware(writer, request, handler)
				})
			})
		}

		if handler, ok := moduleInstance.(EnginePreOriginHandler); ok {
			a.modulePreOriginHandlers = append(a.modulePreOriginHandlers, handler.OnOriginRequest)
		}

		if handler, ok := moduleInstance.(EnginePostOriginHandler); ok {
			a.modulePostOriginHandlers = append(a.modulePostOriginHandlers, handler.OnOriginResponse)
		}

		a.modules = append(a.modules, moduleInstance)

		a.logger.Info("Module registered",
			zap.String("id", string(moduleInfo.ID)),
			zap.String("duration", time.Since(now).String()),
		)
	}

	return nil
}

// NewTestRouter creates a new Router instance without starting the Router. The method should be only used for testing purposes.
// It is a lightweight version of Start() but does not start the server or require a config fetcher. Use app.WithStaticRouterConfig to pass the initial config.
func (a *App) NewTestRouter(ctx context.Context) (*Router, error) {

	if err := a.bootstrap(ctx); err != nil {
		return nil, fmt.Errorf("failed to bootstrap application: %w", err)
	}

	newRouter, err := a.newRouter(ctx, a.initialRouterConfig)
	if err != nil {
		a.logger.Error("Failed to create a new router", zap.Error(err))
		return nil, err
	}

	return newRouter, nil
}

func (a *App) bootstrap(ctx context.Context) error {

	if a.traceConfig.Enabled {
		tp, err := trace.StartAgent(a.logger, a.traceConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		a.tracerProvider = tp
	}

	// Prometheus metrics rely on OTLP metrics
	if a.metricConfig.Enabled || a.metricConfig.Prometheus.Enabled {
		mp, err := metric.StartAgent(a.logger, a.metricConfig)
		if err != nil {
			return fmt.Errorf("failed to start trace agent: %w", err)
		}
		a.meterProvider = mp
	}

	if a.metricConfig.Prometheus.Enabled {
		promSvr := createPrometheus(a.logger, a.metricConfig.Prometheus.ListenAddr, a.metricConfig.Prometheus.Path)
		go func() {
			if err := promSvr.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				a.logger.Error("Failed to start Prometheus server", zap.Error(err))
			}
		}()
	}

	// Modules are only initialized once and not on every config change
	if err := a.initModules(ctx); err != nil {
		return fmt.Errorf("failed to init user modules: %w", err)
	}

	return nil
}

// Start starts the Server. It blocks until the context is cancelled or when the initial config could not be fetched.
func (a *App) Start(ctx context.Context) error {
	if a.shutdown {
		return fmt.Errorf("server is closed. Create a new instance with New()")
	}

	eg, ctx := errgroup.WithContext(ctx)

	if err := a.bootstrap(ctx); err != nil {
		return fmt.Errorf("failed to bootstrap application: %w", err)
	}

	var initCh = make(chan *nodev1.RouterConfig, 1)

	eg.Go(func() error {
		for {
			select {
			case <-ctx.Done(): // context cancelled
				return nil
			case cfg := <-initCh: // initial config
				if err := a.startAndSwapServer(ctx, cfg); err != nil {
					return fmt.Errorf("failed to start server with initial config: %w", err)
				}
			case cfg := <-a.configFetcher.Subscribe(ctx): // new config
				if err := a.startAndSwapServer(ctx, cfg); err != nil {
					a.logger.Error("Failed to start server with new config", zap.Error(err))
					continue
				}
			}
		}
	})

	// Get initial router config from static config file
	if a.initialRouterConfig != nil {
		initCh <- a.initialRouterConfig
	} else {
		// Load initial router config from controlplane
		initialCfg, err := a.configFetcher.GetRouterConfig(ctx)
		if err != nil {
			return fmt.Errorf("failed to get initial router config: %w", err)
		}

		initCh <- initialCfg
	}

	return eg.Wait()
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

// newRouter creates a new Server instance.
// All stateful data is copied from the app over to the new router instance.
func (a *App) newRouter(ctx context.Context, routerConfig *nodev1.RouterConfig) (*Router, error) {
	router := &Router{
		routerConfig: routerConfig,
		Options:      a.Options,
	}

	recoveryHandler := recovery.New(recovery.WithLogger(a.logger), recovery.WithPrintStack())
	requestLogger := requestlogger.New(
		a.logger,
		requestlogger.WithDefaultOptions(),
		requestlogger.WithContext(func(r *http.Request) []zapcore.Field {
			return []zapcore.Field{
				zap.String("configVersion", routerConfig.GetVersion()),
				zap.String("requestID", middleware.GetReqID(r.Context())),
				zap.String("federatedGraphName", a.federatedGraphName),
			}
		}),
	)

	httpRouter := chi.NewRouter()
	httpRouter.Use(recoveryHandler)
	httpRouter.Use(middleware.RequestID)
	httpRouter.Use(middleware.RealIP)
	httpRouter.Use(requestLogger)
	httpRouter.Use(cors.New(*a.corsOptions))

	router.healthChecks = health.New(&health.Options{
		Logger: a.logger,
	})
	httpRouter.Get(a.healthCheckPath, router.healthChecks.Liveness())
	httpRouter.Get(a.livenessCheckPath, router.healthChecks.Liveness())
	httpRouter.Get(a.readinessCheckPath, router.healthChecks.Readiness())

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

	pb := graphql.NewPlanner(
		graphql.WithIntrospection(),
		graphql.WithLogger(a.logger),
		graphql.WithBaseURL(a.baseURL),
		graphql.WithTransport(a.transport),
		graphql.WithPreOriginHandlers(a.modulePreOriginHandlers),
		graphql.WithPostOriginHandlers(a.modulePostOriginHandlers),
	)

	plan, err := pb.Build(ctx, routerConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	graphqlHandler := graphql.NewHandler(graphql.HandlerOptions{
		PlanConfig: plan.PlanConfig,
		Definition: plan.Definition,
		Resolver:   plan.Resolver,
		Pool:       plan.Pool,
		Cache:      planCache,
		Log:        a.logger,
	})

	graphqlPreHandler := graphql.NewPreHandler(&graphql.PreHandlerOptions{
		Logger:          a.logger,
		Pool:            plan.Pool,
		RenameTypeNames: plan.RenameTypeNames,
		PlanConfig:      plan.PlanConfig,
		Definition:      plan.Definition,
	})

	var metricHandler *metric.Handler

	// Prometheus metrics rely on OTLP metrics
	metricsEnabled := a.metricConfig.Enabled || a.metricConfig.Prometheus.Enabled

	if metricsEnabled {
		h, err := metric.NewMetricHandler(
			a.meterProvider,
			otel.WgRouterGraphName.String(a.federatedGraphName),
			otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
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
					otel.WgRouterGraphName.String(a.federatedGraphName),
					otel.WgRouterConfigVersion.String(routerConfig.GetVersion()),
				),
			),
			// Disable built-in metrics
			otelhttp.WithMeterProvider(sdkmetric.NewMeterProvider()),
			otelhttp.WithSpanNameFormatter(graphql.SpanNameFormatter),
		)

		traceHandler = h
	}

	// Serve GraphQL. Metrics are collected after the request is handled and classified as a GraphQL request.
	httpRouter.Route(a.graphqlPath, func(r chi.Router) {
		if traceHandler != nil {
			r.Use(traceHandler.Handler)
		}

		r.Use(graphqlPreHandler.Handler)

		if metricHandler != nil {
			r.Use(metricHandler.Handler)
		}

		// Create an app context that is used by user modules
		// It must be added before custom user middlewares
		r.Use(func(handler http.Handler) http.Handler {
			return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				appCtx := &requestContext{
					responseHeader: writer.Header(),
					mu:             sync.RWMutex{},
					logger:         a.logger.With(logging.WithRequestID(middleware.GetReqID(request.Context()))),
				}
				handler.ServeHTTP(writer, request.WithContext(WithRequestContext(request.Context(), appCtx)))
			})
		})

		r.Use(a.moduleMiddlewares...)
		r.Post("/", graphqlHandler.ServeHTTP)
	})

	a.logger.Debug("GraphQLHandler registered",
		zap.String("method", http.MethodPost),
		zap.String("path", a.graphqlPath),
	)

	if a.playground {
		graphqlPlaygroundHandler := graphiql.NewPlayground(&graphiql.PlaygroundOptions{
			Log:  a.logger,
			Html: graphiql.GetGraphiqlPlaygroundHTML(),
			// Empty url to use the same url as the playground
			GraphqlURL: "",
		})
		httpRouter.Get(a.graphqlPath, graphqlPlaygroundHandler)
		a.logger.Debug("PlaygroundHandler registered",
			zap.String("method", http.MethodGet),
			zap.String("path", a.graphqlPath),
		)
	}

	router.Server = &http.Server{
		Addr: a.listenAddr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		Handler:           httpRouter,
		ErrorLog:          zap.NewStdLog(a.logger),
	}

	return router, nil
}

// listenAndServe starts the Server and blocks until the Server is shutdown.
func (r *Router) listenAndServe() error {

	if err := r.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}

	return nil
}

// Shutdown gracefully shuts down the router.
func (a *App) Shutdown(ctx context.Context) (err error) {
	a.shutdown = true

	var wg sync.WaitGroup

	if a.prometheusServer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := a.prometheusServer.Close(); err != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown prometheus server: %w", err))
			}
		}()
	}

	if a.tracerProvider != nil {
		wg.Add(1)
		defer wg.Done()

		go func() {
			if err := a.tracerProvider.ForceFlush(ctx); err != nil {
				err = errors.Join(err, fmt.Errorf("failed to force flush tracer: %w", err))
			}
			if err := a.tracerProvider.Shutdown(ctx); err != nil {
				err = errors.Join(err, fmt.Errorf("failed to shutdown tracer: %w", err))
			}
		}()
	}

	wg.Add(1)
	go func() {
		defer wg.Done()

		for _, module := range a.modules {
			if cleaner, ok := module.(Cleaner); ok {
				if err := cleaner.Cleanup(); err != nil {
					err = errors.Join(err, fmt.Errorf("failed to clean module %s: %w", module.Module().ID, err))
				}
			}
		}
	}()

	if a.activeRouter != nil {
		if err := a.activeRouter.Shutdown(ctx); err != nil {
			err = errors.Join(err, fmt.Errorf("failed to shutdown primary server: %w", err))
		}
	}

	return err
}

// Shutdown gracefully shutdown the Router.
func (r *Router) Shutdown(ctx context.Context) (err error) {
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

func WithListenerAddr(addr string) Option {
	return func(s *App) {
		s.listenAddr = addr
	}
}

func WithLogger(logger *zap.Logger) Option {
	return func(s *App) {
		s.logger = logger
	}
}

func WithPlayground(enable bool) Option {
	return func(s *App) {
		s.playground = enable
	}
}

func WithIntrospection(enable bool) Option {
	return func(s *App) {
		s.introspection = enable
	}
}

func WithTracing(cfg *trace.Config) Option {
	return func(s *App) {
		s.traceConfig = cfg
	}
}

func WithCors(corsOpts *cors.Config) Option {
	return func(s *App) {
		s.corsOptions = corsOpts
	}
}

func WithGraphQLPath(path string) Option {
	return func(s *App) {
		s.graphqlPath = path
	}
}

func WithConfigFetcher(cf controlplane.ConfigFetcher) Option {
	return func(s *App) {
		s.configFetcher = cf
	}
}

func WithGracePeriod(timeout time.Duration) Option {
	return func(s *App) {
		s.gracePeriod = timeout
	}
}

func WithMetrics(cfg *metric.Config) Option {
	return func(s *App) {
		s.metricConfig = cfg
	}
}

func WithFederatedGraphName(name string) Option {
	return func(s *App) {
		s.federatedGraphName = name
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
	return func(s *App) {
		s.graphApiToken = token
	}
}

func WithModulesConfig(config map[string]interface{}) Option {
	return func(s *App) {
		s.modulesConfig = config
	}
}

func WithStaticRouterConfig(cfg *nodev1.RouterConfig) Option {
	return func(s *App) {
		s.initialRouterConfig = cfg
	}
}

func WithHealthCheckPath(path string) Option {
	return func(s *App) {
		s.healthCheckPath = path
	}
}

func WithReadinessCheckPath(path string) Option {
	return func(s *App) {
		s.readinessCheckPath = path
	}
}

func WithLivenessCheckPath(path string) Option {
	return func(s *App) {
		s.livenessCheckPath = path
	}
}
