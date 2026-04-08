package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestProviderRegistry(t *testing.T) {
	t.Parallel()

	t.Run("successful lookups", func(t *testing.T) {
		t.Parallel()

		reg, err := NewProviderRegistry(config.StorageProviders{
			S3:         []config.S3StorageProvider{{ID: "my-s3", Bucket: "b"}},
			CDN:        []config.CDNStorageProvider{{ID: "my-cdn", URL: "https://cdn"}},
			Redis:      []config.RedisStorageProvider{{ID: "my-redis"}},
			FileSystem: []config.FileSystemStorageProvider{{ID: "my-fs", Path: "/tmp"}},
		})
		require.NoError(t, err)

		s3, ok := reg.S3("my-s3")
		require.True(t, ok)
		require.Equal(t, "b", s3.Bucket)

		cdn, ok := reg.CDN("my-cdn")
		require.True(t, ok)
		require.Equal(t, "https://cdn", cdn.URL)

		redis, ok := reg.Redis("my-redis")
		require.True(t, ok)
		require.Equal(t, "my-redis", redis.ID)

		fs, ok := reg.FileSystem("my-fs")
		require.True(t, ok)
		require.Equal(t, "/tmp", fs.Path)
	})

	t.Run("unknown ID returns false", func(t *testing.T) {
		t.Parallel()

		reg, err := NewProviderRegistry(config.StorageProviders{})
		require.NoError(t, err)

		_, ok := reg.S3("nope")
		require.False(t, ok)

		_, ok = reg.CDN("nope")
		require.False(t, ok)

		_, ok = reg.Redis("nope")
		require.False(t, ok)

		_, ok = reg.FileSystem("nope")
		require.False(t, ok)
	})

	t.Run("duplicate S3 ID", func(t *testing.T) {
		t.Parallel()

		_, err := NewProviderRegistry(config.StorageProviders{
			S3: []config.S3StorageProvider{{ID: "dup"}, {ID: "dup"}},
		})
		require.ErrorContains(t, err, "duplicate s3 storage provider with id 'dup'")
	})

	t.Run("duplicate CDN ID", func(t *testing.T) {
		t.Parallel()

		_, err := NewProviderRegistry(config.StorageProviders{
			CDN: []config.CDNStorageProvider{{ID: "dup"}, {ID: "dup"}},
		})
		require.ErrorContains(t, err, "duplicate cdn storage provider with id 'dup'")
	})

	t.Run("duplicate Redis ID", func(t *testing.T) {
		t.Parallel()

		_, err := NewProviderRegistry(config.StorageProviders{
			Redis: []config.RedisStorageProvider{{ID: "dup"}, {ID: "dup"}},
		})
		require.ErrorContains(t, err, "duplicate Redis storage provider with id 'dup'")
	})

	t.Run("duplicate FileSystem ID", func(t *testing.T) {
		t.Parallel()

		_, err := NewProviderRegistry(config.StorageProviders{
			FileSystem: []config.FileSystemStorageProvider{{ID: "dup"}, {ID: "dup"}},
		})
		require.ErrorContains(t, err, "duplicate file system storage provider with id 'dup'")
	})

	t.Run("IsFileSystem", func(t *testing.T) {
		t.Parallel()

		reg, err := NewProviderRegistry(config.StorageProviders{
			FileSystem: []config.FileSystemStorageProvider{{ID: "fs1"}},
		})
		require.NoError(t, err)

		require.True(t, reg.IsFileSystem("fs1"))
		require.False(t, reg.IsFileSystem("nope"))
	})
}
