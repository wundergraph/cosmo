package rd

import (
	"fmt"
	"github.com/alicebob/miniredis/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"
	"testing"
)

func TestRedisCloser(t *testing.T) {
	t.Parallel()

	t.Run("Creates default client for normal redis", func(t *testing.T) {
		mr := miniredis.RunT(t)

		cl, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URL:    fmt.Sprintf("redis://%s", mr.Addr()),
		})

		require.NoError(t, err)
		require.NotNil(t, cl)
		require.True(t, isFunctioningClient(cl))
		require.False(t, isClusterClient(cl))
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
