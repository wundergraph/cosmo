package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

type contextKey string

const (
	userClaimsContextKey contextKey = "mcp_user_claims"
	// maxBodyBytes prevents memory exhaustion from oversized payloads.
	maxBodyBytes int64 = 10 << 20 // 10 MB
)

// mcpAuthProvider adapts MCP headers to the authentication.Provider interface
type mcpAuthProvider struct {
	headers http.Header
}

func (p *mcpAuthProvider) AuthenticationHeaders() http.Header {
	return p.headers
}

// MCPAuthMiddleware provides HTTP-level authentication and scope enforcement for MCP.
type MCPAuthMiddleware struct {
	authenticator                    authentication.Authenticator
	resourceMetadataURL              string
	scopes                           config.MCPOAuthScopesConfiguration
	scopeChallengeIncludeTokenScopes bool
	toolScopesMu                     sync.RWMutex
	toolScopes                       map[string][][]string // toolName → OR-of-AND scope groups
	scopeExtractorMu                 sync.RWMutex
	scopeExtractor                   *ScopeExtractor
}

// NewMCPAuthMiddleware creates a new authentication middleware.
func NewMCPAuthMiddleware(tokenDecoder authentication.TokenDecoder, resourceMetadataURL string, scopes config.MCPOAuthScopesConfiguration, scopeChallengeIncludeTokenScopes bool) (*MCPAuthMiddleware, error) {
	if tokenDecoder == nil {
		return nil, fmt.Errorf("token decoder must be provided")
	}

	authenticator, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name:         "mcp-auth",
		TokenDecoder: tokenDecoder,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create authenticator: %w", err)
	}

	return &MCPAuthMiddleware{
		authenticator:                    authenticator,
		resourceMetadataURL:              resourceMetadataURL,
		scopes:                           scopes,
		scopeChallengeIncludeTokenScopes: scopeChallengeIncludeTokenScopes,
	}, nil
}

// SetToolScopes atomically replaces the per-tool scope map.
func (m *MCPAuthMiddleware) SetToolScopes(scopes map[string][][]string) {
	m.toolScopesMu.Lock()
	defer m.toolScopesMu.Unlock()
	m.toolScopes = scopes
}

func (m *MCPAuthMiddleware) getToolScopes(toolName string) [][]string {
	m.toolScopesMu.RLock()
	defer m.toolScopesMu.RUnlock()
	if m.toolScopes == nil {
		return nil
	}
	return m.toolScopes[toolName]
}

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
func (m *MCPAuthMiddleware) SetScopeExtractor(extractor *ScopeExtractor) {
	m.scopeExtractorMu.Lock()
	defer m.scopeExtractorMu.Unlock()
	m.scopeExtractor = extractor
}

func (m *MCPAuthMiddleware) getScopeExtractor() *ScopeExtractor {
	m.scopeExtractorMu.RLock()
	defer m.scopeExtractorMu.RUnlock()
	return m.scopeExtractor
}

// HTTPMiddleware wraps HTTP handlers with authentication for ALL MCP operations.
// Per MCP spec: "authorization MUST be included in every HTTP request from client to server"
func (m *MCPAuthMiddleware) HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provider := &mcpAuthProvider{headers: r.Header}

		claims, err := m.authenticator.Authenticate(r.Context(), provider)
		if err != nil || len(claims) == 0 {
			m.sendUnauthorizedResponse(w, err)
			return
		}

		// Extract token scopes once for all checks in this request
		tokenScopes := extractScopes(claims)
		tokenScopeSet := toSet(tokenScopes)

		if len(m.scopes.Initialize) > 0 {
			if missing := findMissing(tokenScopeSet, m.scopes.Initialize); len(missing) > 0 {
				m.sendInsufficientScopeResponse(w, m.scopes.Initialize, tokenScopes, missing)
				return
			}
		}

		// Parse JSON-RPC body for method-level scope checks (SSE/GET requests have no body)
		var body []byte
		if r.Method == http.MethodPost && r.Body != nil {
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
			r.Body = io.NopCloser(bytes.NewBuffer(body))
		}

		if len(body) > 0 {
			var jsonRPCReq struct {
				Method string `json:"method"`
				Params struct {
					Name      string          `json:"name"`
					Arguments json.RawMessage `json:"arguments"`
				} `json:"params"`
			}
			if err := json.Unmarshal(body, &jsonRPCReq); err == nil && jsonRPCReq.Method != "" {
				// Method-level scope check
				var methodScopes []string
				switch jsonRPCReq.Method {
				case "tools/list":
					methodScopes = m.scopes.ToolsList
				case "tools/call":
					methodScopes = m.scopes.ToolsCall
				}
				if len(methodScopes) > 0 {
					if missing := findMissing(tokenScopeSet, methodScopes); len(missing) > 0 {
						m.sendInsufficientScopeResponse(w, methodScopes, tokenScopes, missing)
						return
					}
				}

				if jsonRPCReq.Method == "tools/call" && jsonRPCReq.Params.Name != "" {
					toolName := jsonRPCReq.Params.Name

					// Built-in tool scope check (additive to tools_call gate)
					if builtinScopes := m.getBuiltinToolScopes(toolName); len(builtinScopes) > 0 {
						if missing := findMissing(tokenScopeSet, builtinScopes); len(missing) > 0 {
							m.sendInsufficientScopeResponse(w, builtinScopes, tokenScopes, missing)
							return
						}
					}

					// Per-tool scope check from @requiresScopes directives
					if toolOrScopes := m.getToolScopes(toolName); len(toolOrScopes) > 0 {
						if !SatisfiesAnyGroup(tokenScopeSet, toolOrScopes) {
							challengeScopes := BestScopeChallengeWithExisting(tokenScopes, toolOrScopes, m.scopeChallengeIncludeTokenScopes)
							m.sendPerToolInsufficientScopeResponse(w, challengeScopes, toolName)
							return
						}
					}

					// Runtime scope check for execute_graphql: parse the query and
					// extract @requiresScopes at the HTTP level (proper 403 + WWW-Authenticate)
					if toolName == "execute_graphql" && len(jsonRPCReq.Params.Arguments) > 0 {
						if extractor := m.getScopeExtractor(); extractor != nil {
							if challengeScopes := m.checkExecuteGraphQLScopes(tokenScopes, tokenScopeSet, jsonRPCReq.Params.Arguments, extractor); len(challengeScopes) > 0 {
								m.sendPerToolInsufficientScopeResponse(w, challengeScopes, "execute_graphql")
								return
							}
						}
					}
				}
			}
		}

		ctx := context.WithValue(r.Context(), userClaimsContextKey, claims)
		ctx = requestHeadersFromRequest(ctx, r)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// sendUnauthorizedResponse sends a 401 with WWW-Authenticate per RFC 6750 and RFC 9728.
func (m *MCPAuthMiddleware) sendUnauthorizedResponse(w http.ResponseWriter, err error) {
	authHeader := `Bearer realm="mcp"`

	if len(m.scopes.Initialize) > 0 {
		authHeader += fmt.Sprintf(`, scope="%s"`, strings.Join(m.scopes.Initialize, " "))
	}
	if m.resourceMetadataURL != "" {
		authHeader += fmt.Sprintf(`, resource_metadata="%s"`, m.resourceMetadataURL)
	}
	if err != nil {
		desc := strings.ReplaceAll(err.Error(), `"`, `'`)
		authHeader += fmt.Sprintf(`, error_description="%s"`, desc)
	}

	w.Header().Set("WWW-Authenticate", authHeader)
	w.WriteHeader(http.StatusUnauthorized)
}

// sendInsufficientScopeResponse sends a 403 per RFC 6750 Section 3.1.
// When scopeChallengeIncludeTokenScopes is true, the challenge includes the token's
// existing scopes to work around client SDKs that replace rather than accumulate scopes.
func (m *MCPAuthMiddleware) sendInsufficientScopeResponse(w http.ResponseWriter, operationScopes []string, tokenScopes []string, missingScopes []string) {
	challengeScopes := operationScopes
	if m.scopeChallengeIncludeTokenScopes {
		challengeScopes = mergeAndDedup(tokenScopes, operationScopes)
	}

	desc := strings.ReplaceAll(fmt.Sprintf("missing required scopes: %s", strings.Join(missingScopes, ", ")), `"`, `'`)
	m.writeScopeChallenge(w, challengeScopes, desc)
}

// sendPerToolInsufficientScopeResponse sends a 403 for per-tool scope failures.
func (m *MCPAuthMiddleware) sendPerToolInsufficientScopeResponse(w http.ResponseWriter, challengeScopes []string, toolName string) {
	sanitizedName := strings.ReplaceAll(toolName, `"`, `'`)
	m.writeScopeChallenge(w, challengeScopes, fmt.Sprintf("insufficient scopes for tool %s", sanitizedName))
}

// writeScopeChallenge writes a 403 with a WWW-Authenticate Bearer challenge.
func (m *MCPAuthMiddleware) writeScopeChallenge(w http.ResponseWriter, scopes []string, errorDescription string) {
	authHeader := fmt.Sprintf(`Bearer error="insufficient_scope", scope="%s"`, strings.Join(scopes, " "))
	if m.resourceMetadataURL != "" {
		authHeader += fmt.Sprintf(`, resource_metadata="%s"`, m.resourceMetadataURL)
	}
	authHeader += fmt.Sprintf(`, error_description="%s"`, errorDescription)

	w.Header().Set("WWW-Authenticate", authHeader)
	w.WriteHeader(http.StatusForbidden)
}

// checkExecuteGraphQLScopes parses the GraphQL query from execute_graphql arguments,
// extracts @requiresScopes requirements, and returns the challenge scopes if insufficient.
func (m *MCPAuthMiddleware) checkExecuteGraphQLScopes(tokenScopes []string, tokenScopeSet map[string]struct{}, arguments json.RawMessage, extractor *ScopeExtractor) []string {
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

	if SatisfiesAnyGroup(tokenScopeSet, combinedScopes) {
		return nil
	}

	return BestScopeChallengeWithExisting(tokenScopes, combinedScopes, m.scopeChallengeIncludeTokenScopes)
}

// findMissing returns scopes from required that are not in tokenSet.
func findMissing(tokenSet map[string]struct{}, required []string) []string {
	var missing []string
	for _, s := range required {
		if _, ok := tokenSet[s]; !ok {
			missing = append(missing, s)
		}
	}
	return missing
}

// extractScopes extracts space-separated scope values from the OAuth 2.0 "scope" claim.
func extractScopes(claims authentication.Claims) []string {
	scopeClaim, ok := claims["scope"]
	if !ok {
		return nil
	}
	scopeStr, ok := scopeClaim.(string)
	if !ok {
		return nil
	}
	return strings.Fields(scopeStr)
}

// GetClaimsFromContext retrieves authenticated user claims from context.
func GetClaimsFromContext(ctx context.Context) (authentication.Claims, bool) {
	claims, ok := ctx.Value(userClaimsContextKey).(authentication.Claims)
	return claims, ok
}
