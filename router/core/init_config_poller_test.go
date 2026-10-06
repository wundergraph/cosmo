package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestGetConfigClient(t *testing.T) {
	t.Parallel()

	registry, err := NewProviderRegistry(config.StorageProviders{
		S3: []config.S3StorageProvider{{ID: "s3", Endpoint: "localhost:10000", Bucket: "cosmo"}},
	})
	require.NoError(t, err)

	t.Run("fails for S3 primary storage without object_path", func(t *testing.T) {
		t.Parallel()

		r := &Router{}
		r.logger = zap.NewNop()
		r.routerConfigPollerConfig = &RouterConfigPollerConfig{}
		r.routerConfigPollerConfig.Storage.ProviderID = "s3"

		_, err := getConfigClient(r, registry, "s3", false)
		require.EqualError(t, err, "object_path is required for S3 storage provider 's3' for execution config")
	})

	t.Run("fails for S3 fallback storage without object_path", func(t *testing.T) {
		t.Parallel()

		r := &Router{}
		r.logger = zap.NewNop()
		r.routerConfigPollerConfig = &RouterConfigPollerConfig{}
		r.routerConfigPollerConfig.Storage.ObjectPath = "primary.json"
		r.routerConfigPollerConfig.FallbackStorage.ProviderID = "s3"

		_, err := getConfigClient(r, registry, "s3", true)
		require.EqualError(t, err, "object_path is required for S3 storage provider 's3' for execution config")
	})

	t.Run("succeeds for S3 storage with object_path", func(t *testing.T) {
		t.Parallel()

		r := &Router{}
		r.logger = zap.NewNop()
		r.routerConfigPollerConfig = &RouterConfigPollerConfig{}
		r.routerConfigPollerConfig.Storage.ObjectPath = "latest.json"

		c, err := getConfigClient(r, registry, "s3", false)
		require.NoError(t, err)
		require.NotNil(t, c)
	})
}
