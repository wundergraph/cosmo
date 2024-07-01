package cmd

import (
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/execution_config"

	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/internal/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"go.uber.org/automaxprocs/maxprocs"

	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
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

	var routerConfig *nodev1.RouterConfig
	var configPoller configpoller.ConfigPoller
	var selfRegister selfregister.SelfRegister

	cfg := params.Config
	logger := params.Logger

	if cfg.RouterConfigPath != "" {
		routerConfig, err = execution_config.SerializeConfigFromFile(cfg.RouterConfigPath)
		if err != nil {
			logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", cfg.RouterConfigPath))
		}
	} else if cfg.Graph.Token != "" {
		routerCDN, err := cdn.NewRouterConfigClient(cfg.CDN.URL, cfg.Graph.Token, cdn.RouterConfigOptions{
			Logger:       logger,
			SignatureKey: cfg.Graph.SignKey,
		})
		if err != nil {
			return nil, err
		}

		configPoller = configpoller.New(cfg.ControlplaneURL, cfg.Graph.Token,
			configpoller.WithLogger(logger),
			configpoller.WithPollInterval(cfg.PollInterval),
			configpoller.WithCDNClient(routerCDN),
		)
	}

	if cfg.RouterRegistration && cfg.Graph.Token != "" {
		selfRegister = selfregister.New(cfg.ControlplaneURL, cfg.Graph.Token,
			selfregister.WithLogger(logger),
		)
	}

	var authenticators []authentication.Authenticator
	for i, auth := range cfg.Authentication.Providers {
		if auth.JWKS != nil {
			name := auth.Name
			if name == "" {
				name = fmt.Sprintf("jwks-#%d", i)
			}
			opts := authentication.JWKSAuthenticatorOptions{
				Name:                name,
				URL:                 auth.JWKS.URL,
				HeaderNames:         auth.JWKS.HeaderNames,
				HeaderValuePrefixes: auth.JWKS.HeaderValuePrefixes,
				RefreshInterval:     auth.JWKS.RefreshInterval,
			}
			authenticator, err := authentication.NewJWKSAuthenticator(opts)
			if err != nil {
				logger.Fatal("Could not create JWKS authenticator", zap.Error(err), zap.String("name", name))
			}
			authenticators = append(authenticators, authenticator)
		}
	}

	options := []core.Option{
		core.WithListenerAddr(cfg.ListenAddr),
		core.WithOverrideRoutingURL(cfg.OverrideRoutingURL),
		core.WithOverrides(cfg.Overrides),
		core.WithLogger(logger),
		core.WithConfigPoller(configPoller),
		core.WithSelfRegistration(selfRegister),
		core.WithIntrospection(cfg.IntrospectionEnabled),
		core.WithPlayground(cfg.PlaygroundEnabled),
		core.WithCompression(cfg.CompressionEnabled),
		core.WithGraphApiToken(cfg.Graph.Token),
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
		core.WithStaticRouterConfig(routerConfig),
		core.WithRouterTrafficConfig(&cfg.TrafficShaping.Router),
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
		core.WithSecurityConfig(cfg.SecurityConfiguration),
		core.WithAuthorizationConfig(&cfg.Authorization),
		core.WithAccessController(core.NewAccessController(authenticators, cfg.Authorization.RequireAuthentication)),
		core.WithWebSocketConfiguration(&cfg.WebSocket),
		core.WithWithSubgraphErrorPropagation(cfg.SubgraphErrorPropagation),
		core.WithLocalhostFallbackInsideDocker(cfg.LocalhostFallbackInsideDocker),
		core.WithCDN(cfg.CDN),
		core.WithEvents(cfg.Events),
		core.WithRateLimitConfig(&cfg.RateLimit),
	}

	options = append(options, additionalOptions...)

	return core.NewRouter(options...)
}
