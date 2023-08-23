package app

import (
	"context"
	"errors"
	"fmt"
	"github.com/dgraph-io/ristretto"
	"github.com/gin-contrib/requestid"
	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
	cors "github.com/rs/cors/wrapper/gin"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane"
	"github.com/wundergraph/cosmo/router/pkg/graphiql"
	"github.com/wundergraph/cosmo/router/pkg/graphql"
	"github.com/wundergraph/cosmo/router/pkg/handlers"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	trace2 "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
	"net"
	"net/http"
	"time"
)

type (
	// App is the main application instance.
	App struct {
		Options
		activeServer *Router
	}

	// Options defines the configurable options for the router.
	Options struct {
		transport          *http.Transport
		logger             *zap.Logger
		traceConfig        *trace.Config
		tracerProvider     *sdktrace.TracerProvider
		corsOptions        *cors.Options
		configFetcher      *controlplane.ConfigFetcher
		gracePeriod        time.Duration
		addr               string
		baseURL            string
		graphqlPath        string
		playground         bool
		introspection      bool
		production         bool
		federatedGraphName string
		graphApiToken      string
	}

	// Router is the main router instance.
	Router struct {
		Options
		server       *http.Server
		routerConfig *nodev1.RouterConfig
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

	if r.corsOptions == nil {
		r.corsOptions = CorsDefaultOptions()
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

	r.corsOptions.AllowedHeaders = append(r.corsOptions.AllowedOrigins, defaultHeaders...)
	r.corsOptions.AllowedMethods = append(r.corsOptions.AllowedMethods, defaultMethods...)

	r.baseURL = fmt.Sprintf("http://%s", r.addr)

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

	tp, err := trace.StartAgent(r.logger, r.traceConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to start trace agent: %w", err)
	}
	r.tracerProvider = tp

	r.logger.Info("Collector agent started", zap.String("url", r.traceConfig.Endpoint+r.traceConfig.OtlpHttpPath))

	return r, nil
}

// swapServer swaps the active server with a new server instance.
// This method is not safe for concurrent use.
func (s *App) swapServer(ctx context.Context, cfg *nodev1.RouterConfig) error {
	// Rebuild server with new router config
	// In case of an error, we return early and keep the old server running

	newServer, err := s.newRouter(ctx, cfg)
	if err != nil {
		s.logger.Error("Failed to newRouter server", zap.Error(err))
		return err
	}

	// Gracefully shutdown server
	// Wait grace period before forcefully shutting down the server

	prevServer := s.activeServer

	if prevServer != nil {
		s.logger.Info("Gracefully shutting down server ...",
			zap.String("version", prevServer.routerConfig.GetVersion()),
			zap.String("gracePeriod", s.gracePeriod.String()),
		)

		if prevServer.gracePeriod > 0 {
			ctxWithTimer, cancel := context.WithTimeout(context.Background(), s.gracePeriod)
			ctx = ctxWithTimer
			defer cancel()
		}

		if err := prevServer.Shutdown(ctx); err != nil {
			s.logger.Error("Could not shutdown server", zap.Error(err))
		}
	}

	// Swap active server
	s.activeServer = newServer

	// Start new server

	go func() {

		if prevServer != nil {
			s.logger.Info("Starting server with new config",
				zap.String("version", cfg.GetVersion()),
			)
		} else {
			s.logger.Info("Server listening",
				zap.String("listen_addr", s.addr),
				zap.Bool("playground", s.playground),
				zap.Bool("introspection", s.introspection),
				zap.String("version", cfg.GetVersion()),
			)

			if s.playground && s.introspection {
				s.logger.Info("Playground available at", zap.String("url", s.baseURL+"/graphql"))
			}
		}

		// This is a blocking call
		if err := s.activeServer.listenAndServe(); err != nil {
			s.logger.Error("Failed to start new server", zap.Error(err))
		}

		s.logger.Info("Server stopped", zap.String("version", s.activeServer.routerConfig.GetVersion()))
	}()

	return nil
}

// Start starts the server. It blocks until the context is cancelled or when the initial config could not be fetched.
func (s *App) Start(ctx context.Context) error {

	eg, ctx := errgroup.WithContext(ctx)

	var initCh = make(chan *nodev1.RouterConfig, 1)

	eg.Go(func() error {
		for {
			select {
			case <-ctx.Done(): // context cancelled
				return nil
			case cfg := <-initCh: // initial config
				if err := s.swapServer(ctx, cfg); err != nil {
					return fmt.Errorf("failed to handle initial config: %w", err)
				}
			case cfg := <-s.configFetcher.Subscribe(ctx): // new config
				if err := s.swapServer(ctx, cfg); err != nil {
					continue
				}
			}
		}
	})

	// Get initial router config

	initialCfg, err := s.configFetcher.GetRouterConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to get initial router config: %w", err)
	}

	initCh <- initialCfg

	return eg.Wait()
}

// newRouter creates a new server instance.
// All stateful data is copied from the app over to the new router instance.
func (s *App) newRouter(ctx context.Context, routerConfig *nodev1.RouterConfig) (*Router, error) {
	if s.production {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(ginzap.GinzapWithConfig(s.logger, &ginzap.Config{
		TimeFormat: time.RFC3339,
		UTC:        true,
		TraceID:    true,
		SkipPaths:  []string{"/health"},
	}))
	router.Use(ginzap.RecoveryWithZap(s.logger, true))
	router.Use(requestid.New())
	router.Use(cors.New(*s.corsOptions))

	healthHandler := handlers.NewHealthHandler()
	router.GET("/health", healthHandler.Handler)

	// when an execution plan was generated, which can be quite expensive, we want to cache it
	// this means that we can hash the input and cache the generated plan
	// the next time we get the same input, we can just return the cached plan
	// the engine is smart enough to first do normalization and then hash the input
	// this means that we can cache the normalized input and don't have to worry about
	// different inputs that would generate the same execution plan
	planCache, err := ristretto.NewCache(&ristretto.Config{
		MaxCost:     1024 * 10,      // keep 10k execution plans in the cache
		NumCounters: 1024 * 10 * 10, // 4k * 10
		BufferItems: 64,             // number of keys per Get buffer.
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create plan cache: %w", err)
	}

	hb := graphql.NewGraphQLHandlerBuilder(
		graphql.WithIntrospection(),
		graphql.WithPlanCache(planCache),
		graphql.WithLogger(s.logger),
		graphql.WithBaseURL(s.baseURL),
		graphql.WithTransport(s.transport),
	)

	graphqlHandler, err := hb.Build(ctx, routerConfig)
	if err != nil {
		s.logger.Error("Failed to newRouter initial handler", zap.Error(err))
		return nil, err
	}

	router.POST(s.graphqlPath, graphqlHandler.Handler)

	s.logger.Debug("Registered GraphQLHandler",
		zap.String("method", http.MethodPost),
		zap.String("path", s.graphqlPath),
	)

	if s.playground {
		graphqlPlaygroundHandler := &graphql.GraphQLPlaygroundHandler{
			Log:     s.logger,
			Html:    graphiql.GetGraphiqlPlaygroundHTML(),
			NodeUrl: s.baseURL,
		}
		router.GET(s.graphqlPath, graphqlPlaygroundHandler.Handler)
		s.logger.Debug("Registered GraphQLPlaygroundHandler",
			zap.String("method", http.MethodGet),
			zap.String("path", s.graphqlPath),
		)
	}

	server := &http.Server{
		Addr: s.addr,
		// https://ieftimov.com/posts/make-resilient-golang-net-http-servers-using-timeouts-deadlines-context-cancellation/
		ReadTimeout:       1 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		ReadHeaderTimeout: 20 * time.Second,
		// TODO: Move to middleware after release https://github.com/open-telemetry/opentelemetry-go-contrib/compare/v1.17.0...HEAD
		Handler: trace.WrapHandler(
			router,
			trace.RouterServerAttribute,
			otelhttp.WithSpanOptions(
				trace2.WithAttributes(
					trace.WgRouterGraphName.String(s.federatedGraphName),
					trace.WgRouterVersion.String(routerConfig.GetVersion()),
				),
			),
		),
		ErrorLog: zap.NewStdLog(s.logger),
	}

	svr := &Router{
		routerConfig: routerConfig,
		server:       server,
		Options: Options{
			graphqlPath:   s.graphqlPath,
			transport:     s.transport,
			logger:        s.logger,
			traceConfig:   s.traceConfig,
			corsOptions:   s.corsOptions,
			configFetcher: s.configFetcher,
			addr:          s.addr,
			baseURL:       s.baseURL,
			playground:    s.playground,
			introspection: s.introspection,
			production:    s.production,
			gracePeriod:   s.gracePeriod,
		},
	}

	return svr, nil
}

// listenAndServe starts the server and blocks until the server is shutdown.
func (s *Router) listenAndServe() error {

	if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}

	return nil
}

// Shutdown gracefully shuts down the router.
func (s *App) Shutdown(ctx context.Context) (err error) {

	if s.activeServer != nil {
		if err := s.activeServer.Shutdown(ctx); err != nil {
			err = errors.Join(err, fmt.Errorf("failed to shutdown server: %w", err))
		}
	}

	if s.tracerProvider != nil {
		if err := s.tracerProvider.ForceFlush(ctx); err != nil {
			err = errors.Join(err, fmt.Errorf("failed to force flush tracer: %w", err))
		}
		if err := s.tracerProvider.Shutdown(ctx); err != nil {
			err = errors.Join(err, fmt.Errorf("failed to shutdown tracer: %w", err))
		}
	}

	return err
}

// Shutdown gracefully shuts down the server.
func (s *Router) Shutdown(ctx context.Context) (err error) {
	if s.server != nil {
		if err := s.server.Shutdown(ctx); err != nil {
			return err
		}
	}

	return err
}

func WithListenerAddr(addr string) Option {
	return func(s *App) {
		s.addr = addr
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

func WithCors(corsOpts *cors.Options) Option {
	return func(s *App) {
		s.corsOptions = corsOpts
	}
}

func WithGraphQLPath(path string) Option {
	return func(s *App) {
		s.graphqlPath = path
	}
}

func WithProduction(enable bool) Option {
	return func(s *App) {
		s.production = enable
	}
}

func WithConfigFetcher(cf *controlplane.ConfigFetcher) Option {
	return func(s *App) {
		s.configFetcher = cf
	}
}

func WithGracePeriod(timeout time.Duration) Option {
	return func(s *App) {
		s.gracePeriod = timeout
	}
}

func WithFederatedGraphName(name string) Option {
	return func(s *App) {
		s.federatedGraphName = name
	}
}

// CorsDefaultOptions returns the default CORS options for the rs/cors package.
func CorsDefaultOptions() *cors.Options {
	return &cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{
			http.MethodHead,
			http.MethodGet,
			http.MethodPost,
		},
		AllowedHeaders:   []string{},
		AllowCredentials: false,
	}
}

func WithGraphApiToken(token string) Option {
	return func(s *App) {
		s.graphApiToken = token
	}
}
