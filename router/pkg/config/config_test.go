package config

import (
	"regexp"
	"testing"
	"time"

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
	_, err := LoadConfig(f, "")

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
	_, err := LoadConfig(f, "")

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

	cfg, err := LoadConfig(f, "")

	require.NoError(t, err)

	require.Equal(t, time.Second*20, cfg.Config.PollInterval)
}

func TestConfigHasPrecedence(t *testing.T) {
	t.Setenv("POLL_INTERVAL", "22s")

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

poll_interval: 11s
`)

	cfg, err := LoadConfig(f, "")

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

	_, err := LoadConfig("./fixtures/not_exists.yaml", "")

	require.Error(t, err)
	require.ErrorContains(t, err, "could not read custom config file ./fixtures/not_exists.yaml: open ./fixtures/not_exists.yaml: no such file or directory")
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

	cfg, err := LoadConfig(f, "")

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

	cfg, err = LoadConfig(f, "")

	require.NoError(t, err)
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics, 2)
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels, 1)
	require.Equal(t, RegExArray{regexp.MustCompile("^go_.*"), regexp.MustCompile("^process_.*")}, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics)
	require.Equal(t, RegExArray{regexp.MustCompile("^instance")}, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels)
}

func TestErrorWhenEnvVariableConfigNotExists(t *testing.T) {
	t.Setenv("CONFIG_PATH", "not_exists.yaml")

	_, err := LoadConfig("", "")

	require.Error(t, err)
	require.ErrorContains(t, err, "could not read custom config file not_exists.yaml: open not_exists.yaml: no such file or directory")
}

func TestConfigIsOptional(t *testing.T) {
	t.Setenv("GRAPH_API_TOKEN", "XXX")

	result, err := LoadConfig("", "")

	require.NoError(t, err)
	require.False(t, result.DefaultLoaded)
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

	_, err := LoadConfig(f, "")

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

	_, err = LoadConfig(f, "")

	require.ErrorAs(t, err, &js)

	require.Equal(t, []string{"telemetry", "tracing", "exporters", "0", "export_timeout"}, js.Causes[0].InstanceLocation)
	require.Equal(t, "at '/telemetry/tracing/exporters/0/export_timeout': duration must be less or equal than 2m0s", js.Causes[0].Error())
}

func TestLoadFullConfig(t *testing.T) {
	t.Parallel()

	cfg, err := LoadConfig("./fixtures/full.yaml", "")
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

	cfg, err := LoadConfig(f, "")
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
	_, err := LoadConfig(f, "")
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
	_, err := LoadConfig(f, "")
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
	_, err := LoadConfig(f, "")
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
	_, err = LoadConfig(f, "")
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
	_, err := LoadConfig(f, "")
	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)
	require.Equal(t, "at '/persisted_operations/storage': missing property 'object_prefix'", js.Causes[0].Error())
}

func TestValidExecutionConfig(t *testing.T) {
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
  storage:
    provider_id: s3
    object_path: "5ef73d80-cae4-4d0e-98a7-1e9fa922c1a4/92c25b45-a75b-4954-b8f6-6592a9b203eb/routerconfigs/latest.json"
`)
	_, err := LoadConfig(f, "")
	var js *jsonschema.ValidationError
	require.NoError(t, err, &js)

	f = createTempFileFromFixture(t, `
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
	_, err = LoadConfig(f, "")
	js = &jsonschema.ValidationError{}
	require.NoError(t, err, &js)
}

func TestInvalidExecutionConfig(t *testing.T) {
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
  storage:
    provider_id: s3
	# Missing object_path
`)
	_, err := LoadConfig(f, "")
	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)
	require.Equal(t, "at '/execution_config': oneOf failed, none matched\n- at '/execution_config': additional properties 'storage' not allowed\n- at '/execution_config/storage': missing property 'object_path'\n- at '/execution_config': additional properties 'storage' not allowed", js.Causes[0].Error())
}

func TestValidLocalExecutionConfig(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

execution_config: 
  file: 
    path: "router.json"
`)
	_, err := LoadConfig(f, "")
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
	_, err := LoadConfig(f, "")
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
	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}

func TestPrefixedMetricEngineConfig(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"
`)
	c, err := LoadConfig(f, "")
	require.NoError(t, err)

	require.False(t, c.Config.Telemetry.Metrics.Prometheus.EngineStats.Subscriptions)
	require.False(t, c.Config.Telemetry.Metrics.OTLP.EngineStats.Subscriptions)

	t.Setenv("PROMETHEUS_ENGINE_STATS_SUBSCRIPTIONS", "true")
	t.Setenv("METRICS_OTLP_ENGINE_STATS_SUBSCRIPTIONS", "true")

	c, err = LoadConfig(f, "")
	require.NoError(t, err)

	require.True(t, c.Config.Telemetry.Metrics.Prometheus.EngineStats.Subscriptions)
	require.True(t, c.Config.Telemetry.Metrics.OTLP.EngineStats.Subscriptions)
}
