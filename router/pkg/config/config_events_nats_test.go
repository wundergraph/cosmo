package config

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestInvalidAuthenticatedNatsProviderNoUsername(t *testing.T) {
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

	_, err := LoadConfig(f, "")
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "router config validation error: jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n- at '/events/providers/nats/0/authentication': oneOf failed, none matched\n  - at '/events/providers/nats/0/authentication': validation failed\n    - at '/events/providers/nats/0/authentication': missing property 'token'\n    - at '/events/providers/nats/0/authentication': additional properties 'user_info' not allowed\n  - at '/events/providers/nats/0/authentication/user_info': missing property 'username'")
}

func TestInvalidAuthenticatedNatsProviderNoPassword(t *testing.T) {
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
	_, err := LoadConfig(f, "")
	// Note: If none of the oneOf array matches, the first in the array is compared
	require.ErrorContains(t, err, "router config validation error: jsonschema validation failed with 'https://raw.githubusercontent.com/wundergraph/cosmo/main/router/pkg/config/config.schema.json#'\n- at '/events/providers/nats/0/authentication': oneOf failed, none matched\n  - at '/events/providers/nats/0/authentication': validation failed\n    - at '/events/providers/nats/0/authentication': missing property 'token'\n    - at '/events/providers/nats/0/authentication': additional properties 'user_info' not allowed\n  - at '/events/providers/nats/0/authentication/user_info': missing property 'password'")
}

func TestValidAuthenticatedNatsProviderWithToken(t *testing.T) {
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
	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}

func TestValidAuthenticatedNatsProviderWithUserInfo(t *testing.T) {
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

	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}
