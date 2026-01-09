package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

type contextKey string

const (
	userClaimsContextKey contextKey = "mcp_user_claims"
)

// mcpAuthProvider adapts MCP headers to the authentication.Provider interface
type mcpAuthProvider struct {
	headers http.Header
}

func (p *mcpAuthProvider) AuthenticationHeaders() http.Header {
	return p.headers
}

// MCPAuthMiddleware creates authentication middleware for MCP tools and resources
type MCPAuthMiddleware struct {
	authenticator       authentication.Authenticator
	enabled             bool
	resourceMetadataURL string
	requiredScopes      []string // Minimal scopes required for any access
}

// NewMCPAuthMiddleware creates a new authentication middleware using the existing
// authentication infrastructure from the router
func NewMCPAuthMiddleware(tokenDecoder authentication.TokenDecoder, enabled bool, resourceMetadataURL string, requiredScopes []string) (*MCPAuthMiddleware, error) {
	if tokenDecoder == nil {
		return nil, fmt.Errorf("token decoder must be provided")
	}

	// Use the existing HttpHeaderAuthenticator with default settings (Authorization header, Bearer prefix)
	// This ensures consistency with the rest of the router's authentication logic
	authenticator, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name:         "mcp-auth",
		TokenDecoder: tokenDecoder,
		// HeaderSourcePrefixes defaults to {"Authorization": {"Bearer"}} when not specified
		// This can be extended in the future to support additional schemes like DPoP
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create authenticator: %w", err)
	}

	return &MCPAuthMiddleware{
		authenticator:       authenticator,
		enabled:             enabled,
		resourceMetadataURL: resourceMetadataURL,
		requiredScopes:      requiredScopes,
	}, nil
}

// ToolMiddleware wraps tool handlers with authentication
func (m *MCPAuthMiddleware) ToolMiddleware(next server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		if !m.enabled {
			return next(ctx, req)
		}

		// Extract and validate token
		claims, err := m.authenticateRequest(ctx)
		if err != nil {
			// Return authentication error with WWW-Authenticate challenge information
			// Per RFC 9728, we should indicate the resource metadata URL
			errorMsg := fmt.Sprintf("Authentication failed: %v", err)
			if m.resourceMetadataURL != "" {
				errorMsg = fmt.Sprintf("Authentication required. Resource metadata available at: %s. Error: %v",
					m.resourceMetadataURL, err)
			}
			return mcp.NewToolResultError(errorMsg), nil
		}

		// Add claims to context
		ctx = context.WithValue(ctx, userClaimsContextKey, claims)

		return next(ctx, req)
	}
}

// authenticateRequest extracts and validates the JWT token using the existing
// authentication infrastructure from the router
func (m *MCPAuthMiddleware) authenticateRequest(ctx context.Context) (authentication.Claims, error) {
	// Extract headers from context (passed by mcp-go HTTP transport)
	headers, err := headersFromContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("missing request headers: %w", err)
	}

	// Use the existing authenticator instead of manual token parsing
	// This provides better error messages and supports multiple authentication schemes
	provider := &mcpAuthProvider{headers: headers}
	claims, err := m.authenticator.Authenticate(ctx, provider)
	if err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	// If claims are empty, treat as authentication failure
	if len(claims) == 0 {
		return nil, fmt.Errorf("authentication failed: no valid credentials provided")
	}

	// Validate required scopes
	if err := m.validateScopes(claims); err != nil {
		return nil, err
	}

	return claims, nil
}

// HTTPMiddleware wraps HTTP handlers with authentication for ALL MCP operations
// Per MCP specification: "authorization MUST be included in every HTTP request from client to server"
func (m *MCPAuthMiddleware) HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !m.enabled {
			next.ServeHTTP(w, r)
			return
		}

		// Create a provider from the HTTP request headers
		provider := &mcpAuthProvider{headers: r.Header}

		// Validate the token
		claims, err := m.authenticator.Authenticate(r.Context(), provider)
		if err != nil || len(claims) == 0 {
			m.sendUnauthorizedResponse(w, err)
			return
		}

		// Validate required scopes
		if err := m.validateScopes(claims); err != nil {
			m.sendInsufficientScopeResponse(w, err)
			return
		}

		// Add claims to request context for downstream handlers
		ctx := context.WithValue(r.Context(), userClaimsContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// sendUnauthorizedResponse sends a 401 Unauthorized response with proper headers
func (m *MCPAuthMiddleware) sendUnauthorizedResponse(w http.ResponseWriter, err error) {
	// Build WWW-Authenticate header per RFC 6750 and RFC 9728
	authHeader := `Bearer realm="mcp"`

	// Add resource_metadata per RFC 9728 for OAuth discovery
	if m.resourceMetadataURL != "" {
		authHeader += fmt.Sprintf(`, resource_metadata="%s"`, m.resourceMetadataURL)
	}

	// Add optional error_description for debugging
	if err != nil {
		authHeader += fmt.Sprintf(`, error_description="%s"`, err.Error())
	}

	w.Header().Set("WWW-Authenticate", authHeader)
	w.WriteHeader(http.StatusUnauthorized)

	// Per MCP spec: Authorization failures at HTTP level return only HTTP status and WWW-Authenticate header
	// No JSON-RPC response body is returned
}

// sendInsufficientScopeResponse sends a 403 Forbidden response per RFC 6750
// when the token is valid but lacks required scopes
func (m *MCPAuthMiddleware) sendInsufficientScopeResponse(w http.ResponseWriter, err error) {
	// Build WWW-Authenticate header with error and scope information
	// Per RFC 6750 Section 3.1 and MCP spec: error, scope, resource_metadata, error_description
	scopeList := strings.Join(m.requiredScopes, " ")

	authHeader := fmt.Sprintf(`Bearer error="insufficient_scope", scope="%s"`, scopeList)

	// Add resource_metadata per MCP spec (should be included per spec line 513)
	if m.resourceMetadataURL != "" {
		authHeader += fmt.Sprintf(`, resource_metadata="%s"`, m.resourceMetadataURL)
	}

	// Add optional error_description for human-readable message
	if err != nil {
		authHeader += fmt.Sprintf(`, error_description="%s"`, err.Error())
	}

	w.Header().Set("WWW-Authenticate", authHeader)
	w.WriteHeader(http.StatusForbidden)

	// Per MCP spec: Authorization failures at HTTP level return only HTTP status and WWW-Authenticate header
	// No JSON-RPC response body is returned
}

// validateScopes checks if the token contains all required scopes
func (m *MCPAuthMiddleware) validateScopes(claims authentication.Claims) error {
	// If no scopes are required, skip validation
	if len(m.requiredScopes) == 0 {
		return nil
	}

	// Extract scopes from claims
	tokenScopes := extractScopes(claims)

	// Check if all required scopes are present
	var missingScopes []string
	for _, requiredScope := range m.requiredScopes {
		if !contains(tokenScopes, requiredScope) {
			missingScopes = append(missingScopes, requiredScope)
		}
	}

	if len(missingScopes) > 0 {
		return fmt.Errorf("missing required scopes: %s", strings.Join(missingScopes, ", "))
	}

	return nil
}

// extractScopes extracts scope values from JWT claims
// Supports only the OAuth 2.0 standard "scope" claim as a space-separated string
func extractScopes(claims authentication.Claims) []string {
	// Check for "scope" claim (OAuth 2.0 standard - space-separated string)
	scopeClaim, ok := claims["scope"]
	if !ok {
		return []string{}
	}

	// Only support string format per OAuth 2.0 spec
	scopeStr, ok := scopeClaim.(string)
	if !ok {
		return []string{}
	}

	// Use Fields() to split on any whitespace (spaces, tabs, newlines)
	// and automatically filter out empty strings
	return strings.Fields(scopeStr)
}

// contains checks if a slice contains a specific string
func contains(slice []string, item string) bool {
	return slices.Contains(slice, item)
}

// GetClaimsFromContext retrieves authenticated user claims from context
func GetClaimsFromContext(ctx context.Context) (authentication.Claims, bool) {
	claims, ok := ctx.Value(userClaimsContextKey).(authentication.Claims)
	return claims, ok
}
