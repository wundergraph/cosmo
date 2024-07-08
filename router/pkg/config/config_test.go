package config

import (
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v5"
	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"
)

func TestConfigRequiredValues(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"
`)
	_, err := LoadConfig(f, "")
	require.ErrorContains(t, err, "either router config path or graph token must be provided")
}

func TestTokenNotRequiredWhenPassingStaticConfig(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"

router_config_path: "config.json"
`)
	_, err := LoadConfig(f, "")

	require.NoError(t, err)
}

func TestCustomBytesExtension(t *testing.T) {
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

	require.Equal(t, js.Causes[0].KeywordLocation, "/properties/traffic_shaping/properties/router/properties/max_request_body_size/bytes")
	require.Equal(t, js.Causes[0].Message, "must be greater or equal than 1.0 MB")
}

func TestVariableExpansion(t *testing.T) {
	require.NoError(t, os.Setenv("TEST_POLL_INTERVAL", "20s"))

	t.Cleanup(func() {
		require.NoError(t, os.Unsetenv("TEST_POLL_INTERVAL"))
	})

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

poll_interval: "${TEST_POLL_INTERVAL}"
`)

	cfg, err := LoadConfig(f, "")

	require.NoError(t, err)

	require.Equal(t, cfg.Config.PollInterval, time.Second*20)
}

func TestConfigHasPrecedence(t *testing.T) {
	require.NoError(t, os.Setenv("POLL_INTERVAL", "22s"))

	t.Cleanup(func() {
		require.NoError(t, os.Unsetenv("POLL_INTERVAL"))
	})

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

poll_interval: 11s
`)

	cfg, err := LoadConfig(f, "")

	require.NoError(t, err)

	require.Equal(t, cfg.Config.PollInterval, time.Second*11)
}

func TestErrorWhenConfigNotExists(t *testing.T) {
	_, err := LoadConfig("./fixtures/not_exists.yaml", "")

	require.Error(t, err)
	require.ErrorContains(t, err, "could not read custom config file ./fixtures/not_exists.yaml: open ./fixtures/not_exists.yaml: no such file or directory")
}

func TestRegexDecoding(t *testing.T) {
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
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics, 0)
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels, 0)

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
	require.Equal(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics, RegExArray{regexp.MustCompile("^go_.*"), regexp.MustCompile("^process_.*")})
	require.Equal(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels, RegExArray{regexp.MustCompile("^instance")})
}

func TestErrorWhenEnvVariableConfigNotExists(t *testing.T) {
	require.NoError(t, os.Setenv("CONFIG_PATH", "not_exists.yaml"))

	t.Cleanup(func() {
		require.NoError(t, os.Unsetenv("CONFIG_PATH"))
	})

	_, err := LoadConfig("", "")

	require.Error(t, err)
	require.ErrorContains(t, err, "could not read custom config file not_exists.yaml: open not_exists.yaml: no such file or directory")
}

func TestConfigIsOptional(t *testing.T) {

	require.NoError(t, os.Setenv("GRAPH_API_TOKEN", "XXX"))

	t.Cleanup(func() {
		require.NoError(t, os.Unsetenv("GRAPH_API_TOKEN"))
	})

	result, err := LoadConfig("", "")

	require.NoError(t, err)
	require.False(t, result.DefaultLoaded)
}

func TestCustomGoDurationExtension(t *testing.T) {
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

	require.Equal(t, js.Causes[0].KeywordLocation, "/properties/telemetry/properties/tracing/properties/exporters/items/properties/export_timeout/duration")
	require.Equal(t, js.Causes[0].Message, "must be greater or equal than 5s")

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

	require.Equal(t, js.Causes[0].KeywordLocation, "/properties/telemetry/properties/tracing/properties/exporters/items/properties/export_timeout/duration")
	require.Equal(t, js.Causes[0].Message, "must be less or equal than 2m0s")
}

func TestLoadFullConfig(t *testing.T) {
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
	_ = os.Unsetenv("ROUTER_REGISTRATION")

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
	require.Equal(t, js.Causes[0].Message, "'a' is not valid 'http-url'")
}

// New tests for logging configurations

func TestLoadConfigWithLogFile(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"
log_level: "info"
json_log: true
log_file: "/tmp/test_log.log"
shutdown_delay: "10s"
`)
	cfg, err := LoadConfig(f, "")

	require.NoError(t, err)
	require.Equal(t, "info", cfg.Config.LogLevel)
	require.True(t, cfg.Config.JSONLog)
	require.Equal(t, "/tmp/test_log.log", cfg.Config.LogFile)
	require.Equal(t, 10*time.Second, cfg.Config.ShutdownDelay)
}

func TestLoadConfigWithInvalidLogFile(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"
log_level: "info"
json_log: true
log_file: "/nonexistent/path/to/logfile.log"
shutdown_delay: "10s"
`)
	_, err := LoadConfig(f, "")
	require.Error(t, err)
}
