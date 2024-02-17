package config

import (
	"github.com/santhosh-tekuri/jsonschema/v5"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestConfigRequiredValues(t *testing.T) {
	_, err := LoadConfig("./fixtures/with_required_values.yaml", "")
	require.ErrorContains(t, err, "either router config path or graph token must be provided")
}

func TestTokenNotRequiredWhenPassingStaticConfig(t *testing.T) {
	_, err := LoadConfig("./fixtures/with_static_execution_config.yaml", "")

	require.NoError(t, err)
}

func TestCustomBytesExtension(t *testing.T) {
	_, err := LoadConfig("./fixtures/minimum_bytes_error.yaml", "")

	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)

	require.Equal(t, js.Causes[0].KeywordLocation, "/properties/traffic_shaping/properties/router/properties/max_request_body_size/bytes")
	require.Equal(t, js.Causes[0].Message, "must be greater or equal than 1.0 MB, given 1.0 kB")
}

func TestCustomGoDurationExtension(t *testing.T) {
	_, err := LoadConfig("./fixtures/min_duration_error.yaml", "")

	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)

	require.Equal(t, js.Causes[0].KeywordLocation, "/properties/telemetry/properties/tracing/properties/exporters/items/properties/export_timeout/duration")
	require.Equal(t, js.Causes[0].Message, "must be greater or equal than 5s, given 1s")

	_, err = LoadConfig("./fixtures/max_duration_error.yaml", "")

	require.ErrorAs(t, err, &js)

	require.Equal(t, js.Causes[0].KeywordLocation, "/properties/telemetry/properties/tracing/properties/exporters/items/properties/export_timeout/duration")
	require.Equal(t, js.Causes[0].Message, "must be less oe equal than 2m0s, given 5m0s")
}

func TestDefaults(t *testing.T) {
	cfg, err := LoadConfig("./fixtures/minimal.yaml", "")

	require.NoError(t, err)

	require.Equal(t, cfg.Graph.Token, "token")
	require.Equal(t, cfg.LogLevel, "info")
	require.Equal(t, cfg.ListenAddr, "localhost:3003")
	require.Equal(t, cfg.ControlplaneURL, "https://cosmo-cp.wundergraph.com")
	require.Equal(t, cfg.PlaygroundEnabled, true)
	require.Equal(t, cfg.PlaygroundPath, "/")
	require.Equal(t, cfg.IntrospectionEnabled, true)
	require.Equal(t, cfg.JSONLog, true)
	require.Equal(t, cfg.InstanceID, "")
	require.Equal(t, cfg.Cluster.Name, "")
	require.Equal(t, cfg.ShutdownDelay, time.Duration(60)*time.Second)
	require.Equal(t, cfg.GracePeriod, time.Duration(20)*time.Second)
	require.Equal(t, cfg.PollInterval, time.Duration(10)*time.Second)
	require.Equal(t, cfg.HealthCheckPath, "/health")
	require.Equal(t, cfg.ReadinessCheckPath, "/health/ready")
	require.Equal(t, cfg.LivenessCheckPath, "/health/live")
	require.Equal(t, cfg.RouterConfigPath, "")
	require.Equal(t, cfg.DevelopmentMode, false)

	// OverrideRoutingURL

	require.Equal(t, cfg.OverrideRoutingURL, OverrideRoutingURLConfiguration{
		Subgraphs: map[string]string{},
	})

	// Events

	require.Equal(t, cfg.Events, EventsConfiguration{
		Sources: []EventSource{},
	})

	// GraphqlMetrics

	require.Equal(t, cfg.GraphqlMetrics, GraphqlMetrics{
		Enabled:           true,
		CollectorEndpoint: "https://cosmo-metrics.wundergraph.com",
	})

	// CDN

	require.Equal(t, cfg.CDN, CDNConfiguration{
		URL:       "https://cosmo-cdn.wundergraph.com",
		CacheSize: 100000000,
	})

	// EngineExecutionConfiguration

	require.Equal(t, cfg.EngineExecutionConfiguration, EngineExecutionConfiguration{
		Debug: EngineDebugConfiguration{
			PrintOperationTransformations: false,
			PrintOperationEnableASTRefs:   false,
			PrintPlanningPaths:            false,
			PrintQueryPlans:               false,
			PrintNodeSuggestions:          false,
			ConfigurationVisitor:          false,
			PlanningVisitor:               false,
			DatasourceVisitor:             false,
			ReportWebSocketConnections:    false,
			ReportMemoryUsage:             false,
		},
		EnableSingleFlight:                     true,
		EnableRequestTracing:                   true,
		EnableExecutionPlanCacheResponseHeader: false,
		MaxConcurrentResolvers:                 1024,
		EnableWebSocketEpollKqueue:             true,
		EpollKqueuePollTimeout:                 time.Duration(1) * time.Second,
		EpollKqueueConnBufferSize:              128,
		WebSocketReadTimeout:                   time.Duration(5) * time.Second,
		ExecutionPlanCacheSize:                 10000,
	})

	// Authorization

	require.Equal(t, cfg.Authorization, AuthorizationConfiguration{
		RejectOperationIfUnauthorized: false,
		RequireAuthentication:         false,
	})

	// Authentication

	require.Equal(t, cfg.Authentication, AuthenticationConfiguration{
		Providers: []AuthenticationProvider{},
	})

	// CORS

	require.Equal(t, cfg.CORS, CORS{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"HEAD", "GET", "POST"},
		AllowHeaders:     []string{"Origin", "Content-Length", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           time.Duration(5) * time.Minute,
	})

	// Headers
	require.Equal(t, cfg.Headers, HeaderRules{})

	// Traffic shaping
	require.Equal(t, cfg.TrafficShaping, TrafficShapingRules{
		Router: RouterTrafficConfiguration{
			MaxRequestBodyBytes: 5000000,
		},
		All: GlobalSubgraphRequestRule{
			BackoffJitterRetry: BackoffJitterRetry{
				Enabled:     true,
				Algorithm:   "backoff_jitter",
				MaxAttempts: 5,
				MaxDuration: time.Duration(10) * time.Second,
				Interval:    time.Duration(3) * time.Second,
			},
			RequestTimeout:         time.Duration(60) * time.Second,
			DialTimeout:            time.Duration(30) * time.Second,
			ResponseHeaderTimeout:  0,
			ExpectContinueTimeout:  0,
			TLSHandshakeTimeout:    time.Duration(10) * time.Second,
			KeepAliveIdleTimeout:   0,
			KeepAliveProbeInterval: time.Duration(30) * time.Second,
		},
	})

	// Rate limit

	require.Equal(t, cfg.RateLimit.Enabled, false)
	require.Equal(t, cfg.RateLimit.Debug, false)
	require.Equal(t, cfg.RateLimit.SimpleStrategy.Rate, 10)
	require.Equal(t, cfg.RateLimit.SimpleStrategy.Burst, 10)
	require.Equal(t, cfg.RateLimit.SimpleStrategy.Period, time.Duration(1)*time.Second)
	require.Equal(t, cfg.RateLimit.SimpleStrategy.RejectExceedingRequests, false)

	// Telemetry

	require.Equal(t, cfg.Telemetry.ServiceName, "cosmo-router")
	require.Equal(t, cfg.Telemetry.Metrics, Metrics{
		OTLP: MetricsOTLP{
			Enabled:       true,
			RouterRuntime: true,
			Exporters:     []MetricsOTLPExporter{},
		},
		Prometheus: Prometheus{
			Enabled:             true,
			ExcludeMetrics:      nil,
			ExcludeMetricLabels: nil,
			ListenAddr:          "127.0.0.1:8088",
			Path:                "/metrics",
		},
	})
	require.Equal(t, cfg.Telemetry.Tracing.Propagation, PropagationConfig{
		TraceContext: true,
	})

}
