package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInvalidAuthenticatedNatsProviderNoUsername(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

events:
  providers:
    nats:
      - id: default
        url: "nats://localhost:4222"
        authentication:
          user_info:
            password: "password"
`)

	_, err := LoadConfig([]string{f})
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "errors while loading config files: router config validation error for")
	require.ErrorContains(t, err, ": jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n")
	require.ErrorContains(t, err, "- at '/events/providers/nats/0/authentication': oneOf failed, none matched\n  - at '/events/providers/nats/0/authentication': validation failed\n    - at '/events/providers/nats/0/authentication': missing property 'token'\n    - at '/events/providers/nats/0/authentication': additional properties 'user_info' not allowed\n  - at '/events/providers/nats/0/authentication/user_info': missing property 'username'")
}

func TestInvalidAuthenticatedNatsProviderNoPassword(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

events:
  providers:
    nats:
      - id: default
        url: "nats://localhost:4222"
        authentication:
          user_info:
            username: "admin"
`)
	_, err := LoadConfig([]string{f})
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "errors while loading config files: router config validation error for")
	require.ErrorContains(t, err, ": jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n")
	require.ErrorContains(t, err, "- at '/events/providers/nats/0/authentication': oneOf failed, none matched\n  - at '/events/providers/nats/0/authentication': validation failed\n    - at '/events/providers/nats/0/authentication': missing property 'token'\n    - at '/events/providers/nats/0/authentication': additional properties 'user_info' not allowed\n  - at '/events/providers/nats/0/authentication/user_info': missing property 'password'")
}

func TestValidAuthenticatedNatsProviderWithToken(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: '1'

graph:
  token: 'token'

events:
  providers:
    nats:
      - id: default
        url: 'nats://localhost:4222'
        authentication:
          token: 'token'

`)
	_, err := LoadConfig([]string{f})
	require.NoError(t, err)
}

func TestValidAuthenticatedNatsProviderWithUserInfo(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"

events:
  providers:
    nats:
      - id: default
        url: "nats://localhost:4222"
        authentication:
          user_info:
            username: "username"
            password: "password"

`)

	_, err := LoadConfig([]string{f})
	require.NoError(t, err)
}
