package rediscloser

import (
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zaptest"
)

func TestApplyPoolConfiguration(t *testing.T) {
	t.Parallel()

	fullConfig := &config.RedisConnectionPoolConfiguration{
		Size:            25,
		MinIdleConns:    5,
		MaxIdleConns:    10,
		MaxActiveConns:  50,
		Timeout:         7 * time.Second,
		ConnMaxIdleTime: 2 * time.Minute,
		ConnMaxLifetime: 30 * time.Minute,
	}

	t.Run("leaves the parsed options untouched when no pool is configured", func(t *testing.T) {
		t.Parallel()

		opts := &redis.Options{PoolSize: 42, MinIdleConns: 7, PoolTimeout: 9 * time.Second}
		applyPoolConfiguration(opts, nil)

		require.Equal(t, 42, opts.PoolSize)
		require.Equal(t, 7, opts.MinIdleConns)
		require.Equal(t, 9*time.Second, opts.PoolTimeout)
		require.Equal(t, 42, opts.PoolSize)
	})

	t.Run("applies every configured field", func(t *testing.T) {
		t.Parallel()

		opts := &redis.Options{}
		applyPoolConfiguration(opts, fullConfig)

		require.Equal(t, 25, opts.PoolSize)
		require.Equal(t, 5, opts.MinIdleConns)
		require.Equal(t, 10, opts.MaxIdleConns)
		require.Equal(t, 50, opts.MaxActiveConns)
		require.Equal(t, 7*time.Second, opts.PoolTimeout)
		require.Equal(t, 2*time.Minute, opts.ConnMaxIdleTime)
		require.Equal(t, 30*time.Minute, opts.ConnMaxLifetime)
		require.Equal(t, 25, opts.PoolSize)
	})

	t.Run("applies every configured field to a cluster client", func(t *testing.T) {
		t.Parallel()

		opts := &redis.ClusterOptions{}
		applyClusterPoolConfiguration(opts, fullConfig)

		require.Equal(t, 25, opts.PoolSize)
		require.Equal(t, 5, opts.MinIdleConns)
		require.Equal(t, 10, opts.MaxIdleConns)
		require.Equal(t, 50, opts.MaxActiveConns)
		require.Equal(t, 7*time.Second, opts.PoolTimeout)
		require.Equal(t, 2*time.Minute, opts.ConnMaxIdleTime)
		require.Equal(t, 30*time.Minute, opts.ConnMaxLifetime)
		require.Equal(t, 25, opts.PoolSize)
	})

	t.Run("keeps URL query parameters that the pool block does not name", func(t *testing.T) {
		t.Parallel()

		opts, err := redis.ParseURL("redis://localhost:6379?pool_size=11&min_idle_conns=3&conn_max_lifetime=5m")
		require.NoError(t, err)
		require.Equal(t, 11, opts.PoolSize)

		applyPoolConfiguration(opts, &config.RedisConnectionPoolConfiguration{Size: 99})

		require.Equal(t, 99, opts.PoolSize, "explicit configuration must win over the URL")
		require.Equal(t, 3, opts.MinIdleConns, "unset fields must keep the URL value")
		require.Equal(t, 5*time.Minute, opts.ConnMaxLifetime, "unset fields must keep the URL value")
	})

	t.Run("passes negative values through so go-redis can disable a check", func(t *testing.T) {
		t.Parallel()

		opts := &redis.Options{}
		applyPoolConfiguration(opts, &config.RedisConnectionPoolConfiguration{ConnMaxIdleTime: -1})

		require.Equal(t, time.Duration(-1), opts.ConnMaxIdleTime)
	})
}

func TestRedisCloserPoolConfiguration(t *testing.T) {
	t.Parallel()

	t.Run("builds a client with the configured pool size", func(t *testing.T) {
		t.Parallel()

		mr := miniredis.RunT(t)

		cl, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URLs:   []string{fmt.Sprintf("redis://%s", mr.Addr())},
			Pool: &config.RedisConnectionPoolConfiguration{
				Size:         3,
				MinIdleConns: 1,
			},
		})
		require.NoError(t, err)
		t.Cleanup(func() { _ = cl.Close() })

		// The pool is lazy; what matters is that the cap reached go-redis.
		require.LessOrEqual(t, int(cl.PoolStats().TotalConns), 3)
	})

	t.Run("an empty pool block leaves the go-redis defaults in place", func(t *testing.T) {
		t.Parallel()

		mr := miniredis.RunT(t)

		cl, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URLs:   []string{fmt.Sprintf("redis://%s", mr.Addr())},
			Pool:   &config.RedisConnectionPoolConfiguration{},
		})
		require.NoError(t, err)
		t.Cleanup(func() { _ = cl.Close() })

		client, ok := cl.(*redis.Client)
		require.True(t, ok)
		require.Equal(t, 10*runtime.GOMAXPROCS(0), client.Options().PoolSize)
		require.Equal(t, 30*time.Minute, client.Options().ConnMaxIdleTime)
	})
}
