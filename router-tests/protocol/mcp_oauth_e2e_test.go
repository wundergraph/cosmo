package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutil"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestMCPOAuthAuthentication(t *testing.T) {
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
		MCPAuthToken:      validToken,
		MCPOperationsPath: "testdata/mcp_operations",
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		t.Run("returns 401 with resource metadata when token is invalid", func(t *testing.T) {
			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), "invalid-jwt-token")

			err := client.Connect(ctx)
			require.Error(t, err, "should fail to connect with invalid token")

			authErr, ok := err.(*AuthError)
			require.True(t, ok, "expected *AuthError but got %T: %v", err, err)
			assert.Equal(t, http.StatusUnauthorized, authErr.StatusCode, "should return HTTP 401")
			assert.NotEmpty(t, authErr.ResourceMetadataURL, "should include resource_metadata for OAuth discovery")
		})

		t.Run("returns 401 with resource metadata when token is missing", func(t *testing.T) {
			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), "")

			err := client.Connect(ctx)
			require.Error(t, err, "should fail to connect without token")

			authErr, ok := err.(*AuthError)
			require.True(t, ok, "expected *AuthError but got %T: %v", err, err)
			assert.Equal(t, http.StatusUnauthorized, authErr.StatusCode, "should return HTTP 401")
			assert.NotEmpty(t, authErr.ResourceMetadataURL, "should include resource_metadata for OAuth discovery")
		})
	})
}

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
					Initialize:     []string{"mcp:connect"},
					GetSchema:      []string{"mcp:tools:read"},
					ExecuteGraphQL: []string{"mcp:tools:write"},
				},
				ScopeChallengeIncludeTokenScopes: true,
			},
		},
		MCPAuthToken:      initToken,
		MCPOperationsPath: "testdata/mcp_operations",
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		t.Run("returns error when token is missing HTTP-level scopes", func(t *testing.T) {
			noConnectToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
			require.NoError(t, err)

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), noConnectToken)
			err = client.Connect(ctx)
			require.Error(t, err, "should fail to connect without HTTP-level scopes")

			authErr, ok := err.(*AuthError)
			require.True(t, ok, "expected *AuthError but got %T: %v", err, err)
			assert.True(t, authErr.StatusCode == http.StatusUnauthorized || authErr.StatusCode == http.StatusForbidden)
		})

		t.Run("returns 403 with insufficient_scope when tool call is missing per-tool scopes", func(t *testing.T) {
			connectOnlyToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect"})
			require.NoError(t, err)

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), connectOnlyToken)
			err = client.Connect(ctx)
			require.NoError(t, err, "should connect with HTTP-level scopes")
			defer client.Close() //nolint:errcheck

			_, err = client.CallTool(ctx, "get_schema", nil)
			require.Error(t, err, "should fail without per-tool scopes")

			authErr, ok := err.(*AuthError)
			require.True(t, ok, "should return AuthError but got %T: %v", err, err)
			assert.Equal(t, http.StatusForbidden, authErr.StatusCode, "should return HTTP 403")
			assert.Equal(t, "insufficient_scope", authErr.ErrorCode)
			assert.Contains(t, authErr.RequiredScopes, "mcp:tools:read")
		})

		t.Run("allows tool call when token has required per-tool scope", func(t *testing.T) {
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

		t.Run("challenges with different scopes for different tools", func(t *testing.T) {
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

		t.Run("allows tool call after reconnecting with upgraded scopes", func(t *testing.T) {
			// The MCP SDK closes the session on HTTP 403, so clients must
			// reconnect after re-authorizing for broader scopes (per OAuth spec).
			readToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect", "mcp:tools:read"})
			require.NoError(t, err)

			readClient := NewMCPAuthClient(xEnv.GetMCPServerAddr(), readToken)
			require.NoError(t, readClient.Connect(ctx))

			_, err = readClient.CallTool(ctx, "execute_graphql", map[string]any{
				"query": "query { __typename }",
			})
			require.Error(t, err, "should fail without write scopes")
			readClient.Close() //nolint:errcheck

			writeToken, err := oauthServer.CreateTokenWithScopes("test-user", []string{"mcp:connect", "mcp:tools:read", "mcp:tools:write"})
			require.NoError(t, err)

			writeClient := NewMCPAuthClient(xEnv.GetMCPServerAddr(), writeToken)
			require.NoError(t, writeClient.Connect(ctx))
			defer writeClient.Close() //nolint:errcheck

			result, err := writeClient.CallTool(ctx, "execute_graphql", map[string]any{
				"query": "query { __typename }",
			})
			require.NoError(t, err, "should succeed after reconnecting with upgraded scopes")
			require.NotNil(t, result)
		})
	})
}

func TestMCPOAuthMultipleAuthorizationServers(t *testing.T) {
	oauthServerA, err := testutil.NewOAuthTestServer(t, &testutil.OAuthTestServerOptions{KeyID: "server_a_rsa"})
	require.NoError(t, err, "failed to start OAuth server A")
	defer oauthServerA.Close() //nolint:errcheck

	oauthServerB, err := testutil.NewOAuthTestServer(t, &testutil.OAuthTestServerOptions{KeyID: "server_b_rsa"})
	require.NoError(t, err, "failed to start OAuth server B")
	defer oauthServerB.Close() //nolint:errcheck

	oauthServerUnknown, err := testutil.NewOAuthTestServer(t, &testutil.OAuthTestServerOptions{KeyID: "server_unknown_rsa"})
	require.NoError(t, err, "failed to start unknown OAuth server")
	defer oauthServerUnknown.Close() //nolint:errcheck

	tokenFromA, err := oauthServerA.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
	require.NoError(t, err, "failed to create token on server A")

	testenv.Run(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled: true,
			OAuth: config.MCPOAuthConfiguration{
				Enabled: true,
				JWKS: []config.JWKSConfiguration{
					{URL: oauthServerA.JWKSURL()},
					{URL: oauthServerB.JWKSURL()},
				},
				AuthorizationServerURLs: []string{
					oauthServerA.Issuer(),
					oauthServerB.Issuer(),
				},
			},
		},
		MCPAuthToken:      tokenFromA,
		MCPOperationsPath: "testdata/mcp_operations",
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := context.Background()

		t.Run("metadata endpoint advertises all authorization servers", func(t *testing.T) {
			metadataURL := strings.TrimSuffix(xEnv.GetMCPServerAddr(), "/mcp") + "/.well-known/oauth-protected-resource/mcp"

			resp, err := http.Get(metadataURL)
			require.NoError(t, err)
			defer resp.Body.Close() //nolint:errcheck

			require.Equal(t, http.StatusOK, resp.StatusCode)

			var metadata struct {
				AuthorizationServers []string `json:"authorization_servers"`
			}
			require.NoError(t, json.NewDecoder(resp.Body).Decode(&metadata))
			assert.Equal(t, []string{oauthServerA.Issuer(), oauthServerB.Issuer()}, metadata.AuthorizationServers)
		})

		t.Run("accepts tokens from the first authorization server", func(t *testing.T) {
			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), tokenFromA)

			require.NoError(t, client.Connect(ctx), "should connect with a token from server A")
			defer client.Close() //nolint:errcheck
		})

		t.Run("accepts tokens from the second authorization server", func(t *testing.T) {
			tokenFromB, err := oauthServerB.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
			require.NoError(t, err, "failed to create token on server B")

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), tokenFromB)

			require.NoError(t, client.Connect(ctx), "should connect with a token from server B")
			defer client.Close() //nolint:errcheck
		})

		t.Run("rejects tokens from an unknown authorization server", func(t *testing.T) {
			tokenFromUnknown, err := oauthServerUnknown.CreateTokenWithScopes("test-user", []string{"mcp:tools:read"})
			require.NoError(t, err, "failed to create token on unknown server")

			client := NewMCPAuthClient(xEnv.GetMCPServerAddr(), tokenFromUnknown)

			err = client.Connect(ctx)
			require.Error(t, err, "should fail to connect with a token from an unknown issuer")

			authErr, ok := err.(*AuthError)
			require.True(t, ok, "expected *AuthError but got %T: %v", err, err)
			assert.Equal(t, http.StatusUnauthorized, authErr.StatusCode, "should return HTTP 401")
		})
	})
}
