package mcpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
)

func TestParseMountPath(t *testing.T) {
	valid := []struct {
		input string
		want  string
	}{
		{"/mcp", "/mcp"},
		{"/custom/path", "/custom/path"},
		{"/custom/path/", "/custom/path"},
		{"custom/path", "/custom/path"},
	}
	for _, tt := range valid {
		got, err := parseMountPath(tt.input)
		require.NoError(t, err, "input: %q", tt.input)
		assert.Equal(t, tt.want, got, "input: %q", tt.input)
	}

	invalid := []string{
		"",
		"  ",
		"/",
		"//",
		"/custom//path",
		"/mcp/{tenant}",
		"/mcp/{",
		"/custom path",
	}
	for _, input := range invalid {
		_, err := parseMountPath(input)
		assert.ErrorContains(t, err, "invalid MCP mount path", "input: %q", input)
	}
}

func TestInvalidMountPathRejected(t *testing.T) {
	for _, path := range []string{"/", "/mcp/{tenant}", "/custom//path"} {
		_, err := NewGraphQLSchemaServer(
			t.Context(),
			"http://localhost:4000/graphql",
			WithLogger(zap.NewNop()),
			WithMountPath(path),
		)
		assert.ErrorContains(t, err, "invalid MCP mount path", "path: %q", path)
	}
}

const initializeRequestBody = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test-client","version":"0.0.1"}}}`

func newMCPRequest(path string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(initializeRequestBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	return req
}

func TestServeCustomMountPath(t *testing.T) {
	srv, err := NewGraphQLSchemaServer(
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(zap.NewNop()),
		WithOperationsDir(t.TempDir()),
		WithMountPath("/custom/path/"),
		WithCORS(cors.Config{}),
	)
	require.NoError(t, err)

	handler := srv.buildHandler()

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, newMCPRequest("/custom/path"))
	assert.Equal(t, http.StatusOK, rr.Code, "MCP endpoint should be served at the custom mount path")

	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, newMCPRequest("/mcp"))
	assert.Equal(t, http.StatusNotFound, rr.Code, "default path should not be served when a custom mount path is set")
}

func TestWellKnownPathFollowsMountPath(t *testing.T) {
	srv, err := NewGraphQLSchemaServer(
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(zap.NewNop()),
		WithOperationsDir(t.TempDir()),
		WithMountPath("/custom/path"),
		WithCORS(cors.Config{}),
		WithServerBaseURL("http://localhost:5025"),
		WithOAuth(&config.MCPOAuthConfiguration{
			Enabled:                true,
			AuthorizationServerURL: "https://auth.example.com",
			JWKS: []config.JWKSConfiguration{
				{
					Secret:    "test-secret-key-for-hs256-signing",
					Algorithm: "HS256",
					KeyId:     "test-key",
				},
			},
		}),
	)
	require.NoError(t, err)

	assert.Equal(t, "http://localhost:5025/.well-known/oauth-protected-resource/custom/path", srv.GetResourceMetadataURL())

	handler := srv.buildHandler()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource/custom/path", nil)
	handler.ServeHTTP(rr, req)
	require.Equal(t, http.StatusOK, rr.Code, "well-known path should be derived from the mount path")

	var metadata ProtectedResourceMetadata
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &metadata))
	assert.Equal(t, "http://localhost:5025/custom/path", metadata.Resource)
	assert.Equal(t, []string{"https://auth.example.com"}, metadata.AuthorizationServers)

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource/mcp", nil)
	handler.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code, "default well-known path should not be served when a custom mount path is set")
}
