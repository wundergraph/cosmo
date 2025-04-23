package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFullValidRedisProvider(t *testing.T) {
	t.Parallel()

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "token"
events:
  providers:
    redis:
      - id: my-redis
        urls:
          - "test@localhost:8000"
          - "test2@localhost:8001"
        cluster_enabled: true

`)

	_, err := LoadConfig(f, "")
	require.NoError(t, err)
}
