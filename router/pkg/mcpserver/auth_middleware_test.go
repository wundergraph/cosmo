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
			name:    "valid decoder",
			decoder: validDecoder,
			wantErr: false,
		},
		{
			name:    "nil decoder",
			decoder: nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(tt.decoder, "http://localhost:5025/.well-known/oauth-protected-resource/mcp", config.MCPOAuthScopesConfiguration{}, false)
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
			name: "claims present",
			setupCtx: func() context.Context {
				return context.WithValue(context.Background(), userClaimsContextKey, expectedClaims)
			},
			wantOk:     true,
			wantClaims: expectedClaims,
		},
		{
			name: "claims absent",
			setupCtx: func() context.Context {
				return context.Background()
			},
			wantOk:     false,
			wantClaims: nil,
		},
		{
			name: "wrong type",
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
			name: "scope with multiple values",
			claims: authentication.Claims{
				"scope": "mcp:tools mcp:read mcp:write",
			},
			want: []string{"mcp:tools", "mcp:read", "mcp:write"},
		},
		{
			name: "scope with single value",
			claims: authentication.Claims{
				"scope": "mcp:tools",
			},
			want: []string{"mcp:tools"},
		},
		{
			name:   "no scope claim",
			claims: authentication.Claims{},
			want:   nil,
		},
		{
			name: "empty scope string",
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

func TestMCPAuthMiddleware_HTTPMiddleware(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "http://localhost:5025/.well-known/oauth-protected-resource/mcp"

	tests := []struct {
		name                      string
		scopes                    config.MCPOAuthScopesConfiguration
		setupDecoder              func() *mockTokenDecoder
		setupRequest              func() *http.Request
		wantStatusCode            int
		wantWWWAuthenticatePrefix string
	}{
		{
			name:   "valid token without scopes",
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
			name:   "missing auth header - 401 includes init scopes",
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
			name:   "missing auth header - 401 without scopes when none configured",
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
			name:   "invalid token - 401 includes init scopes",
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
			name:   "insufficient init scopes - 403 with include token scopes enabled",
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
			name: "valid token with all required scopes",
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

func TestMCPAuthMiddleware_PerToolScopes(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "http://localhost:5025/.well-known/oauth-protected-resource/mcp"

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
			name:           "unscoped tool passes with just static scopes",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_list_employees"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "scoped tool - token has matching scope (read:fact)",
			token:          "has-read-fact",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "scoped tool - token has matching scope (read:all)",
			token:          "has-read-all",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "scoped tool - token lacks scopes, challenge picks smallest group",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="read:fact"`,
			wantContains:   `error_description="insufficient scopes for tool execute_operation_get_top_secret_facts"`,
		},
		{
			name:                             "scoped tool - include token scopes in challenge",
			token:                            "no-scopes",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_top_secret_facts"}}`,
			scopeChallengeIncludeTokenScopes: true,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:connect mcp:tools:write read:fact"`,
		},
		{
			name:           "AND group - token has one of two required, challenge picks closest group",
			token:          "has-read-employee",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 403,
			// Group 1: ["read:employee", "read:private"] missing "read:private" (1 missing)
			// Group 2: ["read:all"] missing "read:all" (1 missing)
			// Tie → first group wins
			wantScope: `scope="read:employee read:private"`,
		},
		{
			name:           "AND group - token satisfies full AND group",
			token:          "has-read-employee-private",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "AND group - token has read:all satisfies second OR group",
			token:          "has-read-all",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "AND group - empty relevant scopes, challenge picks smallest group",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_operation_get_employee_start_date"}}`,
			wantStatusCode: 403,
			// Group 1: 2 missing, Group 2: 1 missing → Group 2 wins
			wantScope: `scope="read:all"`,
		},
		{
			name:           "tools/list is not affected by per-tool scopes",
			token:          "no-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			wantStatusCode: 200,
		},
		{
			name:           "unknown tool name passes (no per-tool scopes)",
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

func TestMCPAuthMiddleware_MethodLevelScopes(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "http://localhost:5025/.well-known/oauth-protected-resource/mcp"

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
			name:                             "tools/list with insufficient scopes - default returns operation scopes only",
			token:                            "connect-only",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:tools:read"`,
		},
		{
			name:                             "tools/list with insufficient scopes - include token scopes",
			token:                            "connect-only",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			scopeChallengeIncludeTokenScopes: true,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:connect mcp:tools:read"`,
		},
		{
			name:                             "tools/list with sufficient scopes succeeds",
			token:                            "connect-and-read",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   200,
		},
		{
			name:                             "tools/call with insufficient scopes - default returns operation scopes only",
			token:                            "connect-and-read",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:tools:write"`,
		},
		{
			name:                             "tools/call with insufficient scopes - include token scopes",
			token:                            "connect-and-read",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			scopeChallengeIncludeTokenScopes: true,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:connect mcp:tools:read mcp:tools:write"`,
		},
		{
			name:                             "tools/call with all scopes succeeds",
			token:                            "all-scopes",
			body:                             `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			scopeChallengeIncludeTokenScopes: false,
			wantStatusCode:                   200,
		},
		{
			name:                             "unknown method with no scope requirements succeeds",
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

func TestMCPAuthMiddleware_BuiltinToolScopes(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "http://localhost:5025/.well-known/oauth-protected-resource/mcp"

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
			name:           "execute_graphql without required scope returns 403",
			token:          "base-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:graphql:execute"`,
		},
		{
			name:           "execute_graphql with required scope passes",
			token:          "has-graphql-execute",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "get_schema without required scope returns 403",
			token:          "base-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_schema"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:schema:read"`,
		},
		{
			name:           "get_schema with required scope passes",
			token:          "has-schema-read",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_schema"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "get_operation_info without required scope returns 403",
			token:          "base-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_operation_info"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:ops:read"`,
		},
		{
			name:           "get_operation_info with required scope passes",
			token:          "has-ops-read",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_operation_info"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "non-builtin tool is not affected by builtin scopes",
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
