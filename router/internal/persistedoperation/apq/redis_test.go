package apq

import (
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestRedisStore(t *testing.T) {
	t.Parallel()

	t.Run("renew refreshes expiration when TTL is positive", func(t *testing.T) {
		t.Parallel()

		server := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: server.Addr()})
		t.Cleanup(func() {
			require.NoError(t, client.Close())
		})

		const operationHash = "hash"
		require.NoError(t, client.Set(t.Context(), operationHash, "query", time.Minute).Err())

		store := redisStore{
			client: client,
			ttl:    5 * time.Minute,
		}
		require.NoError(t, store.Renew(t.Context(), operationHash))

		require.True(t, server.Exists(operationHash))
		require.Equal(t, 5*time.Minute, server.TTL(operationHash))
	})
}
