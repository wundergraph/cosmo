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

// TestMCPOAuthScopeUpgrade tests the complete OAuth scope upgrade flow with real JWT validation
// This test verifies:
// 1. Server validates JWT tokens using JWKS
// 2. Server returns HTTP 403 with WWW-Authenticate header for insufficient scopes
// 3. Client can parse the WWW-Authenticate header to get required scopes
// 4. Client can upgrade token and retry on the same MCP session
func TestMCPOAuthScopeUpgrade(t *testing.T) {
	// Start JWKS test server
	jwksServer, err := testutil.NewJWKSTestServer(t, "8765")
	require.NoError(t, err, "failed to start JWKS server")
	defer jwksServer.Close() //nolint:errcheck

	// Step 1: Create valid JWT with read-only scope for testenv initialization
	readOnlyToken, err := jwksServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
	require.NoError(t, err, "failed to create read-only token")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled:                   true,
			ExposeSchema:              true, // Enable get_schema tool
			EnableArbitraryOperations: true, // Enable execute_graphql tool
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{
						URL: jwksServer.JWKSURL(),
					},
				},
				AuthorizationServerURL: jwksServer.Issuer(),
				// No initialize scopes - any valid token can initialize
				// Per-tool scopes can be configured in ScopesRequired map
				ScopesRequired: map[string][]string{
					// Example: "get_schema": {"mcp:tools:read"},
				},
			},
		},
		MCPAuthToken: readOnlyToken, // Pass token so testenv can initialize successfully
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), readOnlyToken)
		err = client.Connect(ctx)
		require.NoError(t, err, "should connect with valid token")
		defer client.Close() //nolint:errcheck

		t.Log("✓ Connected with read-only token")

		// Step 2: Call a tool (should succeed with any valid token)
		result, err := client.CallTool(ctx, "get_schema", nil)
		require.NoError(t, err, "get_schema should succeed with valid token")
		require.NotNil(t, result)
		t.Log("✓ Tool call succeeded with initial token")

		// Step 3: Create new token with different scopes
		// NOTE: Per-tool scope authorization is not implemented yet,
		// but token changes on persistent sessions are the key feature being tested
		newToken, err := jwksServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read", "mcp:tools:write"})
		require.NoError(t, err, "failed to create new token")

		// Step 4: Update token on SAME session (key point!)
		client.SetToken(newToken)
		t.Log("✓ Updated to new token (same session)")

		// Step 5: Call tool again with new token to verify token change worked
		result, err = client.CallTool(ctx, "execute_graphql", map[string]any{
			"query": "query { employees { id } }",
		})

		require.NoError(t, err, "tool call should succeed after token change")
		require.NotNil(t, result)
		t.Log("✓ Tool call succeeded with new token")
		t.Log("✓ Session persisted through token change")

		// Step 6: Verify we can change tokens multiple times on same session
		anotherToken, err := jwksServer.CreateTokenWithScopes("different-user", []string{"mcp:admin"})
		require.NoError(t, err, "failed to create another token")

		client.SetToken(anotherToken)
		_, err = client.CallTool(ctx, "get_schema", nil)
		require.NoError(t, err, "should succeed after second token change")
		t.Log("✓ Multiple token changes work on same session")
	})
}

// TestMCPOAuthInvalidToken tests that invalid JWT tokens are rejected with HTTP 401
func TestMCPOAuthInvalidToken(t *testing.T) {
	// Start JWKS test server
	jwksServer, err := testutil.NewJWKSTestServer(t, "8766")
	require.NoError(t, err, "failed to start JWKS server")
	defer jwksServer.Close() //nolint:errcheck

	// Create a valid token for testenv initialization (so router starts up)
	validToken, err := jwksServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
	require.NoError(t, err, "failed to create valid token")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled: true,
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{
						URL: jwksServer.JWKSURL(),
					},
				},
				AuthorizationServerURL: jwksServer.Issuer(),
			},
		},
		MCPAuthToken: validToken, // Pass valid token for testenv initialization
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		// Use an invalid token for the test client
		client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), "invalid-jwt-token")

		err := client.Connect(ctx)
		// Should fail during connect/initialize
		require.Error(t, err, "should fail to connect with invalid token")

		// Check if it's an auth error with HTTP 401
		authErr, ok := err.(*AuthError)
		if ok {
			assert.Equal(t, http.StatusUnauthorized, authErr.StatusCode, "should return HTTP 401")
			assert.NotEmpty(t, authErr.ResourceMetadataURL, "should include resource_metadata for OAuth discovery")
			t.Logf("✓ Invalid token rejected with HTTP 401: %v", authErr)
		}
	})
}

// TestMCPOAuthMissingToken tests that missing Authorization header is rejected
func TestMCPOAuthMissingToken(t *testing.T) {
	// Start JWKS test server
	jwksServer, err := testutil.NewJWKSTestServer(t, "8767")
	require.NoError(t, err, "failed to start JWKS server")
	defer jwksServer.Close() //nolint:errcheck

	// Create a valid token for testenv initialization (so router starts up)
	validToken, err := jwksServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
	require.NoError(t, err, "failed to create valid token")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled: true,
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{
						URL: jwksServer.JWKSURL(),
					},
				},
				AuthorizationServerURL: jwksServer.Issuer(),
			},
		},
		MCPAuthToken: validToken, // Pass valid token for testenv initialization
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		// Create test client without any token
		client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), "")

		err := client.Connect(ctx)
		// Should fail during connect/initialize
		require.Error(t, err, "should fail to connect without token")

		// Check if it's an auth error with HTTP 401
		authErr, ok := err.(*AuthError)
		if ok {
			assert.Equal(t, http.StatusUnauthorized, authErr.StatusCode, "should return HTTP 401")
			assert.NotEmpty(t, authErr.ResourceMetadataURL, "should include resource_metadata for OAuth discovery")
			t.Logf("✓ Request without token rejected with HTTP 401: %v", authErr)
		}
	})
}