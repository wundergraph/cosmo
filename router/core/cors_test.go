package core

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"go.uber.org/zap"
)

func TestCORSMatchOriginsConfiguration(t *testing.T) {
	t.Parallel()

	configPath := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(`
version: "1"
cors:
  allow_origins: []
  match_origins: ['https://([a-z0-9-]+\.)*example\.com']
  allow_credentials: true
`), 0o600))
	loaded, err := config.LoadConfig([]string{configPath})
	require.NoError(t, err)
	router, err := NewRouter(t.Context(), optionsFromResources(zap.NewNop(), &loaded.Config, nil)...)
	require.NoError(t, err)

	handler := cors.New(*router.corsOptions)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	cases := []struct {
		name                 string
		method               string
		origin               string
		wantStatus           int
		wantAllowOrigin      string
		wantAllowCredentials string
	}{
		{
			name:                 "matching POST",
			method:               http.MethodPost,
			origin:               "https://app.example.com",
			wantStatus:           http.StatusOK,
			wantAllowOrigin:      "https://app.example.com",
			wantAllowCredentials: "true",
		},
		{
			name:       "POST with injected suffix",
			method:     http.MethodPost,
			origin:     "https://app.example.com.evil.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:                 "matching preflight",
			method:               http.MethodOptions,
			origin:               "https://app.example.com",
			wantStatus:           http.StatusNoContent,
			wantAllowOrigin:      "https://app.example.com",
			wantAllowCredentials: "true",
		},
		{
			name:       "preflight with injected suffix",
			method:     http.MethodOptions,
			origin:     "https://app.example.com.evil.com",
			wantStatus: http.StatusForbidden,
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(tt.method, "http://router.example/graphql", nil)
			req.Header.Set("Origin", tt.origin)
			req.Header.Set("Access-Control-Request-Method", "POST")
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			assert.Equal(t, tt.wantStatus, res.Code)
			assert.Equal(t, tt.wantAllowOrigin, res.Header().Get("Access-Control-Allow-Origin"))
			assert.Equal(t, tt.wantAllowCredentials, res.Header().Get("Access-Control-Allow-Credentials"))
		})
	}
}

func TestCORSInvalidMatchOriginsFailsStartup(t *testing.T) {
	t.Parallel()

	for _, enabled := range []bool{true, false} {
		loaded := config.Config{CORS: config.CORS{
			Enabled:      enabled,
			AllowOrigins: []string{"*"},
			MatchOrigins: []string{"https://["},
		}}
		_, err := NewRouter(t.Context(), optionsFromResources(zap.NewNop(), &loaded, nil)...)
		if enabled {
			assert.ErrorContains(t, err, "invalid CORS configuration")
			assert.ErrorContains(t, err, `match_origins "https://["`)
		} else {
			assert.NoError(t, err)
		}
	}
}
