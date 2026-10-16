package mcpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestHandleProtectedResourceMetadata(t *testing.T) {
	t.Parallel()

	newServer := func(oauthConfig *config.MCPOAuthConfiguration) *GraphQLSchemaServer {
		return &GraphQLSchemaServer{
			logger:        zap.NewNop(),
			serverBaseURL: "https://router.example.com",
			oauthConfig:   oauthConfig,
		}
	}

	getMetadata := func(t *testing.T, s *GraphQLSchemaServer) ProtectedResourceMetadata {
		t.Helper()

		req := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource/mcp", nil)
		rec := httptest.NewRecorder()
		s.handleProtectedResourceMetadata(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)

		var metadata ProtectedResourceMetadata
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &metadata))
		return metadata
	}

	t.Run("advertises the single authorization server", func(t *testing.T) {
		t.Parallel()

		metadata := getMetadata(t, newServer(&config.MCPOAuthConfiguration{
			Enabled:                true,
			AuthorizationServerURL: "https://auth-a.example.com",
		}))

		require.Equal(t, "https://router.example.com/mcp", metadata.Resource)
		require.Equal(t, []string{"https://auth-a.example.com"}, metadata.AuthorizationServers)
	})

	t.Run("advertises all configured authorization servers", func(t *testing.T) {
		t.Parallel()

		metadata := getMetadata(t, newServer(&config.MCPOAuthConfiguration{
			Enabled: true,
			AuthorizationServerURLs: []string{
				"https://auth-a.example.com",
				"https://auth-b.example.com",
			},
		}))

		require.Equal(t, []string{
			"https://auth-a.example.com",
			"https://auth-b.example.com",
		}, metadata.AuthorizationServers)
	})

	t.Run("merges single and multiple authorization servers without duplicates", func(t *testing.T) {
		t.Parallel()

		metadata := getMetadata(t, newServer(&config.MCPOAuthConfiguration{
			Enabled:                true,
			AuthorizationServerURL: "https://auth-a.example.com",
			AuthorizationServerURLs: []string{
				"https://auth-a.example.com",
				"https://auth-b.example.com",
			},
		}))

		require.Equal(t, []string{
			"https://auth-a.example.com",
			"https://auth-b.example.com",
		}, metadata.AuthorizationServers)
	})
}
