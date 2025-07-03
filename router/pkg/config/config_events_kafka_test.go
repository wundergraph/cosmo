package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFullValidKafkaProvider(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"
events:
  providers:
    kafka:
      - id: my-kafka
        brokers:
          - "localhost:9092"
        tls:
          enabled: true
        authentication:
          sasl_plain:
            username: "admin"
            password: "admin"

`)

	_, err := LoadConfig([]string{f})
	require.NoError(t, err)
}

func TestValidAuthenticatedKafkaProviderWithSaslPlain(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

events:
  providers:
    kafka:
      - id: my-kafka
        brokers:
          - "localhost:9092"
        authentication:
          sasl_plain:
            username: "admin"
            password: "admin"

`)

	_, err := LoadConfig([]string{f})
	require.NoError(t, err)
}

func TestInvalidAuthenticatedKafkaProviderWithoutPasswordSaslPlain(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

events:
  providers:
    kafka:
      - id: my-kafka
        brokers:
          - "localhost:9092"
        authentication:
          sasl_plain:
            username: "admin"

`)

	_, err := LoadConfig([]string{f})
	require.ErrorContains(t, err, "errors while loading config files: router config validation error for")
	require.ErrorContains(t, err, ": jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n")
	require.ErrorContains(t, err, "- at '/events/providers/kafka/0/authentication': oneOf failed, none matched\n  - at '/events/providers/kafka/0/authentication/sasl_plain': missing property 'password'")
}

func TestInvalidAuthenticatedKafkaProviderWithoutUsernameSaslPlain(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

events:
  providers:
    kafka:
      - id: my-kafka
        brokers:
          - "localhost:9092"
        authentication:
          sasl_plain:
            password: "admin"

`)

	_, err := LoadConfig([]string{f})
	require.ErrorContains(t, err, "errors while loading config files: router config validation error for")
	require.ErrorContains(t, err, ": jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n")
	require.ErrorContains(t, err, "- at '/events/providers/kafka/0/authentication': oneOf failed, none matched\n  - at '/events/providers/kafka/0/authentication/sasl_plain': missing property 'username'")
}

func TestInvalidDoubleKafkaAuthentication(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

events:
  providers:
    kafka:
      - id: my-kafka
        brokers:
          - "localhost:9092"
        authentication:
          sasl_plain:
            username: "admin"
            password: "admin"
          sasl_scram:
            username: "admin"
            password: "admin"
            mechanism: "SCRAM-SHA-512"

`)

	_, err := LoadConfig([]string{f})
	require.ErrorContains(t, err, " at '/events/providers/kafka/0/authentication': oneOf failed, none matched")
}

func createTempFileFromFixture(t *testing.T, fixture string) string {
	t.Helper()

	return createTempFileFromFixtureWithPattern(t, "config_test", fixture)
}

func createTempFileFromFixtureWithPattern(t *testing.T, pattern string, fixture string) string {
	t.Helper()

	f, err := os.CreateTemp(t.TempDir(), pattern)
	require.NoError(t, err)

	_, err = f.WriteString(fixture)
	require.NoError(t, err)

	return f.Name()
}
