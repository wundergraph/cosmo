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
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/authentication"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
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
	Initialize       []string // Scopes required for all HTTP requests
	ToolsList        []string // Scopes required for tools/list
	ToolsCall        []string // Scopes required for tools/call (any tool)
	ExecuteGraphQL   []string // Scopes required for the execute_graphql built-in tool
	GetOperationInfo []string // Scopes required for the get_operation_info built-in tool
	GetSchema        []string // Scopes required for the get_schema built-in tool
}

// MCPAuthMiddleware creates authentication middleware for MCP tools and resources
type MCPAuthMiddleware struct {
	authenticator                    authentication.Authenticator
	enabled                          bool
	resourceMetadataURL              string
	scopes                           MCPScopeConfig
	scopeChallengeIncludeTokenScopes bool
	toolScopesMu                     sync.RWMutex
	toolScopes                       map[string][][]string // toolName → OR-of-AND scope groups
	scopeExtractorMu                 sync.RWMutex
	scopeExtractor                   *ScopeExtractor // for runtime scope checking of execute_graphql
}

// NewMCPAuthMiddleware creates a new authentication middleware using the existing
// authentication infrastructure from the router
func NewMCPAuthMiddleware(tokenDecoder authentication.TokenDecoder, enabled bool, resourceMetadataURL string, scopes MCPScopeConfig, scopeChallengeIncludeTokenScopes bool) (*MCPAuthMiddleware, error) {
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
		authenticator:                    authenticator,
		enabled:                          enabled,
		resourceMetadataURL:              resourceMetadataURL,
		scopes:                           scopes,
		scopeChallengeIncludeTokenScopes: scopeChallengeIncludeTokenScopes,
	}, nil
}

// SetToolScopes atomically replaces the per-tool scope map.
// Called during Reload() after tools are registered with their extracted scopes.
func (m *MCPAuthMiddleware) SetToolScopes(scopes map[string][][]string) {
	m.toolScopesMu.Lock()
	defer m.toolScopesMu.Unlock()
	m.toolScopes = scopes
}

// getToolScopes returns the OR-of-AND scope groups for the given tool name.
// Returns nil if the tool has no per-tool scope requirements.
func (m *MCPAuthMiddleware) getToolScopes(toolName string) [][]string {
	m.toolScopesMu.RLock()
	defer m.toolScopesMu.RUnlock()
	if m.toolScopes == nil {
		return nil
	}
	return m.toolScopes[toolName]
}

// getBuiltinToolScopes returns the configured scopes for a built-in tool.
// Returns nil if the tool is not a built-in or has no configured scopes.
func (m *MCPAuthMiddleware) getBuiltinToolScopes(toolName string) []string {
	switch toolName {
	case "execute_graphql":
		return m.scopes.ExecuteGraphQL
	case "get_operation_info":
		return m.scopes.GetOperationInfo
	case "get_schema":
		return m.scopes.GetSchema
	default:
		return nil
	}
}

// SetScopeExtractor atomically replaces the scope extractor used for
// runtime scope checking of execute_graphql arbitrary operations.
// Called during Reload() after the schema is loaded.
func (m *MCPAuthMiddleware) SetScopeExtractor(extractor *ScopeExtractor) {
	m.scopeExtractorMu.Lock()
	defer m.scopeExtractorMu.Unlock()
	m.scopeExtractor = extractor
}

// getScopeExtractor returns the current scope extractor (thread-safe).
func (m *MCPAuthMiddleware) getScopeExtractor() *ScopeExtractor {
	m.scopeExtractorMu.RLock()
	defer m.scopeExtractorMu.RUnlock()
	return m.scopeExtractor
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
				Params struct {
					Name      string          `json:"name"`
					Arguments json.RawMessage `json:"arguments"`
				} `json:"params"`
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

				// Built-in tool scope check (additive to tools_call gate)
				if jsonRPCReq.Method == "tools/call" && jsonRPCReq.Params.Name != "" {
					if builtinScopes := m.getBuiltinToolScopes(jsonRPCReq.Params.Name); len(builtinScopes) > 0 {
						if err := m.validateScopesForRequest(claims, builtinScopes); err != nil {
							m.sendInsufficientScopeResponse(w, builtinScopes, claims, err)
							return
						}
					}
				}

				// Per-tool scope check for tools/call (additive to static tools_call gate)
				if jsonRPCReq.Method == "tools/call" && jsonRPCReq.Params.Name != "" {
					if toolOrScopes := m.getToolScopes(jsonRPCReq.Params.Name); len(toolOrScopes) > 0 {
						tokenScopes := extractScopes(claims)
						if !SatisfiesAnyGroup(tokenScopes, toolOrScopes) {
							challengeScopes := BestScopeChallengeWithExisting(tokenScopes, toolOrScopes, m.scopeChallengeIncludeTokenScopes)
							m.sendPerToolInsufficientScopeResponse(w, challengeScopes, jsonRPCReq.Params.Name)
							return
						}
					}

					// Runtime scope check for execute_graphql: parse the query from arguments
					// and extract @requiresScopes at the HTTP level (proper 403 + WWW-Authenticate)
					if jsonRPCReq.Params.Name == "execute_graphql" && len(jsonRPCReq.Params.Arguments) > 0 {
						if extractor := m.getScopeExtractor(); extractor != nil {
							if challengeScopes := m.checkExecuteGraphQLScopes(claims, jsonRPCReq.Params.Arguments, extractor); len(challengeScopes) > 0 {
								m.sendPerToolInsufficientScopeResponse(w, challengeScopes, "execute_graphql")
								return
							}
						}
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
// When scopeChallengeIncludeTokenScopes is false (default), only the scopes required for the
// operation are returned (RFC 6750 strict). When true, the token's existing scopes are unioned
// with the required scopes to work around client SDKs that replace rather than accumulate scopes.
func (m *MCPAuthMiddleware) sendInsufficientScopeResponse(w http.ResponseWriter, operationScopes []string, claims authentication.Claims, err error) {
	challengeScopes := operationScopes

	if m.scopeChallengeIncludeTokenScopes {
		// Union of token's existing scopes + operation's required scopes.
		// Existing scopes come first so the client retains them on re-auth.
		existing := extractScopes(claims)
		seen := make(map[string]struct{}, len(existing)+len(operationScopes))
		combined := make([]string, 0, len(existing)+len(operationScopes))
		for _, s := range existing {
			seen[s] = struct{}{}
			combined = append(combined, s)
		}
		for _, s := range operationScopes {
			if _, ok := seen[s]; !ok {
				seen[s] = struct{}{}
				combined = append(combined, s)
			}
		}
		challengeScopes = combined
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

// sendPerToolInsufficientScopeResponse sends a 403 response for per-tool scope failures.
// The challengeScopes have already been computed by BestScopeChallengeWithExisting.
func (m *MCPAuthMiddleware) sendPerToolInsufficientScopeResponse(w http.ResponseWriter, challengeScopes []string, toolName string) {
	scopeList := strings.Join(challengeScopes, " ")

	authHeader := fmt.Sprintf(`Bearer error="insufficient_scope", scope="%s"`, scopeList)

	if m.resourceMetadataURL != "" {
		authHeader += fmt.Sprintf(`, resource_metadata="%s"`, m.resourceMetadataURL)
	}

	authHeader += fmt.Sprintf(`, error_description="insufficient scopes for tool %s"`, toolName)

	w.Header().Set("WWW-Authenticate", authHeader)
	w.WriteHeader(http.StatusForbidden)
}

// checkExecuteGraphQLScopes parses the GraphQL query from execute_graphql arguments,
// extracts @requiresScopes requirements, and returns the challenge scopes if insufficient.
// Returns nil if scopes are satisfied or the query cannot be parsed.
func (m *MCPAuthMiddleware) checkExecuteGraphQLScopes(claims authentication.Claims, arguments json.RawMessage, extractor *ScopeExtractor) []string {
	var args struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal(arguments, &args); err != nil || args.Query == "" {
		return nil
	}

	opDoc, report := astparser.ParseGraphqlDocumentString(args.Query)
	if report.HasErrors() {
		return nil // let the tool handler deal with parse errors
	}

	fieldReqs := extractor.ExtractScopesForOperation(&opDoc)
	if len(fieldReqs) == 0 {
		return nil
	}

	combinedScopes := extractor.ComputeCombinedScopes(fieldReqs)
	if len(combinedScopes) == 0 {
		return nil
	}

	tokenScopes := extractScopes(claims)
	if SatisfiesAnyGroup(tokenScopes, combinedScopes) {
		return nil
	}

	return BestScopeChallengeWithExisting(tokenScopes, combinedScopes, m.scopeChallengeIncludeTokenScopes)
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
