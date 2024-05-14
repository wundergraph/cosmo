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
	require.ErrorContains(t, err, "missing properties: 'token'")
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
	require.ErrorContains(t, err, "missing properties: 'token'")
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
