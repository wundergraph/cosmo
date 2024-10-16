package cmd

import (
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"net/http"
	"os"

	"github.com/KimMachineGun/automemlimit/memlimit"
	"github.com/dustin/go-humanize"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"go.uber.org/automaxprocs/maxprocs"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

// Params are all required for the router to start up
type Params struct {
	Config *config.Config
	Logger *zap.Logger
}

// NewRouter creates a new router instance.
//
// additionalOptions can be used to override default options or options provided in the config.
func NewRouter(params Params, additionalOptions ...core.Option) (*core.Router, error) {
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

	var authenticators []authentication.Authenticator
	for i, auth := range cfg.Authentication.Providers {
		if auth.JWKS != nil {
			name := auth.Name
			if name == "" {
				name = fmt.Sprintf("jwks-#%d", i)
			}
			tokenDecoder, _ := authentication.NewJwksTokenDecoder(auth.JWKS.URL, auth.JWKS.RefreshInterval)
			opts := authentication.HttpHeaderAuthenticatorOptions{
				Name:                name,
				URL:                 auth.JWKS.URL,
				HeaderNames:         auth.JWKS.HeaderNames,
				HeaderValuePrefixes: auth.JWKS.HeaderValuePrefixes,
				TokenDecoder:        tokenDecoder,
			}
			authenticator, err := authentication.NewHttpHeaderAuthenticator(opts)
			if err != nil {
				logger.Fatal("Could not create HttpHeader authenticator", zap.Error(err), zap.String("name", name))
			}
			authenticators = append(authenticators, authenticator)

			if cfg.WebSocket.Authentication.FromInitialPayload.Enabled {
				opts := authentication.WebsocketInitialPayloadAuthenticatorOptions{
					TokenDecoder:        tokenDecoder,
					Key:                 cfg.WebSocket.Authentication.FromInitialPayload.Key,
					HeaderValuePrefixes: auth.JWKS.HeaderValuePrefixes,
				}
				authenticator, err = authentication.NewWebsocketInitialPayloadAuthenticator(opts)
				if err != nil {
					logger.Fatal("Could not create WebsocketInitialPayload authenticator", zap.Error(err))
				}
				authenticators = append(authenticators, authenticator)
			}
		}
	}

	options := []core.Option{
		core.WithListenerAddr(cfg.ListenAddr),
		core.WithOverrideRoutingURL(cfg.OverrideRoutingURL),
		core.WithOverrides(cfg.Overrides),
		core.WithLogger(logger),
		core.WithIntrospection(cfg.IntrospectionEnabled),
		core.WithQueryPlans(cfg.QueryPlansEnabled),
		core.WithPlayground(cfg.PlaygroundEnabled),
		core.WithGraphApiToken(cfg.Graph.Token),
		core.WithPersistedOperationsConfig(cfg.PersistedOperationsConfig),
		core.WithApolloCompatibilityFlagsConfig(cfg.ApolloCompatibilityFlags),
		core.WithStorageProviders(cfg.StorageProviders),
		core.WithGraphQLPath(cfg.GraphQLPath),
		core.WithModulesConfig(cfg.Modules),
		core.WithGracePeriod(cfg.GracePeriod),
		core.WithPlaygroundPath(cfg.PlaygroundPath),
		core.WithHealthCheckPath(cfg.HealthCheckPath),
		core.WithLivenessCheckPath(cfg.LivenessCheckPath),
		core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
			Enabled:           cfg.GraphqlMetrics.Enabled,
			CollectorEndpoint: cfg.GraphqlMetrics.CollectorEndpoint,
		}),
		core.WithAnonymization(&core.IPAnonymizationConfig{
			Enabled: cfg.Compliance.AnonymizeIP.Enabled,
			Method:  core.IPAnonymizationMethod(cfg.Compliance.AnonymizeIP.Method),
		}),
		core.WithClusterName(cfg.Cluster.Name),
		core.WithInstanceID(cfg.InstanceID),
		core.WithReadinessCheckPath(cfg.ReadinessCheckPath),
		core.WithHeaderRules(cfg.Headers),
		core.WithRouterTrafficConfig(&cfg.TrafficShaping.Router),
		core.WithFileUploadConfig(&cfg.FileUpload),
		core.WithSubgraphTransportOptions(&core.SubgraphTransportOptions{
			RequestTimeout:         cfg.TrafficShaping.All.RequestTimeout,
			ResponseHeaderTimeout:  cfg.TrafficShaping.All.ResponseHeaderTimeout,
			ExpectContinueTimeout:  cfg.TrafficShaping.All.ExpectContinueTimeout,
			KeepAliveIdleTimeout:   cfg.TrafficShaping.All.KeepAliveIdleTimeout,
			DialTimeout:            cfg.TrafficShaping.All.DialTimeout,
			TLSHandshakeTimeout:    cfg.TrafficShaping.All.TLSHandshakeTimeout,
			KeepAliveProbeInterval: cfg.TrafficShaping.All.KeepAliveProbeInterval,
		}),
		core.WithSubgraphRetryOptions(
			cfg.TrafficShaping.All.BackoffJitterRetry.Enabled,
			cfg.TrafficShaping.All.BackoffJitterRetry.MaxAttempts,
			cfg.TrafficShaping.All.BackoffJitterRetry.MaxDuration,
			cfg.TrafficShaping.All.BackoffJitterRetry.Interval,
		),
		core.WithCors(&cors.Config{
			Enabled:          cfg.CORS.Enabled,
			AllowOrigins:     cfg.CORS.AllowOrigins,
			AllowMethods:     cfg.CORS.AllowMethods,
			AllowCredentials: cfg.CORS.AllowCredentials,
			AllowHeaders:     cfg.CORS.AllowHeaders,
			MaxAge:           cfg.CORS.MaxAge,
		}),
		core.WithTLSConfig(&core.TlsConfig{
			Enabled:  cfg.TLS.Server.Enabled,
			CertFile: cfg.TLS.Server.CertFile,
			KeyFile:  cfg.TLS.Server.KeyFile,
			ClientAuth: &core.TlsClientAuthConfig{
				CertFile: cfg.TLS.Server.ClientAuth.CertFile,
				Required: cfg.TLS.Server.ClientAuth.Required,
			},
		}),
		core.WithDevelopmentMode(cfg.DevelopmentMode),
		core.WithTracing(core.TraceConfigFromTelemetry(&cfg.Telemetry)),
		core.WithMetrics(core.MetricConfigFromTelemetry(&cfg.Telemetry)),
		core.WithEngineExecutionConfig(cfg.EngineExecutionConfiguration),
		core.WithCacheControlPolicy(cfg.CacheControl),
		core.WithSecurityConfig(cfg.SecurityConfiguration),
		core.WithAuthorizationConfig(&cfg.Authorization),
		core.WithWebSocketConfiguration(&cfg.WebSocket),
		core.WithSubgraphErrorPropagation(cfg.SubgraphErrorPropagation),
		core.WithLocalhostFallbackInsideDocker(cfg.LocalhostFallbackInsideDocker),
		core.WithCDN(cfg.CDN),
		core.WithEvents(cfg.Events),
		core.WithRateLimitConfig(&cfg.RateLimit),
		core.WithClientHeader(cfg.ClientHeader),
	}

	// HTTP_PROXY, HTTPS_PROXY and NO_PROXY
	if hasProxyConfigured() {
		core.WithProxy(http.ProxyFromEnvironment)
	}

	options = append(options, additionalOptions...)

	if cfg.AccessLogs.Enabled {

		c := &core.AccessLogsConfig{
			Attributes: cfg.AccessLogs.Fields,
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
					Debug:         false,
					Level:         zap.InfoLevel,
					Pretty:        cfg.DevelopmentMode,
				})
				if err != nil {
					return nil, fmt.Errorf("could not create buffered logger: %w", err)
				}
				c.Logger = bl.Logger
			} else {
				c.Logger = logging.NewZapAccessLogger(f, cfg.DevelopmentMode)
			}
		} else if cfg.AccessLogs.Output.Stdout.Enabled {

			if cfg.AccessLogs.Buffer.Enabled {
				bl, err := logging.NewJSONZapBufferedLogger(logging.BufferedLoggerOptions{
					WS:            os.Stdout,
					BufferSize:    int(cfg.AccessLogs.Buffer.Size.Uint64()),
					FlushInterval: cfg.AccessLogs.Buffer.FlushInterval,
					Debug:         false,
					Level:         zap.InfoLevel,
					Pretty:        cfg.DevelopmentMode,
				})
				if err != nil {
					return nil, fmt.Errorf("could not create buffered logger: %w", err)
				}
				c.Logger = bl.Logger
			} else {
				c.Logger = logging.NewZapAccessLogger(os.Stdout, cfg.DevelopmentMode)
			}
		}

		options = append(options, core.WithAccessLogs(c))
	}

	if cfg.RouterRegistration && cfg.Graph.Token != "" {
		selfRegister, err := selfregister.New(cfg.ControlplaneURL, cfg.Graph.Token,
			selfregister.WithLogger(logger),
		)
		if err != nil {
			return nil, fmt.Errorf("could not create self register: %w", err)
		}
		options = append(options, core.WithSelfRegistration(selfRegister))
	}

	executionConfigPath := cfg.ExecutionConfig.File.Path
	if executionConfigPath == "" {
		executionConfigPath = cfg.RouterConfigPath
	}

	if executionConfigPath != "" {
		options = append(options, core.WithExecutionConfig(&core.ExecutionConfig{
			Watch: cfg.ExecutionConfig.File.Watch,
			Path:  executionConfigPath,
		}))
	} else {
		options = append(options, core.WithConfigPollerConfig(&core.RouterConfigPollerConfig{
			GraphSignKey:    cfg.Graph.SignKey,
			PollInterval:    cfg.PollInterval,
			ExecutionConfig: cfg.ExecutionConfig,
		}))
	}

	if len(authenticators) > 0 {
		options = append(options, core.WithAccessController(core.NewAccessController(authenticators, cfg.Authorization.RequireAuthentication)))
	}

	return core.NewRouter(options...)
}

func hasProxyConfigured() bool {
	_, httpProxy := os.LookupEnv("HTTP_PROXY")
	_, httpsProxy := os.LookupEnv("HTTPS_PROXY")
	_, noProxy := os.LookupEnv("NO_PROXY")
	return httpProxy || httpsProxy || noProxy
}
