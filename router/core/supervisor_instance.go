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

// newRouter creates a new router instance.
//
// additionalOptions can be used to override default options or options provided in the config.
func newRouter(ctx context.Context, params RouterResources, additionalOptions ...Option) (*Router, error) {
	cfg := params.Config
	logger := params.Logger

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

	options := optionsFromResources(logger, cfg)
	options = append(options, additionalOptions...)

	authenticators, err := setupAuthenticators(ctx, logger, cfg)
	if err != nil {
		return nil, fmt.Errorf("could not setup authenticators: %w", err)
	}

	if len(authenticators) > 0 {
		options = append(options, WithAccessController(NewAccessController(authenticators, cfg.Authorization.RequireAuthentication)))
	}

	// HTTP_PROXY, HTTPS_PROXY and NO_PROXY
	if hasProxyConfigured() {
		options = append(options, WithProxy(http.ProxyFromEnvironment))
	}

	if cfg.AccessLogs.Enabled {
		c := &AccessLogsConfig{
			Attributes:            cfg.AccessLogs.Router.Fields,
			IgnoreQueryParamsList: cfg.AccessLogs.Router.IgnoreQueryParamsList,
			SubgraphEnabled:       cfg.AccessLogs.Subgraphs.Enabled,
			SubgraphAttributes:    cfg.AccessLogs.Subgraphs.Fields,
		}

		if cfg.AccessLogs.Output.File.Enabled {
			f, err := logging.NewLogFile(cfg.AccessLogs.Output.File.Path, os.FileMode(cfg.AccessLogs.Output.File.Mode))
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

	return NewRouter(options...)
}

func optionsFromResources(logger *zap.Logger, config *config.Config) []Option {
	options := []Option{
		WithListenerAddr(config.ListenAddr),
		WithOverrideRoutingURL(config.OverrideRoutingURL),
		WithOverrides(config.Overrides),
		WithLogger(logger),
		WithIntrospection(config.IntrospectionEnabled),
		WithQueryPlans(config.QueryPlansEnabled),
		WithPlayground(config.PlaygroundEnabled),
		WithGraphApiToken(config.Graph.Token),
		WithPersistedOperationsConfig(config.PersistedOperationsConfig),
		WithAutomatedPersistedQueriesConfig(config.AutomaticPersistedQueries),
		WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags),
		WithApolloRouterCompatibilityFlags(config.ApolloRouterCompatibilityFlags),
		WithStorageProviders(config.StorageProviders),
		WithGraphQLPath(config.GraphQLPath),
		WithModulesConfig(config.Modules),
		WithGracePeriod(config.GracePeriod),
		WithPlaygroundConfig(config.PlaygroundConfig),
		WithPlaygroundPath(config.PlaygroundPath),
		WithHealthCheckPath(config.HealthCheckPath),
		WithLivenessCheckPath(config.LivenessCheckPath),
		WithGraphQLMetrics(&GraphQLMetricsConfig{
			Enabled:           config.GraphqlMetrics.Enabled,
			CollectorEndpoint: config.GraphqlMetrics.CollectorEndpoint,
		}),
		WithAnonymization(&IPAnonymizationConfig{
			Enabled: config.Compliance.AnonymizeIP.Enabled,
			Method:  IPAnonymizationMethod(config.Compliance.AnonymizeIP.Method),
		}),
		WithBatching(&BatchingConfig{
			Enabled:               config.Batching.Enabled,
			MaxConcurrentRoutines: config.Batching.MaxConcurrency,
			MaxEntriesPerBatch:    config.Batching.MaxEntriesPerBatch,
			OmitExtensions:        config.Batching.OmitExtensions,
		}),
		WithClusterName(config.Cluster.Name),
		WithInstanceID(config.InstanceID),
		WithReadinessCheckPath(config.ReadinessCheckPath),
		WithHeaderRules(config.Headers),
		WithRouterTrafficConfig(&config.TrafficShaping.Router),
		WithFileUploadConfig(&config.FileUpload),
		WithSubgraphTransportOptions(NewSubgraphTransportOptions(config.TrafficShaping)),
		WithSubgraphCircuitBreakerOptions(NewSubgraphCircuitBreakerOptions(config.TrafficShaping)),
		WithSubgraphRetryOptions(
			config.TrafficShaping.All.BackoffJitterRetry.Enabled,
			config.TrafficShaping.All.BackoffJitterRetry.Algorithm,
			config.TrafficShaping.All.BackoffJitterRetry.MaxAttempts,
			config.TrafficShaping.All.BackoffJitterRetry.MaxDuration,
			config.TrafficShaping.All.BackoffJitterRetry.Interval,
			config.TrafficShaping.All.BackoffJitterRetry.Expression,
			nil,
		),
		WithCors(&cors.Config{
			Enabled:          config.CORS.Enabled,
			AllowOrigins:     config.CORS.AllowOrigins,
			AllowMethods:     config.CORS.AllowMethods,
			AllowCredentials: config.CORS.AllowCredentials,
			AllowHeaders:     config.CORS.AllowHeaders,
			MaxAge:           config.CORS.MaxAge,
		}),
		WithTLSConfig(&TlsConfig{
			Enabled:  config.TLS.Server.Enabled,
			CertFile: config.TLS.Server.CertFile,
			KeyFile:  config.TLS.Server.KeyFile,
			ClientAuth: &TlsClientAuthConfig{
				CertFile: config.TLS.Server.ClientAuth.CertFile,
				Required: config.TLS.Server.ClientAuth.Required,
			},
		}),
		WithDevelopmentMode(config.DevelopmentMode),
		WithTracing(TraceConfigFromTelemetry(&config.Telemetry)),
		WithMetrics(MetricConfigFromTelemetry(&config.Telemetry)),
		WithTelemetryAttributes(config.Telemetry.Attributes),
		WithTracingAttributes(config.Telemetry.Tracing.Attributes),
		WithEngineExecutionConfig(config.EngineExecutionConfiguration),
		WithCacheControlPolicy(config.CacheControl),
		WithSecurityConfig(config.SecurityConfiguration),
		WithAuthorizationConfig(&config.Authorization),
		WithWebSocketConfiguration(&config.WebSocket),
		WithSubgraphErrorPropagation(config.SubgraphErrorPropagation),
		WithLocalhostFallbackInsideDocker(config.LocalhostFallbackInsideDocker),
		WithCDN(config.CDN),
		WithEvents(config.Events),
		WithRateLimitConfig(&config.RateLimit),
		WithClientHeader(config.ClientHeader),
		WithCacheWarmupConfig(&config.CacheWarmup),
		WithMCP(config.MCP),
		WithPlugins(config.Plugins),
		WithDemoMode(config.DemoMode),
	}

	return options
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

			Secret:    jwks.Secret,
			Algorithm: jwks.Algorithm,
			KeyId:     jwks.KeyId,

			Audiences: jwks.Audiences,
			RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
				Enabled:  jwks.RefreshUnknownKID.Enabled,
				MaxWait:  jwks.RefreshUnknownKID.MaxWait,
				Interval: jwks.RefreshUnknownKID.Interval,
				Burst:    jwks.RefreshUnknownKID.Burst,
			},
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
