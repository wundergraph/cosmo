package cdn_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
)

func TestRouterPollsUnversionedConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/"+testOrgID+"/"+testGraphID+"/routerconfigs/latest.json", r.URL.Path)
		_, _ = w.Write([]byte(`{"version":"test","compatibilityVersion":"1:1.0.0"}`))
	}))
	defer server.Close()

	client, err := cdn.NewClient(server.URL, testToken, &cdn.Options{
		RouterCompatibilityVersion: execution_config.RouterCompatibilityVersionThreshold,
	})
	require.NoError(t, err)
	response, err := client.RouterConfig(t.Context(), "", time.Time{})
	require.NoError(t, err)
	require.Equal(t, "test", response.Config.Version)
}
