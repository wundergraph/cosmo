package rediscloser

import (
	"fmt"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"
)

func TestRedisCloser(t *testing.T) {
	t.Parallel()

	t.Run("fails if no urls provided", func(t *testing.T) {
		_, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
		})

		require.Error(t, err)
		require.ErrorContains(t, err, "urls is required for direct Redis")
	})

	t.Run("Creates default client for normal redis", func(t *testing.T) {
		mr := miniredis.RunT(t)

		cl, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URLs:   []string{fmt.Sprintf("redis://%s", mr.Addr())},
		})

		require.NoError(t, err)
		require.NotNil(t, cl)
		isFunctioning, err := IsFunctioningClient(cl)
		require.True(t, isFunctioning)
		require.NoError(t, err)
		require.False(t, isClusterClient(cl))
	})

	t.Run("Works with auth", func(t *testing.T) {
		mr := miniredis.RunT(t)
		mr.RequireUserAuth("user", "pass")

		authUrl := fmt.Sprintf("redis://user:pass@%s", mr.Addr())
		cl, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URLs:   []string{authUrl},
		})

		require.NoError(t, err)
		require.NotNil(t, cl)
		isFunctioning, err := IsFunctioningClient(cl)
		require.True(t, isFunctioning)
		require.NoError(t, err)
		require.False(t, isClusterClient(cl))
	})

	t.Run("Unresponsive redis fails", func(t *testing.T) {
		_, err := NewRedisCloser(&RedisCloserOptions{
			Logger: zaptest.NewLogger(t),
			URLs:   []string{"redis://localhost:7000"},
		})

		require.Error(t, err)
		require.ErrorContains(t, err, "failed to create a functioning Redis direct client")
	})
}

func TestRedisCloser_SentinelMode(t *testing.T) {
	t.Parallel()

	t.Run("validates sentinel configuration", func(t *testing.T) {
		testCases := []struct {
			name        string
			opts        *RedisCloserOptions
			expectedErr string
		}{
			{
				name: "missing master name",
				opts: &RedisCloserOptions{
					Logger:          zaptest.NewLogger(t),
					SentinelEnabled: true,
					SentinelAddrs:   []string{"127.0.0.1:26379"},
				},
				expectedErr: "master_name is required when sentinel_enabled is true",
			},
			{
				name: "missing sentinel addresses",
				opts: &RedisCloserOptions{
					Logger:          zaptest.NewLogger(t),
					SentinelEnabled: true,
					MasterName:      "mymaster",
				},
				expectedErr: "sentinel_addrs is required when sentinel_enabled is true",
			},
			{
				name: "sentinel and cluster both enabled",
				opts: &RedisCloserOptions{
					Logger:          zaptest.NewLogger(t),
					SentinelEnabled: true,
					ClusterEnabled:  true,
					MasterName:      "mymaster",
					SentinelAddrs:   []string{"127.0.0.1:26379"},
				},
				expectedErr: "cannot enable both sentinel_enabled and cluster_enabled",
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				_, err := NewRedisCloser(tc.opts)
				require.Error(t, err)
				require.ErrorContains(t, err, tc.expectedErr)
			})
		}
	})

	t.Run("creates sentinel client with valid config", func(t *testing.T) {
		// Note: This test will fail to connect since we don't have a real sentinel,
		// but it validates the configuration parsing and client creation logic
		_, err := NewRedisCloser(&RedisCloserOptions{
			Logger:          zaptest.NewLogger(t),
			SentinelEnabled: true,
			MasterName:      "mymaster",
			SentinelAddrs:   []string{"127.0.0.1:26379", "127.0.0.1:26380"},
			SentinelPassword: "sentinel_pass",
			Password:        "redis_pass",
		})

		// We expect this to fail with a connection error since no real sentinel is running
		require.Error(t, err)
		require.ErrorContains(t, err, "failed to create a functioning Redis sentinel client")
	})

	t.Run("handles single sentinel address", func(t *testing.T) {
		_, err := NewRedisCloser(&RedisCloserOptions{
			Logger:          zaptest.NewLogger(t),
			SentinelEnabled: true,
			MasterName:      "mymaster",
			SentinelAddrs:   []string{"127.0.0.1:26379"},
		})

		// We expect this to fail with a connection error since no real sentinel is running
		require.Error(t, err)
		require.ErrorContains(t, err, "failed to create a functioning Redis sentinel client")
	})
}

func TestValidateRedisConfig(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name        string
		opts        *RedisCloserOptions
		expectError bool
		errorMsg    string
	}{
		{
			name: "valid direct config",
			opts: &RedisCloserOptions{
				URLs: []string{"redis://localhost:6379"},
			},
			expectError: false,
		},
		{
			name: "valid cluster config",
			opts: &RedisCloserOptions{
				ClusterEnabled: true,
				URLs:           []string{"redis://localhost:6379"},
			},
			expectError: false,
		},
		{
			name: "valid sentinel config",
			opts: &RedisCloserOptions{
				SentinelEnabled: true,
				MasterName:      "mymaster",
				SentinelAddrs:   []string{"127.0.0.1:26379"},
			},
			expectError: false,
		},
		{
			name: "missing URLs for direct",
			opts: &RedisCloserOptions{
				URLs: []string{},
			},
			expectError: true,
			errorMsg:    "urls is required for direct Redis",
		},
		{
			name: "missing URLs for cluster",
			opts: &RedisCloserOptions{
				ClusterEnabled: true,
				URLs:           []string{},
			},
			expectError: true,
			errorMsg:    "urls is required when cluster_enabled is true",
		},
		{
			name: "sentinel without master name",
			opts: &RedisCloserOptions{
				SentinelEnabled: true,
				SentinelAddrs:   []string{"127.0.0.1:26379"},
			},
			expectError: true,
			errorMsg:    "master_name is required when sentinel_enabled is true",
		},
		{
			name: "sentinel without addresses",
			opts: &RedisCloserOptions{
				SentinelEnabled: true,
				MasterName:      "mymaster",
				SentinelAddrs:   []string{},
			},
			expectError: true,
			errorMsg:    "sentinel_addrs is required when sentinel_enabled is true",
		},
		{
			name: "both sentinel and cluster enabled",
			opts: &RedisCloserOptions{
				SentinelEnabled: true,
				ClusterEnabled:  true,
				MasterName:      "mymaster",
				SentinelAddrs:   []string{"127.0.0.1:26379"},
				URLs:            []string{"redis://localhost:6379"},
			},
			expectError: true,
			errorMsg:    "cannot enable both sentinel_enabled and cluster_enabled",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateRedisConfig(tc.opts)
			if tc.expectError {
				require.Error(t, err)
				require.ErrorContains(t, err, tc.errorMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
