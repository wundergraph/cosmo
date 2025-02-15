package integration

import (
	"context"
	"fmt"
	"github.com/hashicorp/consul/sdk/freeport"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
)

func TestRouterCompatibilityVersionConfigPoller(t *testing.T) {
	t.Parallel()

	t.Run("test that a v1 router compatibility version config is requested from the correct cdn path", func(t *testing.T) {
		t.Parallel()
		cdnPort := freeport.GetOne(t)
		token, err := testenv.GenerateJwtToken()
		require.NoError(t, err)
		client, err := cdn.NewClient(fmt.Sprintf("http://127.0.0.1:%d", cdnPort), token, &cdn.Options{
			Logger:                     nil,
			SignatureKey:               "",
			RouterCompatibilityVersion: 1,
		})
		require.NoError(t, err)
		configPoller := configpoller.New(token,
			configpoller.WithClient(client),
			configpoller.WithPolling(time.Second, time.Second*0),
		)

		testenv.Run(t, &testenv.Config{
			CdnPort: cdnPort,
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					return configPoller
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, err := configPoller.GetRouterConfig(context.Background())
			require.NoError(t, err)
			require.NotNil(t, resp)
			assert.Equal(t, "1:routerconfigs/latest.json", resp.Config.CompatibilityVersion)
		})
	})

	t.Run("test that a v2 router compatibility version config is requested from the correct cdn path", func(t *testing.T) {
		t.Parallel()
		cdnPort := freeport.GetOne(t)
		token, err := testenv.GenerateJwtToken()
		require.NoError(t, err)
		client, err := cdn.NewClient(fmt.Sprintf("http://127.0.0.1:%d", cdnPort), token, &cdn.Options{
			Logger:                     nil,
			SignatureKey:               "",
			RouterCompatibilityVersion: 2,
		})
		require.NoError(t, err)
		configPoller := configpoller.New(token,
			configpoller.WithClient(client),
			configpoller.WithPolling(time.Second, time.Second*0),
		)

		testenv.Run(t, &testenv.Config{
			CdnPort: cdnPort,
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					return configPoller
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, err := configPoller.GetRouterConfig(context.Background())
			require.NoError(t, err)
			require.NotNil(t, resp)
			// The threshold in the config itself remains at 1 as the real router threshold is currently 1
			assert.Equal(t, "1:routerconfigs/v2/latest.json", resp.Config.CompatibilityVersion)
		})
	})
}

func TestVersionPath(t *testing.T) {
	t.Parallel()

	t.Run("test that v1 returns the correct path", func(t *testing.T) {
		assert.Equal(t, "", routerconfig.VersionPath(1))
	})

	t.Run("test that v2 returns the correct path", func(t *testing.T) {
		assert.Equal(t, "v2/", routerconfig.VersionPath(2))
	})

	t.Run("test that v99 returns the correct path", func(t *testing.T) {
		assert.Equal(t, "v99/", routerconfig.VersionPath(99))
	})
}
