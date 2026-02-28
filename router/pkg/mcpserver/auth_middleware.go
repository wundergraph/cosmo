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

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

type contextKey string

const (
	userClaimsContextKey contextKey = "mcp_user_claims"
	// maxBodyBytes is the maximum size of the request body we'll read for scope checking.
	// This prevents memory exhaustion from oversized payloads.
	maxBodyBytes int64 = 1 << 20 // 1 MB
)

// mcpAuthProvider adapts MCP headers to the authentication.Provider interface
type mcpAuthProvider struct {
	headers http.Header
}

func (p *mcpAuthProvider) AuthenticationHeaders() http.Header {
	return p.headers
}

// MCPScopeConfig holds the structured scope requirements for MCP operations.
type MCPScopeConfig struct {
	Initialize []string // Scopes required for all HTTP requests
	ToolsList  []string // Scopes required for tools/list
	ToolsCall  []string // Scopes required for tools/call (any tool)
}

// MCPAuthMiddleware creates authentication middleware for MCP tools and resources
type MCPAuthMiddleware struct {
	authenticator       authentication.Authenticator
	enabled             bool
	resourceMetadataURL string
	scopes              MCPScopeConfig
	scopeChallengeMode  string // "required_only" or "required_and_existing"
}

// NewMCPAuthMiddleware creates a new authentication middleware using the existing
// authentication infrastructure from the router
func NewMCPAuthMiddleware(tokenDecoder authentication.TokenDecoder, enabled bool, resourceMetadataURL string, scopes MCPScopeConfig, scopeChallengeMode string) (*MCPAuthMiddleware, error) {
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

	if scopeChallengeMode == "" {
		scopeChallengeMode = "required_and_existing"
	}

	return &MCPAuthMiddleware{
		authenticator:       authenticator,
		enabled:             enabled,
		resourceMetadataURL: resourceMetadataURL,
		scopes:              scopes,
		scopeChallengeMode:  scopeChallengeMode,
	}, nil
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

	// Note: Scope validation is now handled at HTTP level, not here
	// This is per MCP spec: authorization must be at HTTP level

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

		// Step 1: Validate HTTP-level required scopes (initialize)
		if len(m.scopes.Initialize) > 0 {
			if err := m.validateScopesForRequest(claims, m.scopes.Initialize); err != nil {
				m.sendInsufficientScopeResponse(w, m.scopes.Initialize, claims, err)
				return
			}
		}

		// Step 2: Parse JSON-RPC request to check method-level scopes
		// Read body to extract method name (only if body exists)
		// Use LimitReader to prevent memory exhaustion from oversized payloads
		var body []byte
		if r.Body != nil {
			limitedReader := io.LimitReader(r.Body, maxBodyBytes+1)
			body, err = io.ReadAll(limitedReader)
			if err != nil {
				m.sendUnauthorizedResponse(w, fmt.Errorf("failed to read request body"))
				return
			}
			if int64(len(body)) > maxBodyBytes {
				m.sendUnauthorizedResponse(w, fmt.Errorf("request body too large"))
				return
			}
			// Restore body for downstream handlers
			r.Body = io.NopCloser(bytes.NewBuffer(body))
		}

		// Try to parse as JSON-RPC request (only if we have body content)
		if len(body) > 0 {
			var jsonRPCReq struct {
				Method string `json:"method"`
			}
			if err := json.Unmarshal(body, &jsonRPCReq); err == nil && jsonRPCReq.Method != "" {
				// Check method-level scopes
				var methodScopes []string
				switch jsonRPCReq.Method {
				case "tools/list":
					methodScopes = m.scopes.ToolsList
				case "tools/call":
					methodScopes = m.scopes.ToolsCall
				}
				if len(methodScopes) > 0 {
					if err := m.validateScopesForRequest(claims, methodScopes); err != nil {
						m.sendInsufficientScopeResponse(w, methodScopes, claims, err)
						return
					}
				}
			}
		}

		// Add claims and request headers to request context for downstream handlers
		ctx := context.WithValue(r.Context(), userClaimsContextKey, claims)
		ctx = requestHeadersFromRequest(ctx, r)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// sendUnauthorizedResponse sends a 401 Unauthorized response with proper headers.
// It includes the minimum required scopes (from initialize) so that the MCP SDK
// can request exactly the scopes needed to establish a connection.
func (m *MCPAuthMiddleware) sendUnauthorizedResponse(w http.ResponseWriter, err error) {
	// Build WWW-Authenticate header per RFC 6750 and RFC 9728
	authHeader := `Bearer realm="mcp"`

	// Include minimum required scopes (initialize scopes) so the client knows
	// what scopes to request for initial authentication
	if len(m.scopes.Initialize) > 0 {
		authHeader += fmt.Sprintf(`, scope="%s"`, strings.Join(m.scopes.Initialize, " "))
	}

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

// sendInsufficientScopeResponse sends a 403 Forbidden response per RFC 6750 Section 3.1
// when the token is valid but lacks required scopes.
//
// The scope parameter content depends on scopeChallengeMode:
//   - "required_only": only the scopes the operation needs (RFC 6750 strict)
//   - "required_and_existing": token's existing scopes + required scopes (SDK-compatible)
func (m *MCPAuthMiddleware) sendInsufficientScopeResponse(w http.ResponseWriter, operationScopes []string, claims authentication.Claims, err error) {
	var challengeScopes []string

	switch m.scopeChallengeMode {
	case "required_only":
		challengeScopes = operationScopes
	default: // "required_and_existing"
		// Union of token's existing scopes + operation's required scopes
		existing := extractScopes(claims)
		seen := make(map[string]struct{})
		for _, s := range existing {
			seen[s] = struct{}{}
			challengeScopes = append(challengeScopes, s)
		}
		for _, s := range operationScopes {
			if _, ok := seen[s]; !ok {
				challengeScopes = append(challengeScopes, s)
			}
		}
	}

	scopeList := strings.Join(challengeScopes, " ")

	// Build WWW-Authenticate header with error and scope information
	// Per RFC 6750 Section 3.1 and MCP spec: error, scope, resource_metadata, error_description
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

// validateScopesForRequest checks if the token contains all required scopes
func (m *MCPAuthMiddleware) validateScopesForRequest(claims authentication.Claims, requiredScopes []string) error {
	// If no scopes are required, skip validation
	if len(requiredScopes) == 0 {
		return nil
	}

	// Extract scopes from claims
	tokenScopes := extractScopes(claims)

	// Check if all required scopes are present
	var missingScopes []string
	for _, requiredScope := range requiredScopes {
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
