package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
)

func TestRouterCompatibilityVersionConfigPoller(t *testing.T) {
	t.Parallel()

	t.Run("test that a v1 router compatibility version config is requested from the correct cdn path", func(t *testing.T) {
		t.Parallel()
		cdnPort := freeport.GetOne(t)
		cdnServer := testenv.SetupCDNServer(t, cdnPort)
		token, err := testenv.GenerateVersionedJwtToken()
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
			CdnSever: cdnServer,
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					return configPoller
				},
			},
			UseVersionedGraph: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, configErr := client.RouterConfig(context.Background(), "1", time.Now())
			require.NoError(t, configErr)
			require.NotNil(t, resp)
			assert.Equal(t, "1:routerconfigs/latest.json", resp.Config.CompatibilityVersion)
		})
	})

	t.Run("test that a v2 router compatibility version config is requested from the correct cdn path", func(t *testing.T) {
		t.Parallel()
		cdnPort := freeport.GetOne(t)
		cdnServer := testenv.SetupCDNServer(t, cdnPort)
		token, err := testenv.GenerateVersionedJwtToken()
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
			CdnSever: cdnServer,
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					return configPoller
				},
			},
			UseVersionedGraph: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, configErr := client.RouterConfig(context.Background(), "1", time.Now())
			require.NoError(t, configErr)
			require.NotNil(t, resp)
			// The threshold in the config itself remains at 1 as the real router threshold is currently 1
			assert.Equal(t, "1:routerconfigs/v2/latest.json", resp.Config.CompatibilityVersion)
		})
	})
}

func TestVersionPath(t *testing.T) {
	t.Parallel()

	t.Run("test that v1 returns the correct path", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "", routerconfig.VersionPath(1))
	})

	t.Run("test that v2 returns the correct path", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "v2/", routerconfig.VersionPath(2))
	})

	t.Run("test that v99 returns the correct path", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, "v99/", routerconfig.VersionPath(99))
	})
}
