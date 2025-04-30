package core

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/KimMachineGun/automemlimit/memlimit"
	"github.com/dustin/go-humanize"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/automaxprocs/maxprocs"
	"go.uber.org/zap"
)

// RouterCreateParams are all required for the router to start up
type RouterCreateParams struct {
	Config *config.Config
	Logger *zap.Logger
}

// newRouter creates a new router instance.
//
// additionalOptions can be used to override default options or options provided in the config.
func newRouter(ctx context.Context, params RouterCreateParams, additionalOptions ...Option) (*Router, error) {
	// Automatically set GOMAXPROCS to avoid CPU throttling on containerized environments
	_, err := maxprocs.Set(maxprocs.Logger(params.Logger.Sugar().Debugf))
	if err != nil {
		return nil, fmt.Errorf("could not set max GOMAXPROCS: %w", err)
	}

	if os.Getenv("GOMEMLIMIT") != "" {
		params.Logger.Info("GOMEMLIMIT set by user", zap.String("limit", os.Getenv("GOMEMLIMIT")))
	} else {
		// Automatically set GOMEMLIMIT to 90% of the available memory.
		// This is an effort to prevent the router from being killed by OOM (Out Of Memory)
		// when the system is under memory pressure e.g. when GC is not able to free memory fast enough.
		// More details: https://tip.golang.org/doc/gc-guide#Memory_limit
		mLimit, err := memlimit.SetGoMemLimitWithOpts(
			memlimit.WithRatio(0.9),
			memlimit.WithProvider(memlimit.FromCgroupHybrid),
		)
		if err == nil {
			params.Logger.Info("GOMEMLIMIT set automatically", zap.String("limit", humanize.Bytes(uint64(mLimit))))
		} else if !params.Config.DevelopmentMode {
			params.Logger.Warn("GOMEMLIMIT was not set. Please set it manually to around 90% of the available memory to prevent OOM kills", zap.Error(err))
		}
	}

	cfg := params.Config
	logger := params.Logger

	authenticators, err := setupAuthenticators(ctx, logger, cfg)
	if err != nil {
		return nil, fmt.Errorf("could not setup authenticators: %w", err)
	}

	options := []Option{
		WithListenerAddr(cfg.ListenAddr),
		WithOverrideRoutingURL(cfg.OverrideRoutingURL),
		WithOverrides(cfg.Overrides),
		WithLogger(logger),
		WithIntrospection(cfg.IntrospectionEnabled),
		WithQueryPlans(cfg.QueryPlansEnabled),
		WithPlayground(cfg.PlaygroundEnabled),
		WithGraphApiToken(cfg.Graph.Token),
		WithPersistedOperationsConfig(cfg.PersistedOperationsConfig),
		WithAutomatedPersistedQueriesConfig(cfg.AutomaticPersistedQueries),
		WithApolloCompatibilityFlagsConfig(cfg.ApolloCompatibilityFlags),
		WithApolloRouterCompatibilityFlags(cfg.ApolloRouterCompatibilityFlags),
		WithStorageProviders(cfg.StorageProviders),
		WithGraphQLPath(cfg.GraphQLPath),
		WithModulesConfig(cfg.Modules),
		WithGracePeriod(cfg.GracePeriod),
		WithPlaygroundConfig(cfg.PlaygroundConfig),
		WithPlaygroundPath(cfg.PlaygroundPath),
		WithHealthCheckPath(cfg.HealthCheckPath),
		WithLivenessCheckPath(cfg.LivenessCheckPath),
		WithGraphQLMetrics(&GraphQLMetricsConfig{
			Enabled:           cfg.GraphqlMetrics.Enabled,
			CollectorEndpoint: cfg.GraphqlMetrics.CollectorEndpoint,
		}),
		WithAnonymization(&IPAnonymizationConfig{
			Enabled: cfg.Compliance.AnonymizeIP.Enabled,
			Method:  IPAnonymizationMethod(cfg.Compliance.AnonymizeIP.Method),
		}),
		WithBatching(&BatchingConfig{
			Enabled:               cfg.Batching.Enabled,
			MaxConcurrentRoutines: cfg.Batching.MaxConcurrency,
			MaxEntriesPerBatch:    cfg.Batching.MaxEntriesPerBatch,
			OmitExtensions:        cfg.Batching.OmitExtensions,
		}),
		WithClusterName(cfg.Cluster.Name),
		WithInstanceID(cfg.InstanceID),
		WithReadinessCheckPath(cfg.ReadinessCheckPath),
		WithHeaderRules(cfg.Headers),
		WithRouterTrafficConfig(&cfg.TrafficShaping.Router),
		WithFileUploadConfig(&cfg.FileUpload),
		WithSubgraphTransportOptions(NewSubgraphTransportOptions(cfg.TrafficShaping)),
		WithSubgraphRetryOptions(
			cfg.TrafficShaping.All.BackoffJitterRetry.Enabled,
			cfg.TrafficShaping.All.BackoffJitterRetry.MaxAttempts,
			cfg.TrafficShaping.All.BackoffJitterRetry.MaxDuration,
			cfg.TrafficShaping.All.BackoffJitterRetry.Interval,
		),
		WithCors(&cors.Config{
			Enabled:          cfg.CORS.Enabled,
			AllowOrigins:     cfg.CORS.AllowOrigins,
			AllowMethods:     cfg.CORS.AllowMethods,
			AllowCredentials: cfg.CORS.AllowCredentials,
			AllowHeaders:     cfg.CORS.AllowHeaders,
			MaxAge:           cfg.CORS.MaxAge,
		}),
		WithTLSConfig(&TlsConfig{
			Enabled:  cfg.TLS.Server.Enabled,
			CertFile: cfg.TLS.Server.CertFile,
			KeyFile:  cfg.TLS.Server.KeyFile,
			ClientAuth: &TlsClientAuthConfig{
				CertFile: cfg.TLS.Server.ClientAuth.CertFile,
				Required: cfg.TLS.Server.ClientAuth.Required,
			},
		}),
		WithDevelopmentMode(cfg.DevelopmentMode),
		WithTracing(TraceConfigFromTelemetry(&cfg.Telemetry)),
		WithMetrics(MetricConfigFromTelemetry(&cfg.Telemetry)),
		WithTelemetryAttributes(cfg.Telemetry.Attributes),
		WithEngineExecutionConfig(cfg.EngineExecutionConfiguration),
		WithCacheControlPolicy(cfg.CacheControl),
		WithSecurityConfig(cfg.SecurityConfiguration),
		WithAuthorizationConfig(&cfg.Authorization),
		WithWebSocketConfiguration(&cfg.WebSocket),
		WithSubgraphErrorPropagation(cfg.SubgraphErrorPropagation),
		WithLocalhostFallbackInsideDocker(cfg.LocalhostFallbackInsideDocker),
		WithCDN(cfg.CDN),
		WithEvents(cfg.Events),
		WithRateLimitConfig(&cfg.RateLimit),
		WithClientHeader(cfg.ClientHeader),
		WithCacheWarmupConfig(&cfg.CacheWarmup),
		WithMCP(cfg.MCP),
		WithDemoMode(cfg.DemoMode),
	}

	// HTTP_PROXY, HTTPS_PROXY and NO_PROXY
	if hasProxyConfigured() {
		WithProxy(http.ProxyFromEnvironment)
	}

	options = append(options, additionalOptions...)

	if cfg.AccessLogs.Enabled {
		c := &AccessLogsConfig{
			Attributes:         cfg.AccessLogs.Router.Fields,
			SubgraphEnabled:    cfg.AccessLogs.Subgraphs.Enabled,
			SubgraphAttributes: cfg.AccessLogs.Subgraphs.Fields,
		}

		if cfg.AccessLogs.Output.File.Enabled {
			f, err := logging.NewLogFile(cfg.AccessLogs.Output.File.Path)
			if err != nil {
				return nil, fmt.Errorf("could not create log file: %w", err)
			}
			if cfg.AccessLogs.Buffer.Enabled {
				bl, err := logging.NewJSONZapBufferedLogger(logging.BufferedLoggerOptions{
					WS:            f,
					BufferSize:    int(cfg.AccessLogs.Buffer.Size.Uint64()),
					FlushInterval: cfg.AccessLogs.Buffer.FlushInterval,
					Development:   cfg.DevelopmentMode,
					Level:         zap.InfoLevel,
					Pretty:        !cfg.JSONLog,
				})
				if err != nil {
					return nil, fmt.Errorf("could not create buffered logger: %w", err)
				}
				c.Logger = bl.Logger
			} else {
				c.Logger = logging.NewZapAccessLogger(f, cfg.DevelopmentMode, !cfg.JSONLog)
			}
		} else if cfg.AccessLogs.Output.Stdout.Enabled {
			if cfg.AccessLogs.Buffer.Enabled {
				bl, err := logging.NewJSONZapBufferedLogger(logging.BufferedLoggerOptions{
					WS:            os.Stdout,
					BufferSize:    int(cfg.AccessLogs.Buffer.Size.Uint64()),
					FlushInterval: cfg.AccessLogs.Buffer.FlushInterval,
					Development:   cfg.DevelopmentMode,
					Level:         zap.InfoLevel,
					Pretty:        !cfg.JSONLog,
				})
				if err != nil {
					return nil, fmt.Errorf("could not create buffered logger: %w", err)
				}
				c.Logger = bl.Logger
			} else {
				c.Logger = logging.NewZapAccessLogger(os.Stdout, cfg.DevelopmentMode, !cfg.JSONLog)
			}
		}

		options = append(options, WithAccessLogs(c))
	}

	if cfg.RouterRegistration && cfg.Graph.Token != "" {
		selfRegister, err := selfregister.New(cfg.ControlplaneURL, cfg.Graph.Token,
			selfregister.WithLogger(logger),
		)
		if err != nil {
			return nil, fmt.Errorf("could not create self register: %w", err)
		}
		options = append(options, WithSelfRegistration(selfRegister))
	}

	executionConfigPath := cfg.ExecutionConfig.File.Path
	if executionConfigPath == "" {
		executionConfigPath = cfg.RouterConfigPath
	}

	if executionConfigPath != "" {
		options = append(options, WithExecutionConfig(&ExecutionConfig{
			Watch:         cfg.ExecutionConfig.File.Watch,
			WatchInterval: cfg.ExecutionConfig.File.WatchInterval,
			Path:          executionConfigPath,
		}))
	} else {
		options = append(options, WithConfigPollerConfig(&RouterConfigPollerConfig{
			GraphSignKey:    cfg.Graph.SignKey,
			PollInterval:    cfg.PollInterval,
			PollJitter:      cfg.PollJitter,
			ExecutionConfig: cfg.ExecutionConfig,
		}))
	}

	if len(authenticators) > 0 {
		options = append(options, WithAccessController(NewAccessController(authenticators, cfg.Authorization.RequireAuthentication)))
	}

	return NewRouter(options...)
}

func setupAuthenticators(ctx context.Context, logger *zap.Logger, cfg *config.Config) ([]authentication.Authenticator, error) {
	jwtConf := cfg.Authentication.JWT
	if len(jwtConf.JWKS) == 0 {
		// No JWT authenticators configured
		return nil, nil
	}

	var authenticators []authentication.Authenticator
	configs := make([]authentication.JWKSConfig, 0, len(jwtConf.JWKS))

	for _, jwks := range cfg.Authentication.JWT.JWKS {
		configs = append(configs, authentication.JWKSConfig{
			URL:               jwks.URL,
			RefreshInterval:   jwks.RefreshInterval,
			AllowedAlgorithms: jwks.Algorithms,
		})
	}

	tokenDecoder, err := authentication.NewJwksTokenDecoder(ctx, logger, configs)
	if err != nil {
		return nil, err
	}

	// create a map for the `httpHeaderAuthenticator`
	headerSourceMap := map[string][]string{
		jwtConf.HeaderName: {jwtConf.HeaderValuePrefix},
	}

	// The `websocketInitialPayloadAuthenticator` has one key and uses a flat list of prefixes
	prefixSet := make(map[string]struct{})

	for _, s := range jwtConf.HeaderSources {
		if s.Type != "header" {
			continue
		}

		for _, prefix := range s.ValuePrefixes {
			headerSourceMap[s.Name] = append(headerSourceMap[s.Name], prefix)
			prefixSet[prefix] = struct{}{}
		}

	}

	opts := authentication.HttpHeaderAuthenticatorOptions{
		Name:                 "jwks",
		HeaderSourcePrefixes: headerSourceMap,
		TokenDecoder:         tokenDecoder,
	}

	authenticator, err := authentication.NewHttpHeaderAuthenticator(opts)
	if err != nil {
		logger.Error("Could not create HttpHeader authenticator", zap.Error(err))
		return nil, err
	}

	authenticators = append(authenticators, authenticator)

	if cfg.WebSocket.Authentication.FromInitialPayload.Enabled {
		headerPrefixes := make([]string, 0, len(prefixSet))
		for prefix := range prefixSet {
			headerPrefixes = append(headerPrefixes, prefix)
		}

		opts := authentication.WebsocketInitialPayloadAuthenticatorOptions{
			TokenDecoder:        tokenDecoder,
			Key:                 cfg.WebSocket.Authentication.FromInitialPayload.Key,
			HeaderValuePrefixes: headerPrefixes,
		}
		authenticator, err = authentication.NewWebsocketInitialPayloadAuthenticator(opts)
		if err != nil {
			logger.Error("Could not create WebsocketInitialPayload authenticator", zap.Error(err))
			return nil, err
		}
		authenticators = append(authenticators, authenticator)
	}

	return authenticators, nil
}

func hasProxyConfigured() bool {
	_, httpProxy := os.LookupEnv("HTTP_PROXY")
	_, httpsProxy := os.LookupEnv("HTTPS_PROXY")
	_, noProxy := os.LookupEnv("NO_PROXY")
	return httpProxy || httpsProxy || noProxy
}
