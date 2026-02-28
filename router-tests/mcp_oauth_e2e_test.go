package integration

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutil"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestMCPOAuthScopeUpgrade tests the complete OAuth scope upgrade flow with real JWT validation.
// Uses OAuthTestServer which provides a full OAuth 2.1 AS (JWKS + token endpoint + registration)
// so the same server can be used by both Go tests and the official MCP TypeScript SDK.
func TestMCPOAuthScopeUpgrade(t *testing.T) {
	oauthServer, err := testutil.NewOAuthTestServer(t, nil)
	require.NoError(t, err, "failed to start OAuth server")
	defer oauthServer.Close() //nolint:errcheck

	readOnlyToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
	require.NoError(t, err, "failed to create read-only token")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled:                   true,
			ExposeSchema:              true,
			EnableArbitraryOperations: true,
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{URL: oauthServer.JWKSURL()},
				},
				AuthorizationServerURL: oauthServer.Issuer(),
				Scopes: config.MCPOAuthScopesConfiguration{},
			},
		},
		MCPAuthToken: readOnlyToken,
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), readOnlyToken)
		err = client.Connect(ctx)
		require.NoError(t, err, "should connect with valid token")
		defer client.Close() //nolint:errcheck

		t.Log("Connected with read-only token")

		result, err := client.CallTool(ctx, "get_schema", nil)
		require.NoError(t, err, "get_schema should succeed with valid token")
		require.NotNil(t, result)
		t.Log("Tool call succeeded with initial token")

		newToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read", "mcp:tools:write"})
		require.NoError(t, err, "failed to create new token")

		client.SetToken(newToken)
		t.Log("Updated to new token (same session)")

		result, err = client.CallTool(ctx, "execute_graphql", map[string]any{
			"query": "query { employees { id } }",
		})
		require.NoError(t, err, "tool call should succeed after token change")
		require.NotNil(t, result)
		t.Log("Tool call succeeded with new token")

		anotherToken, err := oauthServer.CreateTokenWithScopes("different-user", []string{"mcp:admin"})
		require.NoError(t, err, "failed to create another token")

		client.SetToken(anotherToken)
		_, err = client.CallTool(ctx, "get_schema", nil)
		require.NoError(t, err, "should succeed after second token change")
		t.Log("Multiple token changes work on same session")
	})
}

// TestMCPOAuthInvalidToken tests that invalid JWT tokens are rejected with HTTP 401.
func TestMCPOAuthInvalidToken(t *testing.T) {
	oauthServer, err := testutil.NewOAuthTestServer(t, nil)
	require.NoError(t, err, "failed to start OAuth server")
	defer oauthServer.Close() //nolint:errcheck

	validToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
	require.NoError(t, err, "failed to create valid token")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled: true,
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{URL: oauthServer.JWKSURL()},
				},
				AuthorizationServerURL: oauthServer.Issuer(),
			},
		},
		MCPAuthToken: validToken,
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), "invalid-jwt-token")

		err := client.Connect(ctx)
		require.Error(t, err, "should fail to connect with invalid token")

		authErr, ok := err.(*AuthError)
		if ok {
			assert.Equal(t, http.StatusUnauthorized, authErr.StatusCode, "should return HTTP 401")
			assert.NotEmpty(t, authErr.ResourceMetadataURL, "should include resource_metadata for OAuth discovery")
			t.Logf("Invalid token rejected with HTTP 401: %v", authErr)
		}
	})
}

// TestMCPOAuthMissingToken tests that missing Authorization header is rejected.
func TestMCPOAuthMissingToken(t *testing.T) {
	oauthServer, err := testutil.NewOAuthTestServer(t, nil)
	require.NoError(t, err, "failed to start OAuth server")
	defer oauthServer.Close() //nolint:errcheck

	validToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
	require.NoError(t, err, "failed to create valid token")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled: true,
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{URL: oauthServer.JWKSURL()},
				},
				AuthorizationServerURL: oauthServer.Issuer(),
			},
		},
		MCPAuthToken: validToken,
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), "")

		err := client.Connect(ctx)
		require.Error(t, err, "should fail to connect without token")

		authErr, ok := err.(*AuthError)
		if ok {
			assert.Equal(t, http.StatusUnauthorized, authErr.StatusCode, "should return HTTP 401")
			assert.NotEmpty(t, authErr.ResourceMetadataURL, "should include resource_metadata for OAuth discovery")
			t.Logf("Request without token rejected with HTTP 401: %v", authErr)
		}
	})
}

// TestMCPOAuthPerToolScopes tests per-tool scope requirements.
func TestMCPOAuthPerToolScopes(t *testing.T) {
	oauthServer, err := testutil.NewOAuthTestServer(t, nil)
	require.NoError(t, err, "failed to start OAuth server")
	defer oauthServer.Close() //nolint:errcheck

	initToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect"})
	require.NoError(t, err, "failed to create init token")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled:                   true,
			ExposeSchema:              true,
			EnableArbitraryOperations: true,
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{URL: oauthServer.JWKSURL()},
				},
				AuthorizationServerURL: oauthServer.Issuer(),
				Scopes: config.MCPOAuthScopesConfiguration{
					Initialize: []string{"mcp:connect"},
					ToolsCall:  []string{"mcp:tools:write"},
				},
				ScopeChallengeMode: "required_and_existing",
			},
		},
		MCPAuthToken: initToken,
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		t.Run("HTTP-level scopes are enforced on all requests", func(t *testing.T) {
			noConnectToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
			require.NoError(t, err)

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), noConnectToken)
			err = client.Connect(ctx)
			require.Error(t, err, "should fail to connect without HTTP-level scopes")

			authErr, ok := err.(*AuthError)
			if ok {
				assert.True(t, authErr.StatusCode == http.StatusUnauthorized || authErr.StatusCode == http.StatusForbidden)
				t.Logf("HTTP-level scope enforcement: %v", authErr)
			}
		})

		t.Run("Per-tool scopes are enforced on tool calls", func(t *testing.T) {
			connectOnlyToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect"})
			require.NoError(t, err)

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), connectOnlyToken)
			err = client.Connect(ctx)
			require.NoError(t, err, "should connect with HTTP-level scopes")
			defer client.Close() //nolint:errcheck

			_, err = client.CallTool(ctx, "get_schema", nil)
			require.Error(t, err, "should fail without per-tool scopes")

			authErr, ok := err.(*AuthError)
			require.True(t, ok, "should return AuthError")
			assert.Equal(t, http.StatusForbidden, authErr.StatusCode, "should return HTTP 403")
			assert.Equal(t, "insufficient_scope", authErr.ErrorCode)
			assert.Contains(t, authErr.RequiredScopes, "mcp:tools:read")
		})

		t.Run("Token with correct per-tool scopes succeeds", func(t *testing.T) {
			readToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect", "mcp:tools:read"})
			require.NoError(t, err)

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), readToken)
			err = client.Connect(ctx)
			require.NoError(t, err)
			defer client.Close() //nolint:errcheck

			result, err := client.CallTool(ctx, "get_schema", nil)
			require.NoError(t, err, "should succeed with correct scopes")
			require.NotNil(t, result)
		})

		t.Run("Different tools require different scopes", func(t *testing.T) {
			readToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect", "mcp:tools:read"})
			require.NoError(t, err)

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), readToken)
			err = client.Connect(ctx)
			require.NoError(t, err)
			defer client.Close() //nolint:errcheck

			_, err = client.CallTool(ctx, "get_schema", nil)
			require.NoError(t, err, "read tool should succeed")

			_, err = client.CallTool(ctx, "execute_graphql", map[string]any{
				"query": "query { __typename }",
			})
			require.Error(t, err, "write tool should fail without write scopes")

			authErr, ok := err.(*AuthError)
			require.True(t, ok)
			assert.Equal(t, http.StatusForbidden, authErr.StatusCode)
			assert.Contains(t, authErr.RequiredScopes, "mcp:tools:write")
		})

		t.Run("Scope upgrade on same session works", func(t *testing.T) {
			readToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect", "mcp:tools:read"})
			require.NoError(t, err)

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), readToken)
			err = client.Connect(ctx)
			require.NoError(t, err)
			defer client.Close() //nolint:errcheck

			_, err = client.CallTool(ctx, "execute_graphql", map[string]any{
				"query": "query { __typename }",
			})
			require.Error(t, err, "should fail without write scopes")

			writeToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect", "mcp:tools:read", "mcp:tools:write"})
			require.NoError(t, err)

			client.SetToken(writeToken)

			result, err := client.CallTool(ctx, "execute_graphql", map[string]any{
				"query": "query { __typename }",
			})
			require.NoError(t, err, "should succeed after scope upgrade")
			require.NotNil(t, result)
		})
	})
}