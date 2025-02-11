package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFullValidRedisInstanceProvider(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"
events:
  providers:
    redis:
      - id: my-redis
        urls:
          - "localhost:7001"

`)

	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}

func TestFullValidRedisClusterProvider(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"
events:
  providers:
    redis:
      - id: my-redis
        urls:
          - "localhost:7001"
          - "localhost:7002"
          - "localhost:7003"

`)

	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}
