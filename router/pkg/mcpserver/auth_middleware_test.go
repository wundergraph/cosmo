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
		enabled bool
		wantErr bool
	}{
		{
			name:    "valid decoder and enabled",
			decoder: validDecoder,
			enabled: true,
			wantErr: false,
		},
		{
			name:    "valid decoder and disabled",
			decoder: validDecoder,
			enabled: false,
			wantErr: false,
		},
		{
			name:    "nil decoder",
			decoder: nil,
			enabled: true,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(tt.decoder, tt.enabled, "http://localhost:5025/.well-known/oauth-protected-resource/mcp", map[string][]string{})
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
			want:   []string{},
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
		scopesRequired            map[string][]string
		setupDecoder              func() *mockTokenDecoder
		setupRequest              func() *http.Request
		wantStatusCode            int
		wantWWWAuthenticatePrefix string
	}{
		{
			name:           "valid token without scopes",
			scopesRequired: map[string][]string{},
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
			name:           "missing auth header - 401 includes init scopes",
			scopesRequired: map[string][]string{"initialize": {"mcp:connect"}},
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
			name:           "missing auth header - 401 without scopes when none configured",
			scopesRequired: map[string][]string{},
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
			name:           "invalid token - 401 includes init scopes",
			scopesRequired: map[string][]string{"initialize": {"mcp:connect"}},
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
			name: "insufficient init scopes - 403 includes cumulative scopes",
			scopesRequired: map[string][]string{
				"initialize": {"mcp:connect"},
			},
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
			wantWWWAuthenticatePrefix: `Bearer error="insufficient_scope", scope="mcp:connect"`,
		},
		{
			name: "valid token with all required scopes",
			scopesRequired: map[string][]string{
				"initialize": {"mcp:connect"},
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
			middleware, err := NewMCPAuthMiddleware(decoder, true, testMetadataURL, tt.scopesRequired)
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

	scopesRequired := map[string][]string{
		"initialize":                  {"mcp:connect"},
		"tools/list":                  {"mcp:tools:read"},
		"tools/call/execute_graphql":  {"mcp:tools:write"},
	}

	tests := []struct {
		name           string
		token          string
		body           string
		wantStatusCode int
		wantScope      string // expected scope value in WWW-Authenticate, empty if not checked
	}{
		{
			name:           "tools/list with insufficient scopes returns 403 with operation scopes only",
			token:          "connect-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:tools:read"`,
		},
		{
			name:           "tools/list with sufficient scopes succeeds",
			token:          "connect-and-read",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
			wantStatusCode: 200,
		},
		{
			name:           "tools/call with per-tool scope check returns 403 with operation scopes only",
			token:          "connect-and-read",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			wantStatusCode: 403,
			wantScope:      `scope="mcp:tools:write"`,
		},
		{
			name:           "tools/call with all scopes succeeds",
			token:          "all-scopes",
			body:           `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql"}}`,
			wantStatusCode: 200,
		},
		{
			name:           "unknown method with no scope requirements succeeds",
			token:          "connect-only",
			body:           `{"jsonrpc":"2.0","id":1,"method":"ping"}`,
			wantStatusCode: 200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(validDecoder, true, testMetadataURL, scopesRequired)
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

