package mcpserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// mockTokenDecoder is a mock implementation of authentication.TokenDecoder for testing
type mockTokenDecoder struct {
	decodeFunc func(token string) (authentication.Claims, error)
}

func (m *mockTokenDecoder) Decode(token string) (authentication.Claims, error) {
	if m.decodeFunc != nil {
		return m.decodeFunc(token)
	}
	return nil, errors.New("decode not implemented")
}

func TestNewMCPAuthMiddleware(t *testing.T) {
	validDecoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			return authentication.Claims{"sub": "user123"}, nil
		},
	}

	tests := []struct {
		name    string
		decoder authentication.TokenDecoder
		wantErr bool
	}{
		{
			name:    "returns middleware when decoder is valid",
			decoder: validDecoder,
			wantErr: false,
		},
		{
			name:    "returns error when decoder is nil",
			decoder: nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(tt.decoder, "https://test.example/.well-known/oauth-protected-resource/mcp", config.MCPOAuthScopesConfiguration{}, false)
			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, middleware)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, middleware)
			}
		})
	}
}

func TestGetClaimsFromContext(t *testing.T) {
	expectedClaims := authentication.Claims{"sub": "user123", "email": "user@example.com"}

	tests := []struct {
		name       string
		setupCtx   func() context.Context
		wantOk     bool
		wantClaims authentication.Claims
	}{
		{
			name: "returns claims when present in context",
			setupCtx: func() context.Context {
				return context.WithValue(context.Background(), userClaimsContextKey, expectedClaims)
			},
			wantOk:     true,
			wantClaims: expectedClaims,
		},
		{
			name: "returns false when claims are absent from context",
			setupCtx: func() context.Context {
				return context.Background()
			},
			wantOk:     false,
			wantClaims: nil,
		},
		{
			name: "returns false when context value has wrong type",
			setupCtx: func() context.Context {
				return context.WithValue(context.Background(), userClaimsContextKey, "not-claims")
			},
			wantOk:     false,
			wantClaims: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims, ok := GetClaimsFromContext(tt.setupCtx())
			assert.Equal(t, tt.wantOk, ok)
			assert.Equal(t, tt.wantClaims, claims)
		})
	}
}

func TestExtractScopes(t *testing.T) {
	tests := []struct {
		name   string
		claims authentication.Claims
		want   []string
	}{
		{
			name: "splits scope claim into multiple values",
			claims: authentication.Claims{
				"scope": "mcp:tools mcp:read mcp:write",
			},
			want: []string{"mcp:tools", "mcp:read", "mcp:write"},
		},
		{
			name: "returns single value for single-scope claim",
			claims: authentication.Claims{
				"scope": "mcp:tools",
			},
			want: []string{"mcp:tools"},
		},
		{
			name:   "returns nil when scope claim is missing",
			claims: authentication.Claims{},
			want:   nil,
		},
		{
			name: "returns empty slice when scope claim is empty string",
			claims: authentication.Claims{
				"scope": "",
			},
			want: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractScopes(tt.claims)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestMCPAuthMiddlewareHTTP(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "https://test.example/.well-known/oauth-protected-resource/mcp"

	tests := []struct {
		name                      string
		scopes                    config.MCPOAuthScopesConfiguration
		setupDecoder              func() *mockTokenDecoder
		setupRequest              func() *http.Request
		wantStatusCode            int
		wantWWWAuthenticatePrefix string
	}{
		{
			name:   "allows request with valid token when no scopes are configured",
			scopes: config.MCPOAuthScopesConfiguration{},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						if token == "valid-token" {
							return authentication.Claims{"sub": "user123"}, nil
						}
						return nil, errors.New("invalid token")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest("POST", "/mcp", nil)
				req.Header.Set("Authorization", "Bearer valid-token")
				return req
			},
			wantStatusCode: 200,
		},
		{
			name:   "returns 401 with init scopes in challenge when auth header is missing",
			scopes: config.MCPOAuthScopesConfiguration{Initialize: []string{"mcp:connect"}},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						return nil, errors.New("missing authorization header")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest("POST", "/mcp", nil)
				return req
			},
			wantStatusCode:            401,
			wantWWWAuthenticatePrefix: `Bearer realm="mcp", scope="mcp:connect", resource_metadata="` + testMetadataURL + `"`,
		},
		{
			name:   "returns 401 without scope challenge when no scopes are configured",
			scopes: config.MCPOAuthScopesConfiguration{},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						return nil, errors.New("missing authorization header")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest("POST", "/mcp", nil)
				return req
			},
			wantStatusCode:            401,
			wantWWWAuthenticatePrefix: `Bearer realm="mcp", resource_metadata="` + testMetadataURL + `"`,
		},
		{
			name:   "returns 401 with init scopes in challenge when token is invalid",
			scopes: config.MCPOAuthScopesConfiguration{Initialize: []string{"mcp:connect"}},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						return nil, errors.New("token validation failed")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest("POST", "/mcp", nil)
				req.Header.Set("Authorization", "Bearer invalid-token")
				return req
			},
			wantStatusCode:            401,
			wantWWWAuthenticatePrefix: `Bearer realm="mcp", scope="mcp:connect", resource_metadata="` + testMetadataURL + `"`,
		},
		{
			name:   "returns 403 with token scopes in challenge when init scopes are insufficient",
			scopes: config.MCPOAuthScopesConfiguration{Initialize: []string{"mcp:connect"}},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						if token == "valid-token" {
							return authentication.Claims{
								"sub":   "user123",
								"scope": "mcp:tools:read",
							}, nil
						}
						return nil, errors.New("invalid token")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest("POST", "/mcp", nil)
				req.Header.Set("Authorization", "Bearer valid-token")
				return req
			},
			wantStatusCode:            403,
			wantWWWAuthenticatePrefix: `Bearer error="insufficient_scope", scope="mcp:tools:read mcp:connect"`,
		},
		{
			name: "allows request when token has all required scopes",
			scopes: config.MCPOAuthScopesConfiguration{
				Initialize: []string{"mcp:connect"},
			},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						if token == "valid-token" {
							return authentication.Claims{
								"sub":   "user123",
								"scope": "mcp:connect mcp:tools:read mcp:tools:write",
							}, nil
						}
						return nil, errors.New("invalid token")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest("POST", "/mcp", nil)
				req.Header.Set("Authorization", "Bearer valid-token")
				return req
			},
			wantStatusCode: 200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decoder := tt.setupDecoder()
			middleware, err := NewMCPAuthMiddleware(decoder, testMetadataURL, tt.scopes, true)
			assert.NoError(t, err)

			handler := middleware.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(200)
			}))

			req := tt.setupRequest()
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			assert.Equal(t, tt.wantStatusCode, rr.Code)
			if tt.wantWWWAuthenticatePrefix != "" {
				wwwAuth := rr.Header().Get("WWW-Authenticate")
				assert.Contains(t, wwwAuth, tt.wantWWWAuthenticatePrefix)
			}
		})
	}
}

func TestMCPAuthMiddlewarePerToolScopes(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "https://test.example/.well-known/oauth-protected-resource/mcp"

	validDecoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			switch token {
			case "no-scopes":
				return authentication.Claims{"sub": "user1", "scope": "mcp:connect mcp:tools:write"}, nil
			case "has-read-fact":
				return authentication.Claims{"sub": "user2", "scope": "mcp:connect mcp:tools:write read:fact"}, nil
			case "has-read-all":
				return authentication.Claims{"sub": "user3", "scope": "mcp:connect mcp:tools:write read:all"}, nil
			case "has-read-employee":
				return authentication.Claims{"sub": "user4", "scope": "mcp:connect mcp:tools:write read:employee"}, nil
			case "has-read-employee-private":
				return authentication.Claims{"sub": "user5", "scope": "mcp:connect mcp:tools:write read:employee read:private"}, nil
			default:
				return nil, errors.New("invalid token")
			}
		},
	}

	scopes := config.MCPOAuthScopesConfiguration{
		Initialize: []string{"mcp:connect"},
		ToolsCall:  []string{"mcp:tools:write"},
	}

	// Tool scopes simulating @requiresScopes extraction
	toolScopes := map[string][][]string{
		"execute_operation_get_top_secret_facts": {
			{"read:fact"},
			{"read:all"},
		},
		"execute_operation_get_employee_start_date": {
			{"read:employee", "read:private"},
			{"read:all"},
		},
		// execute_operation_list_employees has no scopes (not in map)
	}

	tests := []struct {
		name                             string
		token                            string
		body                             string
		scopeChallengeIncludeTokenScopes bool
		wantStatusCode                   int
		wantScope                        string
		wantContains                     string // additional WWW-Authenticate check
	}{
		{
			name:           "allows tool call when tool has no per-tool scopes configured",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_list_employees"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "allows tool call when token has required per-tool scope",
			token:          "has-read-fact",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "allows tool call when token has alternative per-tool scope",
			token:          "has-read-all",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "returns 403 with smallest group as challenge when token lacks per-tool scopes",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="read:fact"`,
			wantContains:   `error_description="insufficient scopes for tool execute_operation_get_top_secret_facts"`,
		},
		{
			name:                             "includes token scopes in per-tool challenge when configured",
			token:                            "no-scopes",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			scopeChallengeIncludeTokenScopes: true,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:connect mcp:tools:write read:fact"`,
		},
		{
			name:           "returns 403 with closest group as challenge when token has only one scope from an AND group",
			token:          "has-read-employee",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 403,
			// Group 1: ["read:employee", "read:private"] missing "read:private" (1 missing)
			// Group 2: ["read:all"] missing "read:all" (1 missing)
			// Tie → first group wins
			wantScope: `scope="read:employee read:private"`,
		},
		{
			name:           "allows tool call when token satisfies full AND group",
			token:          "has-read-employee-private",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "allows tool call when token has scope from alternative OR group",
			token:          "has-read-all",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "returns 403 with smallest group as challenge when token has no relevant scopes",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 403,
			// Group 1: 2 missing, Group 2: 1 missing → Group 2 wins
			wantScope: `scope="read:all"`,
		},
		{
			name:           "allows tools/list regardless of per-tool scopes",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			wantStatusCode: 200,
		},
		{
			name:           "allows tool call when tool name has no per-tool scopes configured",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"unknown_tool"}}`,
			wantStatusCode: 200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(validDecoder, testMetadataURL, scopes, tt.scopeChallengeIncludeTokenScopes)
			assert.NoError(t, err)

			// Set per-tool scopes
			middleware.SetToolScopes(toolScopes)

			handler := middleware.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(200)
			}))

			req, _ := http.NewRequest("POST", "/mcp", strings.NewReader(tt.body))
			req.Header.Set("Authorization", "Bearer "+tt.token)
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			assert.Equal(t, tt.wantStatusCode, rr.Code)
			if tt.wantScope != "" {
				wwwAuth := rr.Header().Get("WWW-Authenticate")
				assert.Contains(t, wwwAuth, tt.wantScope, "WWW-Authenticate header should contain expected scope")
			}
			if tt.wantContains != "" {
				wwwAuth := rr.Header().Get("WWW-Authenticate")
				assert.Contains(t, wwwAuth, tt.wantContains, "WWW-Authenticate header should contain expected string")
			}
		})
	}
}

func TestMCPAuthMiddlewareMethodLevelScopes(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "https://test.example/.well-known/oauth-protected-resource/mcp"

	validDecoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			if token == "connect-only" {
				return authentication.Claims{
					"sub":   "user123",
					"scope": "mcp:connect",
				}, nil
			}
			if token == "connect-and-read" {
				return authentication.Claims{
					"sub":   "user123",
					"scope": "mcp:connect mcp:tools:read",
				}, nil
			}
			if token == "all-scopes" {
				return authentication.Claims{
					"sub":   "user123",
					"scope": "mcp:connect mcp:tools:read mcp:tools:write",
				}, nil
			}
			return nil, errors.New("invalid token")
		},
	}

	scopes := config.MCPOAuthScopesConfiguration{
		Initialize: []string{"mcp:connect"},
		ToolsList:  []string{"mcp:tools:read"},
		ToolsCall:  []string{"mcp:tools:write"},
	}

	tests := []struct {
		name                             string
		token                            string
		body                             string
		scopeChallengeIncludeTokenScopes bool
		wantStatusCode                   int
		wantScope                        string // expected scope value in WWW-Authenticate, empty if not checked
	}{
		{
			name:                             "returns 403 with only operation scopes when tools/list lacks required scopes",
			token:                            "connect-only",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:tools:read"`,
		},
		{
			name:                             "returns 403 with token and operation scopes when tools/list lacks required scopes and include token scopes is enabled",
			token:                            "connect-only",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			scopeChallengeIncludeTokenScopes: true,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:connect mcp:tools:read"`,
		},
		{
			name:                             "allows tools/list when token has required scopes",
			token:                            "connect-and-read",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   200,
		},
		{
			name:                             "returns 403 with only operation scopes when tools/call lacks required scopes",
			token:                            "connect-and-read",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:tools:write"`,
		},
		{
			name:                             "returns 403 with token and operation scopes when tools/call lacks required scopes and include token scopes is enabled",
			token:                            "connect-and-read",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			scopeChallengeIncludeTokenScopes: true,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:connect mcp:tools:read mcp:tools:write"`,
		},
		{
			name:                             "allows tools/call when token has all required scopes",
			token:                            "all-scopes",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   200,
		},
		{
			name:                             "allows unknown method when no scope requirements are configured",
			token:                            "connect-only",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"ping"}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(validDecoder, testMetadataURL, scopes, tt.scopeChallengeIncludeTokenScopes)
			assert.NoError(t, err)

			handler := middleware.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(200)
			}))

			req, _ := http.NewRequest("POST", "/mcp", strings.NewReader(tt.body))
			req.Header.Set("Authorization", "Bearer "+tt.token)
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			assert.Equal(t, tt.wantStatusCode, rr.Code)
			if tt.wantScope != "" {
				wwwAuth := rr.Header().Get("WWW-Authenticate")
				assert.Contains(t, wwwAuth, tt.wantScope)
			}
		})
	}
}

func TestMCPAuthMiddlewareBuiltinToolScopes(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "https://test.example/.well-known/oauth-protected-resource/mcp"

	validDecoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			switch token {
			case "base-only":
				return authentication.Claims{"sub": "user1", "scope": "mcp:connect mcp:tools:call"}, nil
			case "has-schema-read":
				return authentication.Claims{"sub": "user2", "scope": "mcp:connect mcp:tools:call mcp:schema:read"}, nil
			case "has-graphql-execute":
				return authentication.Claims{"sub": "user3", "scope": "mcp:connect mcp:tools:call mcp:graphql:execute"}, nil
			case "has-ops-read":
				return authentication.Claims{"sub": "user4", "scope": "mcp:connect mcp:tools:call mcp:ops:read"}, nil
			default:
				return nil, errors.New("invalid token")
			}
		},
	}

	scopes := config.MCPOAuthScopesConfiguration{
		Initialize:       []string{"mcp:connect"},
		ToolsCall:        []string{"mcp:tools:call"},
		ExecuteGraphQL:   []string{"mcp:graphql:execute"},
		GetOperationInfo: []string{"mcp:ops:read"},
		GetSchema:        []string{"mcp:schema:read"},
	}

	tests := []struct {
		name           string
		token          string
		body           string
		wantStatusCode int
		wantScope      string
	}{
		{
			name:           "returns 403 when execute_graphql lacks required builtin scope",
			token:          "base-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:graphql:execute"`,
		},
		{
			name:           "allows execute_graphql when token has required builtin scope",
			token:          "has-graphql-execute",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "returns 403 when get_schema lacks required builtin scope",
			token:          "base-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_schema"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:schema:read"`,
		},
		{
			name:           "allows get_schema when token has required builtin scope",
			token:          "has-schema-read",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_schema"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "returns 403 when get_operation_info lacks required builtin scope",
			token:          "base-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_operation_info"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:ops:read"`,
		},
		{
			name:           "allows get_operation_info when token has required builtin scope",
			token:          "has-ops-read",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_operation_info"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "allows non-builtin tool regardless of builtin scopes",
			token:          "base-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_users"}}`,
			wantStatusCode: 200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(validDecoder, testMetadataURL, scopes, false)
			assert.NoError(t, err)

			handler := middleware.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(200)
			}))

			req, _ := http.NewRequest("POST", "/mcp", strings.NewReader(tt.body))
			req.Header.Set("Authorization", "Bearer "+tt.token)
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			assert.Equal(t, tt.wantStatusCode, rr.Code)
			if tt.wantScope != "" {
				wwwAuth := rr.Header().Get("WWW-Authenticate")
				assert.Contains(t, wwwAuth, tt.wantScope, "WWW-Authenticate header should contain expected scope")
			}
		})
	}
}
