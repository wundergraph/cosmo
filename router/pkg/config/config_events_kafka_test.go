package config

import (
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

func TestFullValidKafkaProvider(t *testing.T) {
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

	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}

func TestValidAuthenticatedKafkaProviderWithSaslPlain(t *testing.T) {
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

	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}

func TestInvalidAuthenticatedKafkaProviderWithoutPasswordSaslPlain(t *testing.T) {
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

	_, err := LoadConfig(f, "")
	require.ErrorContains(t, err, "router config validation error: jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n- at '/events/providers/kafka/0/authentication': oneOf failed, none matched\n  - at '/events/providers/kafka/0/authentication/sasl_plain': missing property 'password'")
}

func TestInvalidAuthenticatedKafkaProviderWithoutUsernameSaslPlain(t *testing.T) {
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

	_, err := LoadConfig(f, "")
	require.ErrorContains(t, err, "router config validation error: jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n- at '/events/providers/kafka/0/authentication': oneOf failed, none matched\n  - at '/events/providers/kafka/0/authentication/sasl_plain': missing property 'username'")
}

func createTempFileFromFixture(t *testing.T, fixture string) string {
	t.Helper()

	f, err := os.CreateTemp("", "config_test")
	require.NoError(t, err)

	t.Cleanup(func() {
		require.NoError(t, os.Remove(f.Name()))
	})

	_, err = f.WriteString(fixture)
	require.NoError(t, err)

	return f.Name()
}
