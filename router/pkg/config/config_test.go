package config

import (
	"fmt"
	"regexp"
	"testing"
	"time"

	"github.com/goccy/go-yaml"
	"go.uber.org/zap/zapcore"

	"github.com/caarlos0/env/v11"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"
)

func TestTokenNotRequiredWhenPassingStaticConfig(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

router_config_path: "config.json"
`)
	_, err := LoadConfig([]string{f})

	require.NoError(t, err)
}

func TestCustomBytesExtension(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
# yaml-language-server: $schema=../config.schema.json

version: "1"

graph:
  token: "token"

traffic_shaping:
  router:
    max_request_body_size: 1KB
`)
	_, err := LoadConfig([]string{f})

	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)

	require.Equal(t, []string{"traffic_shaping", "router", "max_request_body_size"}, js.Causes[0].InstanceLocation)
	require.Equal(t, "at '/traffic_shaping/router/max_request_body_size': bytes must be greater or equal than 1.0 MB", js.Causes[0].Error())
}

func TestVariableExpansion(t *testing.T) {
	t.Setenv("TEST_POLL_INTERVAL", "20s")

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

poll_interval: "${TEST_POLL_INTERVAL}"
`)

	cfg, err := LoadConfig([]string{f})

	require.NoError(t, err)

	require.Equal(t, time.Second*20, cfg.Config.PollInterval)
}

func TestLoadWatchCfgFromEnvars(t *testing.T) {
	t.Setenv("WATCH_CONFIG_ENABLED", "true")
	t.Setenv("WATCH_CONFIG_INTERVAL", "30s")
	t.Setenv("WATCH_CONFIG_STARTUP_DELAY_ENABLED", "true")
	t.Setenv("WATCH_CONFIG_STARTUP_DELAY_MAXIMUM", "20s")

	f := createTempFileFromFixture(t, `
version: "1"
`)

	cfg, err := LoadConfig([]string{f})

	require.NoError(t, err)

	require.True(t, cfg.Config.WatchConfig.Enabled)
	require.True(t, cfg.Config.WatchConfig.StartupDelay.Enabled)
	require.Equal(t, time.Second*30, cfg.Config.WatchConfig.Interval)
	require.Equal(t, time.Second*20, cfg.Config.WatchConfig.StartupDelay.Maximum)
}

func TestConfigHasPrecedence(t *testing.T) {
	t.Setenv("POLL_INTERVAL", "22s")

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

poll_interval: 11s
`)

	cfg, err := LoadConfig([]string{f})

	require.NoError(t, err)

	require.Equal(t, time.Second*11, cfg.Config.PollInterval)
}

// Confirms https://github.com/caarlos0/env/issues/354 is fixed
func TestConfigSlicesHaveDefaults(t *testing.T) {
	t.Parallel()

	type TestMetricsOTLPExporter struct {
		Value       string
		Exporter    string `envDefault:"http"`
		Temporality string `envDefault:"cumulative"`
	}

	type TestMetricsOTLP struct {
		RouterRuntime bool `envDefault:"true" env:"METRICS_OTLP_ROUTER_RUNTIME"`
		Exporters     []TestMetricsOTLPExporter
	}

	config := TestMetricsOTLP{
		Exporters: []TestMetricsOTLPExporter{
			{Value: "A"},
		},
	}

	require.NoError(t, env.Parse(&config))

	require.Equal(t, "A", config.Exporters[0].Value)
	require.Equal(t, "http", config.Exporters[0].Exporter)
	require.Equal(t, "cumulative", config.Exporters[0].Temporality)
}

func TestErrorWhenConfigNotExists(t *testing.T) {
	t.Parallel()

	_, err := LoadConfig([]string{"./fixtures/not_exists.yaml"})

	require.Error(t, err)
	require.ErrorContains(t, err, "could not read custom config file ./fixtures/not_exists.yaml: open ./fixtures/not_exists.yaml: no such file or directory")
}

func TestConfigIsOptional(t *testing.T) {
	t.Setenv("GRAPH_API_TOKEN", "XXX")

	// DefaultConfigPath will not exist for this test, so we expect
	// LoadConfig to load default values.
	result, err := LoadConfig([]string{DefaultConfigPath})

	require.NoError(t, err)
	require.True(t, result.DefaultLoaded)
}

func TestRegexDecoding(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: '1'

graph:
  token: "mytoken"

telemetry:
  metrics:
    prometheus:
      # Interpreted as RegEx
      exclude_metrics: []
      exclude_metric_labels: []
`)

	cfg, err := LoadConfig([]string{f})

	require.NoError(t, err)
	require.Empty(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics)
	require.Empty(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels)

	f = createTempFileFromFixture(t, `
version: '1'

graph:
  token: "mytoken"

telemetry:
  metrics:
    prometheus:
      # Interpreted as RegEx
      exclude_metrics: ["^go_.*", "^process_.*"]
      exclude_metric_labels: ["^instance"]
`)

	cfg, err = LoadConfig([]string{f})

	require.NoError(t, err)
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics, 2)
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels, 1)
	require.Equal(t, RegExArray{regexp.MustCompile("^go_.*"), regexp.MustCompile("^process_.*")}, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics)
	require.Equal(t, RegExArray{regexp.MustCompile("^instance")}, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels)
}

func TestLogLevels(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		logLevel string
		expected zapcore.Level
	}{
		{
			name:     "debug level",
			logLevel: "debug",
			expected: zapcore.DebugLevel,
		},
		{
			name:     "info level",
			logLevel: "info",
			expected: zapcore.InfoLevel,
		},
		{
			name:     "warn level",
			logLevel: "warn",
			expected: zapcore.WarnLevel,
		},
		{
			name:     "error level",
			logLevel: "error",
			expected: zapcore.ErrorLevel,
		},
		{
			name:     "panic level",
			logLevel: "panic",
			expected: zapcore.PanicLevel,
		},
		{
			name:     "fatal level",
			logLevel: "fatal",
			expected: zapcore.FatalLevel,
		},
	}

	for _, tt := range tests {
		t.Run("parses "+tt.name, func(t *testing.T) {
			f := createTempFileFromFixture(t, fmt.Sprintf(`
version: "1"
log_level: %s
`, tt.logLevel))

			cfg, err := LoadConfig([]string{f})

			require.NoError(t, err)
			require.Equal(t, tt.expected, cfg.Config.LogLevel)
		})
	}
}

func TestCustomGoDurationExtension(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

telemetry:
  tracing:
    exporters:
      - endpoint: https://my-otel-collector.example.com
        export_timeout: 1s
`)

	_, err := LoadConfig([]string{f})

	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)

	require.Equal(t, []string{"telemetry", "tracing", "exporters", "0", "export_timeout"}, js.Causes[0].InstanceLocation)
	require.Equal(t, "at '/telemetry/tracing/exporters/0/export_timeout': duration must be greater or equal than 5s", js.Causes[0].Error())

	f = createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

telemetry:
  tracing:
    exporters:
      - endpoint: https://my-otel-collector.example.com
        export_timeout: 5m
`)

	_, err = LoadConfig([]string{f})

	require.ErrorAs(t, err, &js)

	require.Equal(t, []string{"telemetry", "tracing", "exporters", "0", "export_timeout"}, js.Causes[0].InstanceLocation)
	require.Equal(t, "at '/telemetry/tracing/exporters/0/export_timeout': duration must be less or equal than 2m0s", js.Causes[0].Error())
}

func TestLoadFullConfig(t *testing.T) {
	t.Parallel()

	cfg, err := LoadConfig([]string{"./fixtures/full.yaml"})
	require.NoError(t, err)

	g := goldie.New(
		t,
		goldie.WithFixtureDir("testdata"),
		goldie.WithNameSuffix(".json"),
		goldie.WithDiffEngine(goldie.ClassicDiff),
	)

	g.AssertJson(t, "config_full", cfg.Config)
}

func TestDefaults(t *testing.T) {
	// Set in the CI to false. We need to unset it to test the default values
	t.Setenv("ROUTER_REGISTRATION", "")

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"
`)

	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)

	g := goldie.New(
		t,
		goldie.WithFixtureDir("testdata"),
		goldie.WithNameSuffix(".json"),
		goldie.WithDiffEngine(goldie.ClassicDiff),
	)

	g.AssertJson(t, "config_defaults", cfg.Config)
}

func TestOverrides(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

overrides:
  subgraphs:
    some-subgraph:
      routing_url: http://router:3002/graphql
      subscription_url: http://router:3002/graphql/ws
      subscription_protocol: ws
      subscription_websocket_subprotocol: graphql-ws
`)
	_, err := LoadConfig([]string{f})
	require.NoError(t, err)
}

func TestOverridesWithWrongValue(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

overrides:
  subgraphs:
    some-subgraph:
      routing_url: a
      subscription_url: http://router:3002/graphql/ws
      subscription_protocol: ws
      subscription_websocket_subprotocol: graphql-ws
`)
	_, err := LoadConfig([]string{f})
	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)
	require.Equal(t, "at '/overrides/subgraphs/some-subgraph/routing_url': 'a' is not valid http-url: invalid URL", js.Causes[0].Error())
}

func TestValidPersistedOperations(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

storage_providers:
  s3:
    - id: "s3"
      endpoint: "localhost:10000"
      bucket: "cosmo"
      access_key: "Pj6opX3288YukriGCzIr"
      secret_key: "WNMg9X4fzMva18henO6XLX4qRHEArwYdT7Yt84w9"
      secure: false

persisted_operations:
  cache:
    size: 100MB
  storage:
    provider_id: s3
    object_prefix: "5ef73d80-cae4-4d0e-98a7-1e9fa922c1a4/92c25b45-a75b-4954-b8f6-6592a9b203eb/operations/foo"
`)
	_, err := LoadConfig([]string{f})
	var js *jsonschema.ValidationError
	require.NoError(t, err, &js)

	f = createTempFileFromFixture(t, `
version: "1"

storage_providers:
  cdn:
    - url: https://cosmo-cdn.wundergraph.com
      id: cdn

persisted_operations:
  cache:
    size: 100MB
  storage:
    provider_id: cdn
    object_prefix: "5ef73d80-cae4-4d0e-98a7-1e9fa922c1a4/92c25b45-a75b-4954-b8f6-6592a9b203eb/operations/foo"
`)
	_, err = LoadConfig([]string{f})
	js = &jsonschema.ValidationError{}
	require.NoError(t, err, &js)
}

func TestInvalidPersistedOperations(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

storage_providers:
  s3:
    - id: "s3"
      endpoint: "localhost:10000"
      bucket: "cosmo"
      access_key: "Pj6opX3288YukriGCzIr"
      secret_key: "WNMg9X4fzMva18henO6XLX4qRHEArwYdT7Yt84w9"
      secure: false

persisted_operations:
  cache:
    size: 100MB
  storage:
    provider_id: s3
    # Missing object_prefix
`)
	_, err := LoadConfig([]string{f})
	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)
	require.Equal(t, "at '/persisted_operations/storage': missing property 'object_prefix'", js.Causes[0].Error())
}

func TestValidExecutionConfig(t *testing.T) {
	t.Parallel()

	t.Run("s3 storage config", func(t *testing.T) {

		f := createTempFileFromFixture(t, `
version: "1"

storage_providers:
  s3:
    - id: "s3"
      endpoint: "localhost:10000"
      bucket: "cosmo"
      access_key: "Pj6opX3288YukriGCzIr"
      secret_key: "WNMg9X4fzMva18henO6XLX4qRHEArwYdT7Yt84w9"
      secure: false

execution_config:
  storage:
    provider_id: s3
    object_path: "5ef73d80-cae4-4d0e-98a7-1e9fa922c1a4/92c25b45-a75b-4954-b8f6-6592a9b203eb/routerconfigs/latest.json"
`)
		_, err := LoadConfig([]string{f})
		var js *jsonschema.ValidationError
		require.NoError(t, err, &js)
	})

	t.Run("cdn storage config", func(t *testing.T) {

		f := createTempFileFromFixture(t, `
version: "1"

storage_providers:
  cdn:
    - url: https://cosmo-cdn.wundergraph.com
      id: cdn

execution_config:
  storage:
    provider_id: cdn
    object_path: "5ef73d80-cae4-4d0e-98a7-1e9fa922c1a4/92c25b45-a75b-4954-b8f6-6592a9b203eb/routerconfigs/latest.json"
`)
		_, err := LoadConfig([]string{f})
		js := &jsonschema.ValidationError{}
		require.NoError(t, err, &js)

	})

	t.Run("file config", func(t *testing.T) {

		f := createTempFileFromFixture(t, `
version: "1"

execution_config:
  file:
    path: "latest.json"
    watch: true
    watch_interval: "1s"
`)
		_, err := LoadConfig([]string{f})
		js := &jsonschema.ValidationError{}
		require.NoError(t, err, &js)
	})
}

func TestInvalidExecutionConfig(t *testing.T) {
	t.Parallel()

	t.Run("no object_path", func(t *testing.T) {

		f := createTempFileFromFixture(t, `
version: "1"

storage_providers:
  s3:
    - id: "s3"
      endpoint: "localhost:10000"
      bucket: "cosmo"
      access_key: "Pj6opX3288YukriGCzIr"
      secret_key: "WNMg9X4fzMva18henO6XLX4qRHEArwYdT7Yt84w9"
      secure: false

execution_config:
  storage:
    provider_id: s3
    # Missing object_path
`)
		_, err := LoadConfig([]string{f})
		var js *jsonschema.ValidationError
		require.ErrorAs(t, err, &js)
		require.Equal(t, "at '/execution_config': oneOf failed, none matched\n- at '/execution_config': additional properties 'storage' not allowed\n- at '/execution_config/storage': missing property 'object_path'\n- at '/execution_config': additional properties 'storage' not allowed", js.Causes[0].Error())
	})

	t.Run("too low watch interval", func(t *testing.T) {

		f := createTempFileFromFixture(t, `
version: "1"

execution_config:
  file:
    path: "latest.json"
    watch: true
    watch_interval: "10ms"
`)

		_, err := LoadConfig([]string{f})
		var js *jsonschema.ValidationError
		require.ErrorAs(t, err, &js)
		require.Equal(t, "at '/execution_config': oneOf failed, none matched\n- at '/execution_config/file/watch_interval': duration must be greater or equal than 100ms\n- at '/execution_config': additional properties 'file' not allowed\n- at '/execution_config': additional properties 'file' not allowed", js.Causes[0].Error())
	})

	t.Run("watch interval with watch disabled", func(t *testing.T) {

		f := createTempFileFromFixture(t, `
version: "1"

execution_config:
  file:
    path: "latest.json"
    watch: false
    watch_interval: "1s"
`)
		_, err := LoadConfig([]string{f})
		var js *jsonschema.ValidationError
		require.ErrorAs(t, err, &js)
		require.Equal(t, "at '/execution_config': oneOf failed, none matched\n- at '/execution_config/file/watch': value must be true\n- at '/execution_config': additional properties 'file' not allowed\n- at '/execution_config': additional properties 'file' not allowed", js.Causes[0].Error())
	})
}

func TestValidLocalExecutionConfig(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

execution_config:
  file:
    path: "router.json"
`)
	_, err := LoadConfig([]string{f})
	require.NoError(t, err)
}

func TestInvalidFileExecutionConfig(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

storage_providers:
  s3:
    - id: "s3"
      endpoint: "localhost:10000"
      bucket: "cosmo"
      access_key: "Pj6opX3288YukriGCzIr"
      secret_key: "WNMg9X4fzMva18henO6XLX4qRHEArwYdT7Yt84w9"
      secure: false

execution_config:
  file:
    path: "router.json"
  storage: # Cannot have both local and storage
    provider_id: s3
    object_path: "5ef73d80-cae4-4d0e-98a7-1e9fa922c1a4/92c25b45-a75b-4954-b8f6-6592a9b203eb/routerconfigs/latest.json"
`)
	_, err := LoadConfig([]string{f})
	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)
	require.True(t,
		js.Causes[0].Error() == "at '/execution_config': oneOf failed, none matched\n- at '/execution_config': additional properties 'storage' not allowed\n- at '/execution_config': additional properties 'file' not allowed\n- at '/execution_config': additional properties 'file', 'storage' not allowed" || js.Causes[0].Error() == "at '/execution_config': oneOf failed, none matched\n- at '/execution_config': additional properties 'storage' not allowed\n- at '/execution_config': additional properties 'file' not allowed\n- at '/execution_config': additional properties 'storage', 'file' not allowed",
	)
}

func TestClientHeaderConfig(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

client_header:
  name: "Client_Name"
  version: "Client_Version"
`)
	_, err := LoadConfig([]string{f})
	require.NoError(t, err)
}

func TestLoadPrometheusSchemaUsageConfig(t *testing.T) {
	t.Run("from file", func(t *testing.T) {
		f := createTempFileFromFixture(t, `
version: "1"

telemetry:
  metrics:
    prometheus:
      schema_usage:
        enabled: true
        include_operation_sha: true
`)
		c, err := LoadConfig([]string{f})
		require.NoError(t, err)

		require.True(t, c.Config.Telemetry.Metrics.Prometheus.SchemaFieldUsage.Enabled)
		require.True(t, c.Config.Telemetry.Metrics.Prometheus.SchemaFieldUsage.IncludeOperationSha)
	})

	t.Run("from environment", func(t *testing.T) {
		f := createTempFileFromFixture(t, `
version: "1"
`)

		c, err := LoadConfig([]string{f})
		require.NoError(t, err)

		require.False(t, c.Config.Telemetry.Metrics.Prometheus.SchemaFieldUsage.Enabled)
		require.False(t, c.Config.Telemetry.Metrics.Prometheus.SchemaFieldUsage.IncludeOperationSha)

		t.Setenv("PROMETHEUS_SCHEMA_FIELD_USAGE_ENABLED", "true")
		t.Setenv("PROMETHEUS_SCHEMA_FIELD_USAGE_INCLUDE_OPERATION_SHA", "true")

		c, err = LoadConfig([]string{f})
		require.NoError(t, err)

		require.True(t, c.Config.Telemetry.Metrics.Prometheus.SchemaFieldUsage.Enabled)
		require.True(t, c.Config.Telemetry.Metrics.Prometheus.SchemaFieldUsage.IncludeOperationSha)
	})
}

func TestPrefixedMetricEngineConfig(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"
`)
	c, err := LoadConfig([]string{f})
	require.NoError(t, err)

	require.False(t, c.Config.Telemetry.Metrics.Prometheus.EngineStats.Subscriptions)
	require.False(t, c.Config.Telemetry.Metrics.OTLP.EngineStats.Subscriptions)

	t.Setenv("PROMETHEUS_ENGINE_STATS_SUBSCRIPTIONS", "true")
	t.Setenv("METRICS_OTLP_ENGINE_STATS_SUBSCRIPTIONS", "true")

	c, err = LoadConfig([]string{f})
	require.NoError(t, err)

	require.True(t, c.Config.Telemetry.Metrics.Prometheus.EngineStats.Subscriptions)
	require.True(t, c.Config.Telemetry.Metrics.OTLP.EngineStats.Subscriptions)
}

func TestMatchAndNegateMatch(t *testing.T) {
	t.Parallel()

	t.Run("for request", func(t *testing.T) {
		t.Run("when only the matching attribute is defined", func(t *testing.T) {
			f := createTempFileFromFixture(t, `
version: "1"

headers:
  all:
    request:
      - op: propagate
        matching: .*
`)
			_, err := LoadConfig([]string{f})
			require.NoError(t, err)
		})

		t.Run("when matching is not defined but negate_match is defined", func(t *testing.T) {
			f := createTempFileFromFixture(t, `
version: "1"

headers:
  all:
    request:
      - op: propagate
        negate_match: true
`)
			_, err := LoadConfig([]string{f})
			var js *jsonschema.ValidationError
			require.ErrorAs(t, err, &js)
			require.ErrorContains(t, js.Causes[0], "at '/headers/all/request/0': properties 'matching' required, if 'negate_match' exists")
		})

		t.Run("when matching and negate_match is defined", func(t *testing.T) {
			f := createTempFileFromFixture(t, `
version: "1"

headers:
  all:
    request:
      - op: propagate
        matching: .*
        negate_match: true
`)
			_, err := LoadConfig([]string{f})
			require.NoError(t, err)
		})
	})

	t.Run("for response", func(t *testing.T) {
		t.Run("when only the matching attribute is defined", func(t *testing.T) {
			f := createTempFileFromFixture(t, `
version: "1"

headers:
  all:
    response:
      - op: propagate
        algorithm: first_write
        matching: .*
`)
			_, err := LoadConfig([]string{f})
			require.NoError(t, err)
		})

		t.Run("when matching is not defined but negate_match is defined", func(t *testing.T) {
			f := createTempFileFromFixture(t, `
version: "1"

headers:
  all:
    response:
      - op: propagate
        algorithm: first_write
        negate_match: true
`)
			_, err := LoadConfig([]string{f})
			var js *jsonschema.ValidationError
			require.ErrorAs(t, err, &js)
			require.ErrorContains(t, js.Causes[0], "at '/headers/all/response/0': properties 'matching' required, if 'negate_match' exists")
		})

		t.Run("when matching and negate_match is defined", func(t *testing.T) {
			f := createTempFileFromFixture(t, `
version: "1"

headers:
  all:
    response:
      - op: propagate
        algorithm: first_write
        matching: .*
        negate_match: true
`)
			_, err := LoadConfig([]string{f})
			require.NoError(t, err)
		})
	})

}

func TestConfigMerging(t *testing.T) {
	t.Parallel()

	getBaseConfigWithDefaults := func() Config {
		return Config{
			WatchConfig: WatchConfig{
				Interval: 6 * time.Second,
				StartupDelay: WatchConfigStartupDelay{
					Maximum: 6 * time.Second,
				},
			},
			ListenAddr:      "localhost:3007",
			ControlplaneURL: "http://localhost:3008",
			ShutdownDelay:   20 * time.Second,
			HealthCheckPath: "/health",
			PersistedOperationsConfig: PersistedOperationsConfig{
				Storage: PersistedOperationsStorageConfig{
					ProviderID:   "s3",
					ObjectPrefix: "ee",
				},
			},
			AutomaticPersistedQueries: AutomaticPersistedQueriesConfig{
				Storage: AutomaticPersistedQueriesStorageConfig{
					ProviderID:   "s3",
					ObjectPrefix: "ee",
				},
			},
			LivenessCheckPath: "/liveness",
			PollInterval:      6 * time.Second,
			GraphQLPath:       "/graphql",
			PlaygroundPath:    "/playground",
			EngineExecutionConfiguration: EngineExecutionConfiguration{
				Debug: EngineDebugConfiguration{
					PrintIntermediateQueryPlans: false,
				},
			},
			ReadinessCheckPath: "/readiness",
			SubgraphErrorPropagation: SubgraphErrorPropagationConfiguration{
				Mode: "wrapped",
			},
			ExecutionConfig: ExecutionConfig{
				File: ExecutionConfigFile{
					Path: "ee",
				},
			},
		}
	}

	t.Run("without conflicts", func(t *testing.T) {
		t.Parallel()

		base := createTempFileFromFixtureWithPattern(t, "config_test_1", `
version: "1"

readiness_check_path: "http://someurl"

headers:
  all:
    request:
      - op: propagate
        matching: .*
`)

		override1 := createTempFileFromFixtureWithPattern(t, "config_test_2", `
version: "1"

listen_addr: "localhost:3007"
`)

		override2 := createTempFileFromFixtureWithPattern(t, "config_test_3", `
version: "1"

health_check_path: "/health2"

listen_addr: "localhost:3007"
`)

		paths := []string{base, override1, override2}
		configWrapper, err := LoadConfig(paths)
		require.NoError(t, err)

		require.False(t, configWrapper.DefaultLoaded)

		config := configWrapper.Config
		require.Equal(t, "http://someurl", config.ReadinessCheckPath)
		require.Equal(t, "localhost:3007", config.ListenAddr)
		require.Equal(t, "/health2", config.HealthCheckPath)
		require.Len(t, config.Headers.All.Request, 1)

		require.Equal(t, RequestHeaderRule{
			Operation: "propagate",
			Matching:  ".*",
		}, *config.Headers.All.Request[0])
	})

	t.Run("handle conflicts", func(t *testing.T) {
		t.Parallel()

		base := createTempFileFromFixtureWithPattern(t, "config_test_1", `
version: "1"

readiness_check_path: "http://someurl"

headers:
  all:
    request:
      - op: propagate
        matching: baseList.*
`)

		override1 := createTempFileFromFixtureWithPattern(t, "config_test_2", `
version: "1"

readiness_check_path: "http://there.testing"

headers:
  all:
    request:
      - op: propagate
        matching: updatedList.*

      - op: propagate
        matching: updatedList2.*

    response:
      - op: propagate
        algorithm: first_write
        matching: updatedList.*
`)

		override2 := createTempFileFromFixtureWithPattern(t, "config_test_3", `
version: "1"

headers:
  all:
    request:
      - op: propagate
        matching: thereList1.*


    response:
      - op: propagate
        algorithm: first_write
        matching: testing1.*

      - op: propagate
        algorithm: first_write
        matching: testing2.*
`)

		paths := []string{base, override1, override2}
		configWrapper, err := LoadConfig(paths)
		require.NoError(t, err)

		require.False(t, configWrapper.DefaultLoaded)

		config := configWrapper.Config
		require.Equal(t, "http://there.testing", config.ReadinessCheckPath)
		require.Len(t, config.Headers.All.Request, 1)
		require.Len(t, config.Headers.All.Response, 2)

		require.Equal(t, RequestHeaderRule{
			Operation: "propagate",
			Matching:  "thereList1.*",
		}, *config.Headers.All.Request[0])

		require.Equal(t, ResponseHeaderRule{
			Operation: "propagate",
			Algorithm: "first_write",
			Matching:  "testing1.*",
		}, *config.Headers.All.Response[0])

		require.Equal(t, ResponseHeaderRule{
			Operation: "propagate",
			Algorithm: "first_write",
			Matching:  "testing2.*",
		}, *config.Headers.All.Response[1])
	})

	t.Run("validation errors for each config", func(t *testing.T) {
		t.Parallel()

		base := createTempFileFromFixtureWithPattern(t, "config_test_1", `
version: "1"

readiness_check_path: "http://someurl"

headers:
  all:
    request:
      - op: propagate
        matching: .*
`)

		override1 := createTempFileFromFixtureWithPattern(t, "config_test_2", `
version: "1"

listen_ad_dr: "localhost:3007"
`)

		override2 := createTempFileFromFixtureWithPattern(t, "config_test_3", `
version: "1"

health_chec_k_path: "/health2"

listen_addr: "localhost:3007"
`)

		paths := []string{base, override1, override2}
		_, err := LoadConfig(paths)
		require.Error(t, err)

		// We check given parts of the error separately since the file path is not predictable
		require.ErrorContains(t, err, "router config validation error for")
		require.ErrorContains(t, err, "config_test_")
		require.ErrorContains(t, err, "jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n- at '': ")

		require.ErrorContains(t, err, "additional properties 'listen_ad_dr' not allowed")
		require.ErrorContains(t, err, "additional properties 'health_chec_k_path' not allowed")
	})

	t.Run("process entire base config successfully", func(t *testing.T) {
		t.Parallel()

		config1 := getBaseConfigWithDefaults()
		config1Bytes, err := yaml.Marshal(&config1)
		require.NoError(t, err)

		config2 := getBaseConfigWithDefaults()
		config2Bytes, err := yaml.Marshal(&config2)
		require.NoError(t, err)

		config3 := getBaseConfigWithDefaults()
		config3Bytes, err := yaml.Marshal(&config3)
		require.NoError(t, err)

		base := createTempFileFromFixtureWithPattern(t, "testing_config_1", string(config1Bytes))
		override1 := createTempFileFromFixtureWithPattern(t, "testing_config_2", string(config2Bytes))
		override2 := createTempFileFromFixtureWithPattern(t, "testing_config_3", string(config3Bytes))

		paths := []string{base, override1, override2}
		_, err = LoadConfig(paths)
		require.NoError(t, err)
	})

	t.Run("merge full.yaml with itself successfully", func(t *testing.T) {
		t.Parallel()

		paths := []string{"./fixtures/full.yaml", "./fixtures/full.yaml", "./fixtures/full.yaml", "./fixtures/full.yaml", "./fixtures/full.yaml"}
		cfg, err := LoadConfig(paths)
		require.NoError(t, err)

		g := goldie.New(
			t,
			goldie.WithFixtureDir("testdata"),
			goldie.WithNameSuffix(".json"),
			goldie.WithDiffEngine(goldie.ClassicDiff),
		)

		g.AssertJson(t, "config_full", cfg.Config)
	})

	t.Run("attempt to bypass validations with merge", func(t *testing.T) {
		t.Parallel()

		base := createTempFileFromFixtureWithPattern(t, "config_test_1", `
version: "1"

execution_config: 
  file: 
    path: 'somePath'
`)

		override1 := createTempFileFromFixtureWithPattern(t, "config_test_2", `
version: "1"

execution_config: 
  storage: 
    provider_id: 'id'
    object_path: 'there' 

`)

		override2 := createTempFileFromFixtureWithPattern(t, "config_test_2", `
version: "1"

listen_addr: "localhost:3007"
`)

		// Some validations like oneOf can be bypassed by a merge
		paths := []string{base, override1, override2}
		_, err := LoadConfig(paths)
		require.Error(t, err)

		require.ErrorContains(t, err, "router config validation error when combined")
		require.ErrorContains(t, err, "jsonschema validation failed with")
		require.ErrorContains(t, err, "- at '/execution_config': oneOf failed, none matched")
		require.ErrorContains(t, err, "- at '/execution_config': additional properties 'storage' not allowed")
		require.ErrorContains(t, err, "- at '/execution_config': additional properties 'file' not allowed")
	})

}

func TestCircuitBreakerConfig(t *testing.T) {
	t.Parallel()

	t.Run("verify max exceeding", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

traffic_shaping:
  all:
    circuit_breaker:
      enabled: true
      request_threshold: 900000
      error_threshold_percentage: 50000
      sleep_window: 3m
      half_open_attempts: 9000
      required_successful: 700
      rolling_duration: 6m
      num_buckets: 170
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/request_threshold': maximum: got 900,000, want 10,000")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/error_threshold_percentage': maximum: got 50,000, want 100")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/sleep_window': duration must be less or equal than 2m0s")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/half_open_attempts': maximum: got 9,000, want 100")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/required_successful': maximum: got 700, want 100")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/rolling_duration': duration must be less or equal than 2m0s")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/num_buckets': maximum: got 170, want 120")
	})

	t.Run("verify min not exceeding", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

traffic_shaping:
  all:
    circuit_breaker:
      enabled: true
      request_threshold: 0
      error_threshold_percentage: 0
      sleep_window: 100ms
      half_open_attempts: 0
      required_successful: 0
      rolling_duration: 2s
      num_buckets: 0
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/request_threshold': minimum: got 0, want 1")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/error_threshold_percentage': minimum: got 0, want 1")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/sleep_window': duration must be greater or equal than 250ms")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/half_open_attempts': minimum: got 0, want 1")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/required_successful': minimum: got 0, want 1")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/rolling_duration': duration must be greater or equal than 5s")
		require.ErrorContains(t, err, "'/traffic_shaping/all/circuit_breaker/num_buckets': minimum: got 0, want 1")
	})

	t.Run("verify valid configuration", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

traffic_shaping:
  all:
    circuit_breaker:
      enabled: true
      request_threshold: 5
      error_threshold_percentage: 5
      sleep_window: 500ms
      half_open_attempts: 5
      required_successful: 5
      rolling_duration: 7s
      num_buckets: 5
`)
		_, err := LoadConfig([]string{f})
		require.NoError(t, err)
	})
}
