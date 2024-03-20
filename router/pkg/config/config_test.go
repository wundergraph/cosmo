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
	require.Equal(t, js.Causes[0].Message, "must be greater or equal than 1.0 MB")
}

func TestVariableExpansion(t *testing.T) {
	require.NoError(t, os.Setenv("TEST_POLL_INTERVAL", "20s"))

	t.Cleanup(func() {
		require.NoError(t, os.Unsetenv("TEST_POLL_INTERVAL"))
	})

	cfg, err := LoadConfig("./fixtures/variable_expansion.yaml", "")

	require.NoError(t, err)

	require.Equal(t, cfg.Config.PollInterval, time.Second*20)
}

func TestConfigHasPrecedence(t *testing.T) {
	require.NoError(t, os.Setenv("POLL_INTERVAL", "22s"))

	t.Cleanup(func() {
		require.NoError(t, os.Unsetenv("POLL_INTERVAL"))
	})

	cfg, err := LoadConfig("./fixtures/config_precedence.yaml", "")

	require.NoError(t, err)

	require.Equal(t, cfg.Config.PollInterval, time.Second*11)
}

func TestErrorWhenConfigNotExists(t *testing.T) {
	_, err := LoadConfig("./fixtures/not_exists.yaml", "")

	require.Error(t, err)
	require.ErrorContains(t, err, "could not read custom config file ./fixtures/not_exists.yaml: open ./fixtures/not_exists.yaml: no such file or directory")
}

func TestRegexDecoding(t *testing.T) {
	cfg, err := LoadConfig("./fixtures/regex-empty-decoding.yaml", "")

	require.NoError(t, err)
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetrics, 0)
	require.Len(t, cfg.Config.Telemetry.Metrics.Prometheus.ExcludeMetricLabels, 0)

	cfg, err = LoadConfig("./fixtures/regex-decoding.yaml", "")

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
	_, err := LoadConfig("./fixtures/min_duration_error.yaml", "")

	var js *jsonschema.ValidationError
	require.ErrorAs(t, err, &js)

	require.Equal(t, js.Causes[0].KeywordLocation, "/properties/telemetry/properties/tracing/properties/exporters/items/properties/export_timeout/duration")
	require.Equal(t, js.Causes[0].Message, "must be greater or equal than 5s")

	_, err = LoadConfig("./fixtures/max_duration_error.yaml", "")

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

	cfg, err := LoadConfig("./fixtures/minimal.yaml", "")
	require.NoError(t, err)

	g := goldie.New(
		t,
		goldie.WithFixtureDir("testdata"),
		goldie.WithNameSuffix(".json"),
		goldie.WithDiffEngine(goldie.ClassicDiff),
	)

	g.AssertJson(t, "config_defaults", cfg.Config)
}

func TestEventsInvalidProvider(t *testing.T) {
	_, err := LoadConfig("./fixtures/events/invalid_provider.yaml", "")
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "missing properties: 'url'")
}

func TestInvalidAuthenticatedNatsProviderNoToken(t *testing.T) {
	_, err := LoadConfig("./fixtures/events/invalid_authenticated_nats_provider_no_token.yaml", "")
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "missing properties: 'token'")
}

func TestInvalidAuthenticatedNatsProviderNoUsername(t *testing.T) {
	_, err := LoadConfig("./fixtures/events/invalid_authenticated_nats_provider_no_username.yaml", "")
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "missing properties: 'token'")
}

func TestInvalidAuthenticatedNatsProviderNoPassword(t *testing.T) {
	_, err := LoadConfig("./fixtures/events/invalid_authenticated_nats_provider_no_password.yaml", "")
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "missing properties: 'token'")
}

func TestValidUnauthenticatedNatsProvider(t *testing.T) {
	_, err := LoadConfig("./fixtures/events/valid_unauthenticated_nats_provider.yaml", "")
	require.NoError(t, err)
}

func TestValidAuthenticatedNatsProviderWithToken(t *testing.T) {
	_, err := LoadConfig("./fixtures/events/valid_authenticated_nats_provider_with_token.yaml", "")
	require.NoError(t, err)
}

func TestValidAuthenticatedNatsProviderWithUsernamePassword(t *testing.T) {
	_, err := LoadConfig("./fixtures/events/valid_authenticated_nats_provider_with_username_password.yaml", "")
	require.NoError(t, err)
}
