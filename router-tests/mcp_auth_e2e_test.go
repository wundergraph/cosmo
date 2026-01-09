package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutil"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// authRoundTripper wraps an http.RoundTripper and adds Authorization headers
// It also captures the last HTTP response for error analysis
type authRoundTripper struct {
	base         http.RoundTripper
	token        string
	lastResponse *http.Response
}

func (a *authRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	// Clone the request to avoid modifying the original
	req = req.Clone(req.Context())

	// Add Authorization header if token is set
	if a.token != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", a.token))
	}

	resp, err := a.base.RoundTrip(req)
	// Capture response for error analysis
	a.lastResponse = resp
	return resp, err
}

// MCPAuthClient wraps the official MCP client with authorization support
type MCPAuthClient struct {
	endpoint     string
	transport    *mcp.StreamableClientTransport
	roundTripper *authRoundTripper
	client       *mcp.Client
	session      *mcp.ClientSession
}

// AuthError represents an HTTP authentication/authorization error
type AuthError struct {
	StatusCode          int
	ErrorCode           string
	RequiredScopes      []string
	ResourceMetadataURL string
	ErrorDescription    string
}

func (e *AuthError) Error() string {
	if e.ErrorCode == "insufficient_scope" {
		return fmt.Sprintf("HTTP %d: insufficient scope - required scopes: %v", e.StatusCode, e.RequiredScopes)
	}
	return fmt.Sprintf("HTTP %d: %s - %s", e.StatusCode, e.ErrorCode, e.ErrorDescription)
}

// NewMCPAuthClient creates a new MCP client with authorization support
func NewMCPAuthClient(endpoint string, initialToken string) *MCPAuthClient {
	// Create a custom round tripper that adds Authorization headers
	roundTripper := &authRoundTripper{
		base:  http.DefaultTransport,
		token: initialToken,
	}

	// Create HTTP client with custom round tripper
	httpClient := &http.Client{
		Transport: roundTripper,
	}

	// Create streamable transport
	transport := &mcp.StreamableClientTransport{
		Endpoint:   endpoint,
		HTTPClient: httpClient,
	}

	// Create MCP client
	client := mcp.NewClient(&mcp.Implementation{
		Name:    "test-client",
		Version: "1.0.0",
	}, nil)

	return &MCPAuthClient{
		endpoint:     endpoint,
		transport:    transport,
		roundTripper: roundTripper,
		client:       client,
	}
}

// Connect establishes the MCP connection and initializes the session
func (c *MCPAuthClient) Connect(ctx context.Context) error {
	session, err := c.client.Connect(ctx, c.transport, nil)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	c.session = session
	return nil
}

// SetToken updates the authorization token
// This is the KEY method - it allows changing tokens without reconnecting!
func (c *MCPAuthClient) SetToken(token string) {
	c.roundTripper.token = token
}

// CallTool calls an MCP tool
// Returns *AuthError if the request fails due to HTTP 401/403
func (c *MCPAuthClient) CallTool(ctx context.Context, toolName string, arguments map[string]any) (*mcp.CallToolResult, error) {
	params := &mcp.CallToolParams{
		Name:      toolName,
		Arguments: arguments,
	}

	result, err := c.session.CallTool(ctx, params)
	if err != nil {
		// Check if this was an HTTP auth error
		if authErr := c.checkAuthError(); authErr != nil {
			return nil, authErr
		}
		return nil, err
	}

	return result, nil
}

// checkAuthError checks if the last HTTP response was an auth error (401/403)
// and returns an AuthError with parsed WWW-Authenticate header information
func (c *MCPAuthClient) checkAuthError() *AuthError {
	if c.roundTripper.lastResponse == nil {
		return nil
	}

	resp := c.roundTripper.lastResponse

	// Check for 401 Unauthorized or 403 Forbidden
	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		return nil
	}

	// Parse WWW-Authenticate header
	authHeader := resp.Header.Get("WWW-Authenticate")
	if authHeader == "" {
		return &AuthError{
			StatusCode: resp.StatusCode,
			ErrorCode:  "authentication_required",
		}
	}

	params := testutil.ParseWWWAuthenticateParams(authHeader)

	authErr := &AuthError{
		StatusCode:          resp.StatusCode,
		ErrorCode:           params["error"],
		ResourceMetadataURL: params["resource_metadata"],
		ErrorDescription:    params["error_description"],
	}

	// Parse required scopes (space-separated)
	if scopeStr := params["scope"]; scopeStr != "" {
		authErr.RequiredScopes = strings.Fields(scopeStr)
	}

	return authErr
}

// Close closes the MCP session
func (c *MCPAuthClient) Close() error {
	if c.session != nil {
		return c.session.Close()
	}
	return nil
}

// TestMCPAuthorizationWithOfficialSDK demonstrates authorization testing with the official MCP Go SDK
func TestMCPAuthorizationWithOfficialSDK(t *testing.T) {
	t.Run("Basic connection with token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx := context.Background()

			// Create MCP client with initial token
			token := "test-token-with-read-scopes"
			mcpClient := NewMCPAuthClient(xEnv.GetMCPServerAddr(), token)

			// Connect and initialize
			err := mcpClient.Connect(ctx)
			require.NoError(t, err)
			defer mcpClient.Close() //nolint:errcheck

			t.Logf("✓ Connected to MCP server with token: %s", token[:20]+"...")

			// Call a tool
			result, err := mcpClient.CallTool(ctx, "execute_operation_my_employees", map[string]any{
				"criteria": map[string]any{},
			})

			// Without authorization configured, this should work
			require.NoError(t, err)
			require.NotNil(t, result)
			t.Logf("✓ Successfully called tool")
		})
	})

	t.Run("Scope upgrade on persistent session", func(t *testing.T) {
		// This test demonstrates the KEY concept:
		// - Establish session with token1
		// - Get "insufficient scopes" error
		// - Update token (SetToken)
		// - Retry on SAME session with new token

		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				// TODO: Add authorization configuration when implemented
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx := context.Background()

			// Step 1: Connect with limited token
			readToken := "token-with-scope-mcp:tools:read"
			mcpClient := NewMCPAuthClient(xEnv.GetMCPServerAddr(), readToken)

			err := mcpClient.Connect(ctx)
			require.NoError(t, err)
			defer mcpClient.Close() //nolint:errcheck

			t.Logf("✓ Step 1: Connected with read-only token")
			t.Logf("  Token: %s", readToken[:30]+"...")

			// Step 2: Call read operation (should succeed)
			result, err := mcpClient.CallTool(ctx, "execute_operation_my_employees", map[string]any{
				"criteria": map[string]any{},
			})
			require.NoError(t, err)
			require.NotNil(t, result)
			t.Logf("✓ Step 2: Read operation succeeded")

			// Step 3: Try write operation (should fail with insufficient scopes)
			// NOTE: This would fail if authorization is configured
			_, err = mcpClient.CallTool(ctx, "execute_operation_update_mood", map[string]any{
				"employeeID": 1,
				"mood":       "HAPPY",
			})

			// Without authorization, this succeeds. With authorization, check for scope error
			if err != nil {
				t.Logf("✓ Step 3: Write operation failed (expected with auth): %v", err)

				// In a real scenario with authorization:
				// 1. Parse error to get required scopes
				// 2. User goes through OAuth flow
				// 3. Get new token with required scopes

				// Step 4: Update token on SAME session
				writeToken := "token-with-scope-mcp:tools:read,mcp:tools:write"
				mcpClient.SetToken(writeToken)
				t.Logf("✓ Step 4: Updated token (same session)")
				t.Logf("  New Token: %s", writeToken[:30]+"...")

				// Step 5: Retry write operation with upgraded token
				result, err := mcpClient.CallTool(ctx, "execute_operation_update_mood", map[string]any{
					"employeeID": 1,
					"mood":       "HAPPY",
				})

				assert.NoError(t, err)
				assert.NotNil(t, result)
				t.Logf("✓ Step 5: Write operation succeeded with upgraded token")
			} else {
				t.Logf("✓ Step 3: Write operation succeeded (no authorization configured)")
			}
		})
	})

	t.Run("Multiple token changes on same session", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx := context.Background()

			mcpClient := NewMCPAuthClient(xEnv.GetMCPServerAddr(), "initial-token")
			err := mcpClient.Connect(ctx)
			require.NoError(t, err)
			defer mcpClient.Close() //nolint:errcheck

			t.Logf("✓ Connected with initial token")

			// Simulate multiple scope upgrades
			tokens := []string{
				"token-with-basic-scopes",
				"token-with-read-scopes",
				"token-with-write-scopes",
				"token-with-admin-scopes",
			}

			for i, token := range tokens {
				mcpClient.SetToken(token)

				// Make a call with the new token
				result, err := mcpClient.CallTool(ctx, "execute_operation_my_employees", map[string]any{
					"criteria": map[string]any{},
				})

				require.NoError(t, err)
				require.NotNil(t, result)
				t.Logf("✓ Request %d succeeded with token: %s", i+1, token[:25]+"...")
			}

			t.Logf("✓ All token changes worked on same session")
		})
	})
}

// Example_mcpAuthorizationFlow shows how to use the auth client
func Example_mcpAuthorizationFlow() {
	ctx := context.Background()

	// Create client with initial token
	client := NewMCPAuthClient("http://localhost:3000/mcp", "initial-token")
	defer client.Close() //nolint:errcheck

	// Connect
	if err := client.Connect(ctx); err != nil {
		panic(err)
	}

	// Try to call a tool
	_, err := client.CallTool(ctx, "some_tool", map[string]any{})

	// If we get insufficient scopes error
	if err != nil {
		// 1. User goes through OAuth flow (not shown)
		// 2. Get new token with more scopes
		newToken := "token-with-more-scopes"

		// 3. Update token on SAME session
		client.SetToken(newToken)

		// 4. Retry the tool call
		_, err = client.CallTool(ctx, "some_tool", map[string]any{})
		if err != nil {
			panic(err)
		}
	}

	fmt.Println("Success!")
}
