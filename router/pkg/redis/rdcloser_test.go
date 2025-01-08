package rd

import (
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"
	"testing"
)

func TestRedisCloser(t *testing.T) {
	t.Parallel()

	t.Run("Creates default client for normal redis", func(t *testing.T) {
		cl, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URL:    "redis://localhost:6379",
		})

		require.NoError(t, err)
		require.NotNil(t, cl)
		require.True(t, isFunctioningClient(cl))
		require.False(t, isClusterClient(cl))
	})

	t.Run("Creates cluster client for cluster redis", func(t *testing.T) {
		cl, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URL:    "redis://localhost:7000,redis://localhost:7001",
		})

		require.NoError(t, err)
		require.NotNil(t, cl)
		require.True(t, isFunctioningClient(cl))
		require.True(t, isClusterClient(cl))
	})

	t.Run("Single cluster client fails", func(t *testing.T) {
		_, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URL:    "redis://localhost:7000",
		})

		require.Error(t, err)
		require.ErrorContains(t, err, "failed to create a functioning redis client")
	})
}
