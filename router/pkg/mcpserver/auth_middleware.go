package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

// extractRequestID attempts to extract the JSON-RPC request ID from the request body
// Returns nil if the ID cannot be determined
func extractRequestID(r *http.Request) any {
	// Only attempt to read body for POST requests
	if r.Method != http.MethodPost {
		return nil
	}

	// Read the body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil
	}

	// Restore the body so downstream handlers can read it
	r.Body = io.NopCloser(bytes.NewBuffer(body))

	// Try to parse as JSON-RPC request
	var jsonRPCRequest struct {
		ID any `json:"id"`
	}

	if err := json.Unmarshal(body, &jsonRPCRequest); err != nil {
		return nil
	}

	return jsonRPCRequest.ID
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
			m.sendUnauthorizedResponse(w, r, err)
			return
		}

		// Validate required scopes
		if err := m.validateScopes(claims); err != nil {
			m.sendInsufficientScopeResponse(w, r, err)
			return
		}

		// Add claims to request context for downstream handlers
		ctx := context.WithValue(r.Context(), userClaimsContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// sendUnauthorizedResponse sends a 401 Unauthorized response with proper headers
func (m *MCPAuthMiddleware) sendUnauthorizedResponse(w http.ResponseWriter, r *http.Request, err error) {
	// Try to extract the request ID from the body for better error responses
	requestID := extractRequestID(r)

	// Return 401 with WWW-Authenticate header per RFC 9728
	w.Header().Set("Content-Type", "application/json")

	// Build WWW-Authenticate header with resource metadata URL
	if m.resourceMetadataURL != "" {
		w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer realm="mcp", resource="%s"`, m.resourceMetadataURL))
	} else {
		w.Header().Set("WWW-Authenticate", `Bearer realm="mcp"`)
	}

	w.WriteHeader(http.StatusUnauthorized)

	// Determine error message
	errorMessage := ErrorMessageAuthenticationRequired
	if err != nil {
		errorMessage = fmt.Sprintf("%s: %v", ErrorMessageAuthenticationRequired, err)
	}

	// Return JSON-RPC error response
	// Per JSON-RPC 2.0 spec, id should match the request ID or be null if unavailable
	errorResponse := map[string]any{
		"jsonrpc": "2.0",
		"id":      requestID,
		"error": map[string]any{
			"code":    ErrorCodeAuthenticationRequired,
			"message": errorMessage,
			"data": map[string]any{
				"resource_metadata": m.resourceMetadataURL,
			},
		},
	}

	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

// sendInsufficientScopeResponse sends a 403 Forbidden response per RFC 6750
// when the token is valid but lacks required scopes
func (m *MCPAuthMiddleware) sendInsufficientScopeResponse(w http.ResponseWriter, r *http.Request, err error) {
	// Try to extract the request ID from the body for better error responses
	requestID := extractRequestID(r)

	// Return 403 with WWW-Authenticate header per RFC 6750 Section 3.1
	w.Header().Set("Content-Type", "application/json")

	// Build WWW-Authenticate header with error and scope information
	// Per RFC 6750: error="insufficient_scope", scope="required scopes"
	scopeList := strings.Join(m.requiredScopes, " ")
	if m.resourceMetadataURL != "" {
		w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer realm="mcp", error="insufficient_scope", error_description="%s", scope="%s", resource="%s"`,
			err.Error(), scopeList, m.resourceMetadataURL))
	} else {
		w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer realm="mcp", error="insufficient_scope", error_description="%s", scope="%s"`,
			err.Error(), scopeList))
	}

	w.WriteHeader(http.StatusForbidden)

	// Return JSON-RPC error response
	errorResponse := map[string]any{
		"jsonrpc": "2.0",
		"id":      requestID,
		"error": map[string]any{
			"code":    ErrorCodeInsufficientScope,
			"message": fmt.Sprintf("Insufficient scope: %v", err),
			"data": map[string]any{
				"required_scopes":   m.requiredScopes,
				"resource_metadata": m.resourceMetadataURL,
			},
		},
	}

	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
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
