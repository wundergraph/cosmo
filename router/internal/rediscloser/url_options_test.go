package rediscloser

import (
	"fmt"
	"net/url"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"
)

// The router does not expose connection pool settings as its own configuration: go-redis parses
// them from the connection URL query string, so users tune the pool there. These tests pin that
// down, because the router still owns the URL handling in between (in particular the cluster
// branch rewrites the query to append addr parameters) and could silently drop what a user set.

// TestURLQueryParamsConfigureSingleNodeClient asserts every pool and timeout parameter a user can
// put in the URL reaches the client the router builds.
func TestURLQueryParamsConfigureSingleNodeClient(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)

	cl, err := NewRedisCloser(&RedisCloserOptions{
		Logger: zaptest.NewLogger(t),
		URLs: []string{fmt.Sprintf("redis://%s?pool_size=7&min_idle_conns=2&max_idle_conns=5"+
			"&max_active_conns=9&pool_timeout=4s&conn_max_idle_time=3m&conn_max_lifetime=20m"+
			"&dial_timeout=2s&read_timeout=6s&write_timeout=7s&max_retries=5&pool_fifo=true", mr.Addr())},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = cl.Close() })

	client, ok := cl.(*redis.Client)
	require.True(t, ok)

	opts := client.Options()
	require.Equal(t, 7, opts.PoolSize)
	require.Equal(t, 2, opts.MinIdleConns)
	require.Equal(t, 5, opts.MaxIdleConns)
	require.Equal(t, 9, opts.MaxActiveConns)
	require.Equal(t, 4*time.Second, opts.PoolTimeout)
	require.Equal(t, 3*time.Minute, opts.ConnMaxIdleTime)
	require.Equal(t, 20*time.Minute, opts.ConnMaxLifetime)
	require.Equal(t, 2*time.Second, opts.DialTimeout)
	require.Equal(t, 6*time.Second, opts.ReadTimeout)
	require.Equal(t, 7*time.Second, opts.WriteTimeout)
	require.Equal(t, 5, opts.MaxRetries)
	require.True(t, opts.PoolFIFO)
}

// TestURLQueryParamsSurviveClusterURLRewrite covers the cluster branch, where the router appends
// the remaining URLs to the first one as addr parameters before handing it to go-redis. The
// rewrite must not disturb the parameters the user supplied.
func TestURLQueryParamsSurviveClusterURLRewrite(t *testing.T) {
	t.Parallel()

	opts := &RedisCloserOptions{
		Logger: zaptest.NewLogger(t),
		URLs: []string{
			"redis://localhost:7001?pool_size=11&min_idle_conns=3&max_idle_conns=6" +
				"&max_active_conns=13&pool_timeout=5s&conn_max_idle_time=4m&conn_max_lifetime=25m" +
				"&dial_timeout=3s&read_timeout=8s&write_timeout=9s&max_retries=4" +
				"&max_redirects=6&route_by_latency=true&read_only=true",
			"redis://localhost:7002",
			"redis://localhost:7003",
		},
		ClusterEnabled: true,
	}

	parsed, err := url.Parse(opts.URLs[0])
	require.NoError(t, err)
	addClusterUrlsToQuery(opts, parsed)

	clusterOpts, err := redis.ParseClusterURL(parsed.String())
	require.NoError(t, err)

	require.Equal(t, []string{"localhost:7001", "localhost:7002", "localhost:7003"}, clusterOpts.Addrs)

	require.Equal(t, 11, clusterOpts.PoolSize)
	require.Equal(t, 3, clusterOpts.MinIdleConns)
	require.Equal(t, 6, clusterOpts.MaxIdleConns)
	require.Equal(t, 13, clusterOpts.MaxActiveConns)
	require.Equal(t, 5*time.Second, clusterOpts.PoolTimeout)
	require.Equal(t, 4*time.Minute, clusterOpts.ConnMaxIdleTime)
	require.Equal(t, 25*time.Minute, clusterOpts.ConnMaxLifetime)
	require.Equal(t, 3*time.Second, clusterOpts.DialTimeout)
	require.Equal(t, 8*time.Second, clusterOpts.ReadTimeout)
	require.Equal(t, 9*time.Second, clusterOpts.WriteTimeout)
	require.Equal(t, 4, clusterOpts.MaxRetries)
	require.Equal(t, 6, clusterOpts.MaxRedirects)
	require.True(t, clusterOpts.RouteByLatency)
	require.True(t, clusterOpts.ReadOnly)
}

// TestClusterQueryParamsOnlyReadFromFirstURL documents a sharp edge of the cluster branch: only
// the host of every URL after the first is used, so parameters placed on those URLs are silently
// dropped. Users must put pool settings on the first URL.
func TestClusterQueryParamsOnlyReadFromFirstURL(t *testing.T) {
	t.Parallel()

	opts := &RedisCloserOptions{
		Logger:         zaptest.NewLogger(t),
		URLs:           []string{"redis://localhost:7001", "redis://localhost:7002?pool_size=99"},
		ClusterEnabled: true,
	}

	parsed, err := url.Parse(opts.URLs[0])
	require.NoError(t, err)
	addClusterUrlsToQuery(opts, parsed)

	clusterOpts, err := redis.ParseClusterURL(parsed.String())
	require.NoError(t, err)

	require.Equal(t, []string{"localhost:7001", "localhost:7002"}, clusterOpts.Addrs)
	require.Zero(t, clusterOpts.PoolSize, "pool_size on a secondary URL must not take effect")
}

// TestUnknownURLQueryParamIsRejected shows that a mistyped parameter fails at startup instead of
// being ignored, so a typo in a pool setting cannot go unnoticed in production.
func TestUnknownURLQueryParamIsRejected(t *testing.T) {
	t.Parallel()

	t.Run("single node", func(t *testing.T) {
		t.Parallel()

		_, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zap.NewNop(),
			URLs:   []string{"redis://localhost:6379?pool_sizee=10"},
		})

		require.Error(t, err)
		require.ErrorContains(t, err, "unexpected option: pool_sizee")
	})

	t.Run("cluster", func(t *testing.T) {
		t.Parallel()

		_, err := NewRedisCloser(&RedisCloserOptions{
			Logger:         zap.NewNop(),
			URLs:           []string{"redis://localhost:7001?min_idle_connss=2"},
			ClusterEnabled: true,
		})

		require.Error(t, err)
		require.ErrorContains(t, err, "unexpected option: min_idle_connss")
	})
}
