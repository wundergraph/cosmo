package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wundergraph/cosmo/router-tests/testutil"
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
	roundTripper := &authRoundTripper{
		base:  http.DefaultTransport,
		token: initialToken,
	}

	httpClient := &http.Client{
		Transport: roundTripper,
	}

	transport := &mcp.StreamableClientTransport{
		Endpoint:   endpoint,
		HTTPClient: httpClient,
	}

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

// SetToken updates the authorization token without reconnecting
func (c *MCPAuthClient) SetToken(token string) {
	c.roundTripper.token = token
}

// CallTool calls an MCP tool.
// Returns *AuthError if the request fails due to HTTP 401/403.
func (c *MCPAuthClient) CallTool(ctx context.Context, toolName string, arguments map[string]any) (*mcp.CallToolResult, error) {
	params := &mcp.CallToolParams{
		Name:      toolName,
		Arguments: arguments,
	}

	result, err := c.session.CallTool(ctx, params)
	if err != nil {
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

	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		return nil
	}

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