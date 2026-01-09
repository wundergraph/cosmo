package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

const (
	testMetadataURL = "http://localhost:5025/.well-known/oauth-protected-resource"
)

// parseWWWAuthenticateParams parses key-value pairs from a WWW-Authenticate Bearer header.
// This is a simple parser for test validation only, not production use.
//
// NOTE: LLM-generated - there are no well-established Go libraries for parsing
// WWW-Authenticate response headers (to-date). This parser handles the
// common case of Bearer authentication with quoted parameter values.
func parseWWWAuthenticateParams(header string) map[string]string {
	params := make(map[string]string)

	// Remove "Bearer " prefix
	header = strings.TrimPrefix(header, "Bearer ")
	header = strings.TrimSpace(header)

	// Simple state machine to parse key="value" pairs
	var key, value strings.Builder
	inKey := true
	inQuote := false

	for i := 0; i < len(header); i++ {
		ch := header[i]

		switch {
		case ch == '=' && inKey:
			inKey = false
		case ch == '"' && !inKey:
			// Track quote state but don't add quotes to value
			inQuote = !inQuote
		case ch == ',' && !inQuote:
			if key.Len() > 0 {
				params[strings.TrimSpace(key.String())] = strings.TrimSpace(value.String())
			}
			key.Reset()
			value.Reset()
			inKey = true
		case inKey:
			key.WriteByte(ch)
		default:
			// We're in a value (!inKey) and ch is not a quote (already handled above)
			// Include everything (including spaces) when inside quotes
			if inQuote || ch != ' ' || value.Len() > 0 {
				value.WriteByte(ch)
			}
		}
	}

	// Add final pair
	if key.Len() > 0 {
		params[strings.TrimSpace(key.String())] = strings.TrimSpace(value.String())
	}

	return params
}

// mockTokenDecoder is a mock implementation of authentication.TokenDecoder for testing
type mockTokenDecoder struct {
	decodeFunc func(token string) (authentication.Claims, error)
}

func (m *mockTokenDecoder) Decode(token string) (authentication.Claims, error) {
	if m.decodeFunc != nil {
		return m.decodeFunc(token)
	}
	return nil, errors.New("not implemented")
}

// getTextFromResult extracts text from the first content item in a result
func getTextFromResult(result *mcp.CallToolResult) string {
	if result == nil || len(result.Content) == 0 {
		return ""
	}
	textContent, ok := mcp.AsTextContent(result.Content[0])
	if !ok {
		return ""
	}
	return textContent.Text
}

func TestNewMCPAuthMiddleware(t *testing.T) {
	validDecoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			return authentication.Claims{"sub": "user123"}, nil
		},
	}

	tests := []struct {
		name        string
		decoder     authentication.TokenDecoder
		enabled     bool
		wantErr     bool
		errContains string
	}{
		{
			name:    "valid decoder enabled",
			decoder: validDecoder,
			enabled: true,
			wantErr: false,
		},
		{
			name:    "valid decoder disabled",
			decoder: validDecoder,
			enabled: false,
			wantErr: false,
		},
		{
			name:        "nil decoder",
			decoder:     nil,
			enabled:     true,
			wantErr:     true,
			errContains: "token decoder must be provided",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(tt.decoder, tt.enabled, testMetadataURL, []string{"mcp:tools"})
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, middleware)
			} else {
				require.NoError(t, err)
				require.NotNil(t, middleware)
				assert.Equal(t, tt.enabled, middleware.enabled)
				assert.NotNil(t, middleware.authenticator)
			}
		})
	}
}

func TestMCPAuthMiddleware_ToolMiddleware(t *testing.T) {
	validClaims := authentication.Claims{"sub": "user123", "email": "user@example.com"}

	tests := []struct {
		name            string
		enabled         bool
		decoder         *mockTokenDecoder
		setupHeaders    func() http.Header
		wantErr         bool
		wantTextContain string
	}{
		{
			name:    "bypasses auth when disabled",
			enabled: false,
			decoder: &mockTokenDecoder{
				decodeFunc: func(token string) (authentication.Claims, error) {
					t.Fatal("should not be called")
					return nil, nil
				},
			},
			setupHeaders: func() http.Header {
				return http.Header{}
			},
			wantErr:         false,
			wantTextContain: "no authentication",
		},
		{
			name:    "valid Bearer token",
			enabled: true,
			decoder: &mockTokenDecoder{
				decodeFunc: func(token string) (authentication.Claims, error) {
					if token == "valid-token" {
						return validClaims, nil
					}
					return nil, errors.New("invalid token")
				},
			},
			setupHeaders: func() http.Header {
				h := http.Header{}
				h.Set("Authorization", "Bearer valid-token")
				return h
			},
			wantErr:         false,
			wantTextContain: "authenticated with claims",
		},
		{
			name:    "invalid token",
			enabled: true,
			decoder: &mockTokenDecoder{
				decodeFunc: func(token string) (authentication.Claims, error) {
					return nil, errors.New("token validation failed")
				},
			},
			setupHeaders: func() http.Header {
				h := http.Header{}
				h.Set("Authorization", "Bearer invalid-token")
				return h
			},
			wantErr:         true,
			wantTextContain: "Authentication required",
		},
		{
			name:    "wrong header format",
			enabled: true,
			decoder: &mockTokenDecoder{
				decodeFunc: func(token string) (authentication.Claims, error) {
					return validClaims, nil
				},
			},
			setupHeaders: func() http.Header {
				h := http.Header{}
				h.Set("Authorization", "invalid-token")
				return h
			},
			wantErr:         true,
			wantTextContain: "Authentication required",
		},
		{
			name:    "Bearer token with whitespace",
			enabled: true,
			decoder: &mockTokenDecoder{
				decodeFunc: func(token string) (authentication.Claims, error) {
					if token == "valid-token" {
						return validClaims, nil
					}
					return nil, fmt.Errorf("unexpected token: %s", token)
				},
			},
			setupHeaders: func() http.Header {
				h := http.Header{}
				h.Set("Authorization", "Bearer  valid-token  ")
				return h
			},
			wantErr:         false,
			wantTextContain: "authenticated with claims",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(tt.decoder, tt.enabled, testMetadataURL, []string{})
			require.NoError(t, err)

			handler := middleware.ToolMiddleware(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				claims, ok := GetClaimsFromContext(ctx)
				if ok {
					return mcp.NewToolResultText(fmt.Sprintf("authenticated with claims: %v", claims)), nil
				}
				return mcp.NewToolResultText("no authentication"), nil
			})

			ctx := withRequestHeaders(context.Background(), tt.setupHeaders())
			result, err := handler(ctx, mcp.CallToolRequest{})

			require.NoError(t, err)
			assert.Equal(t, tt.wantErr, result.IsError)
			assert.Contains(t, getTextFromResult(result), tt.wantTextContain)
		})
	}
}

func TestMCPAuthMiddleware_MissingHeaders(t *testing.T) {
	decoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			return authentication.Claims{"sub": "user123"}, nil
		},
	}

	middleware, err := NewMCPAuthMiddleware(decoder, true, testMetadataURL, []string{})
	require.NoError(t, err)

	handler := middleware.ToolMiddleware(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return mcp.NewToolResultText("success"), nil
	})

	// Context without headers
	result, err := handler(context.Background(), mcp.CallToolRequest{})
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, getTextFromResult(result), "missing request headers")
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

func TestMCPAuthProvider(t *testing.T) {
	t.Run("returns headers", func(t *testing.T) {
		headers := http.Header{}
		headers.Set("Authorization", "Bearer token")
		headers.Set("X-Custom", "value")

		provider := &mcpAuthProvider{headers: headers}
		assert.Equal(t, headers, provider.AuthenticationHeaders())
	})

	t.Run("empty headers", func(t *testing.T) {
		provider := &mcpAuthProvider{headers: http.Header{}}
		assert.Equal(t, 0, len(provider.AuthenticationHeaders()))
	})
}

func TestMCPAuthMiddleware_Integration(t *testing.T) {
	expectedClaims := authentication.Claims{"sub": "user123", "role": "admin"}

	decoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			if token == "valid-token" {
				return expectedClaims, nil
			}
			return nil, errors.New("invalid token")
		},
	}

	middleware, err := NewMCPAuthMiddleware(decoder, true, testMetadataURL, []string{})
	require.NoError(t, err)

	handler := middleware.ToolMiddleware(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		claims, ok := GetClaimsFromContext(ctx)
		if !ok {
			return mcp.NewToolResultError("no claims found"), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("user: %s, role: %s", claims["sub"], claims["role"])), nil
	})

	// Valid token
	headers := http.Header{}
	headers.Set("Authorization", "Bearer valid-token")
	ctx := withRequestHeaders(context.Background(), headers)

	result, err := handler(ctx, mcp.CallToolRequest{})
	require.NoError(t, err)
	assert.False(t, result.IsError)
	text := getTextFromResult(result)
	assert.Contains(t, text, "user: user123")
	assert.Contains(t, text, "role: admin")

	// Invalid token
	headers.Set("Authorization", "Bearer invalid-token")
	ctx = withRequestHeaders(context.Background(), headers)

	result, err = handler(ctx, mcp.CallToolRequest{})
	require.NoError(t, err)
	assert.True(t, result.IsError)
	assert.Contains(t, getTextFromResult(result), "Authentication required")
}

func TestMCPAuthMiddleware_ScopeValidation(t *testing.T) {
	tests := []struct {
		name            string
		requiredScopes  []string
		tokenScopes     string
		wantErr         bool
		wantTextContain string
	}{
		{
			name:            "no required scopes, token with no scopes",
			requiredScopes:  []string{},
			tokenScopes:     "",
			wantErr:         false,
			wantTextContain: "authenticated with claims",
		},
		{
			name:            "no required scopes, token with scopes",
			requiredScopes:  []string{},
			tokenScopes:     "some:scope another:scope",
			wantErr:         false,
			wantTextContain: "authenticated with claims",
		},
		{
			name:            "one required scope, token with no scopes",
			requiredScopes:  []string{"mcp:tools"},
			tokenScopes:     "",
			wantErr:         true,
			wantTextContain: "missing required scopes: mcp:tools",
		},
		{
			name:            "one required scope, token has required scope",
			requiredScopes:  []string{"mcp:tools"},
			tokenScopes:     "mcp:tools",
			wantErr:         false,
			wantTextContain: "authenticated with claims",
		},
		{
			name:            "one required scope, token missing required scope",
			requiredScopes:  []string{"mcp:tools"},
			tokenScopes:     "mcp:read",
			wantErr:         true,
			wantTextContain: "missing required scopes: mcp:tools",
		},
		{
			name:            "multiple required scopes, token with no scopes",
			requiredScopes:  []string{"mcp:tools", "mcp:read"},
			tokenScopes:     "",
			wantErr:         true,
			wantTextContain: "missing required scopes: mcp:tools, mcp:read",
		},
		{
			name:            "multiple required scopes, token with partial match",
			requiredScopes:  []string{"mcp:tools", "mcp:read"},
			tokenScopes:     "mcp:tools",
			wantErr:         true,
			wantTextContain: "missing required scopes: mcp:read",
		},
		{
			name:            "multiple required scopes, token has all required scopes",
			requiredScopes:  []string{"mcp:tools", "mcp:read"},
			tokenScopes:     "mcp:tools mcp:read",
			wantErr:         false,
			wantTextContain: "authenticated with claims",
		},
		{
			name:            "multiple required scopes, token with partial match (multiple missing)",
			requiredScopes:  []string{"mcp:tools", "mcp:read", "mcp:admin"},
			tokenScopes:     "mcp:tools mcp:write",
			wantErr:         true,
			wantTextContain: "missing required scopes: mcp:read, mcp:admin",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decoder := &mockTokenDecoder{
				decodeFunc: func(token string) (authentication.Claims, error) {
					if token == "valid-token" {
						claims := authentication.Claims{
							"sub":   "user123",
							"email": "user@example.com",
						}
						if tt.tokenScopes != "" {
							claims["scope"] = tt.tokenScopes
						}
						return claims, nil
					}
					return nil, errors.New("invalid token")
				},
			}

			middleware, err := NewMCPAuthMiddleware(decoder, true, testMetadataURL, tt.requiredScopes)
			require.NoError(t, err)

			handler := middleware.ToolMiddleware(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				claims, ok := GetClaimsFromContext(ctx)
				if ok {
					return mcp.NewToolResultText(fmt.Sprintf("authenticated with claims: %v", claims)), nil
				}
				return mcp.NewToolResultText("no authentication"), nil
			})

			headers := http.Header{}
			headers.Set("Authorization", "Bearer valid-token")
			ctx := withRequestHeaders(context.Background(), headers)

			result, err := handler(ctx, mcp.CallToolRequest{})
			require.NoError(t, err)
			assert.Equal(t, tt.wantErr, result.IsError)
			assert.Contains(t, getTextFromResult(result), tt.wantTextContain)
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
			name: "scope as space-separated string (OAuth 2.0 standard)",
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
			name: "scope with extra whitespace",
			claims: authentication.Claims{
				"scope": "  mcp:tools   mcp:read  mcp:write  ",
			},
			want: []string{"mcp:tools", "mcp:read", "mcp:write"},
		},
		{
			name: "scope with tabs and newlines",
			claims: authentication.Claims{
				"scope": "mcp:tools\t\nmcp:read\n\tmcp:write",
			},
			want: []string{"mcp:tools", "mcp:read", "mcp:write"},
		},
		{
			name: "scope with multiple spaces between values",
			claims: authentication.Claims{
				"scope": "mcp:tools  mcp:read   mcp:write",
			},
			want: []string{"mcp:tools", "mcp:read", "mcp:write"},
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
		{
			name: "scope with only whitespace",
			claims: authentication.Claims{
				"scope": "   \t\n   ",
			},
			want: []string{},
		},
		{
			name: "scope claim with wrong type (number)",
			claims: authentication.Claims{
				"scope": 123,
			},
			want: []string{},
		},
		{
			name: "scope claim with wrong type (array)",
			claims: authentication.Claims{
				"scope": []string{"mcp:tools", "mcp:read"},
			},
			want: []string{},
		},
		{
			name: "scope claim with wrong type (object)",
			claims: authentication.Claims{
				"scope": map[string]string{"key": "value"},
			},
			want: []string{},
		},
		{
			name:   "nil claims",
			claims: nil,
			want:   []string{},
		},
		{
			name: "complex scopes with colons",
			claims: authentication.Claims{
				"scope": "mcp:tools:read mcp:tools:write api:v1:access",
			},
			want: []string{"mcp:tools:read", "mcp:tools:write", "api:v1:access"},
		},
		{
			name: "scopes with URLs",
			claims: authentication.Claims{
				"scope": "https://api.example.com/read https://api.example.com/write",
			},
			want: []string{"https://api.example.com/read", "https://api.example.com/write"},
		},
		{
			name: "scopes with special characters",
			claims: authentication.Claims{
				"scope": "read:users write:users delete:users",
			},
			want: []string{"read:users", "write:users", "delete:users"},
		},
		{
			name: "other claims present but no scope",
			claims: authentication.Claims{
				"sub":   "user123",
				"email": "user@example.com",
				"aud":   "https://api.example.com",
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

	tests := []struct {
		name                      string
		requiredScopes            []string
		setupDecoder              func() *mockTokenDecoder
		setupRequest              func() *http.Request
		wantStatusCode            int
		wantWWWAuthenticate       string
		wantWWWAuthenticatePrefix string
		wantBody                  string
	}{
		{
			name:           "valid token without scopes",
			requiredScopes: []string{},
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
				req, _ := http.NewRequest(http.MethodPost, "/mcp", nil)
				req.Header.Set("Authorization", "Bearer valid-token")
				return req
			},
			wantStatusCode: http.StatusOK,
		},
		{
			name:           "missing authorization header",
			requiredScopes: []string{},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						return nil, errors.New("missing authorization header")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest(http.MethodPost, "/mcp", nil)
				return req
			},
			wantStatusCode:            http.StatusUnauthorized,
			wantWWWAuthenticatePrefix: `Bearer realm="mcp", resource_metadata="` + testMetadataURL + `"`,
			wantBody:                  "", // No JSON-RPC body per MCP spec
		},
		{
			name:           "invalid token",
			requiredScopes: []string{},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						return nil, errors.New("token validation failed")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest(http.MethodPost, "/mcp", nil)
				req.Header.Set("Authorization", "Bearer invalid-token")
				return req
			},
			wantStatusCode:            http.StatusUnauthorized,
			wantWWWAuthenticatePrefix: `Bearer realm="mcp", resource_metadata="` + testMetadataURL + `"`,
			wantBody:                  "", // No JSON-RPC body per MCP spec
		},
		{
			name:           "valid token but insufficient scopes",
			requiredScopes: []string{"mcp:tools:write", "mcp:admin"},
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
				req, _ := http.NewRequest(http.MethodPost, "/mcp", nil)
				req.Header.Set("Authorization", "Bearer valid-token")
				return req
			},
			wantStatusCode:            http.StatusForbidden,
			wantWWWAuthenticatePrefix: `Bearer error="insufficient_scope", scope="mcp:tools:write mcp:admin", resource_metadata="` + testMetadataURL + `"`,
			wantBody:                  "", // No JSON-RPC body per MCP spec
		},
		{
			name:           "valid token with all required scopes",
			requiredScopes: []string{"mcp:tools:read", "mcp:tools:write"},
			setupDecoder: func() *mockTokenDecoder {
				return &mockTokenDecoder{
					decodeFunc: func(token string) (authentication.Claims, error) {
						if token == "valid-token" {
							return authentication.Claims{
								"sub":   "user123",
								"scope": "mcp:tools:read mcp:tools:write mcp:admin",
							}, nil
						}
						return nil, errors.New("invalid token")
					},
				}
			},
			setupRequest: func() *http.Request {
				req, _ := http.NewRequest(http.MethodPost, "/mcp", nil)
				req.Header.Set("Authorization", "Bearer valid-token")
				return req
			},
			wantStatusCode: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(tt.setupDecoder(), true, testMetadataURL, tt.requiredScopes)
			require.NoError(t, err)

			// Create a test handler that sets status 200 if reached
			testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			// Wrap with auth middleware
			handler := middleware.HTTPMiddleware(testHandler)

			// Create response recorder
			rr := httptest.NewRecorder()

			// Execute request
			handler.ServeHTTP(rr, tt.setupRequest())

			// Verify status code
			assert.Equal(t, tt.wantStatusCode, rr.Code, "status code mismatch")

			// Verify WWW-Authenticate header for auth failures
			if tt.wantWWWAuthenticatePrefix != "" {
				authHeader := rr.Header().Get("WWW-Authenticate")
				assert.NotEmpty(t, authHeader, "WWW-Authenticate header should be present")
				assert.Contains(t, authHeader, tt.wantWWWAuthenticatePrefix, "WWW-Authenticate header should match expected format")

				// Verify resource_metadata is present (per MCP spec)
				assert.Contains(t, authHeader, "resource_metadata=", "resource_metadata should be in WWW-Authenticate header")
			}

			// Verify no JSON-RPC response body for HTTP-level auth failures
			if tt.wantStatusCode == http.StatusUnauthorized || tt.wantStatusCode == http.StatusForbidden {
				body := rr.Body.String()
				assert.Equal(t, "", body, "HTTP-level auth failures should not return JSON-RPC response body per MCP spec")
			}
		})
	}
}

func TestMCPAuthMiddleware_HTTPMiddleware_WWWAuthenticateFormat(t *testing.T) {
	t.Parallel()

	t.Run("401 response has correct WWW-Authenticate format", func(t *testing.T) {
		decoder := &mockTokenDecoder{
			decodeFunc: func(token string) (authentication.Claims, error) {
				return nil, errors.New("invalid token")
			},
		}

		middleware, err := NewMCPAuthMiddleware(decoder, true, testMetadataURL, []string{})
		require.NoError(t, err)

		testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		handler := middleware.HTTPMiddleware(testHandler)

		req, _ := http.NewRequest(http.MethodPost, "/mcp", nil)
		req.Header.Set("Authorization", "Bearer invalid-token")

		rr := httptest.NewRecorder()

		handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)

		// Parse WWW-Authenticate header properly
		authHeader := rr.Header().Get("WWW-Authenticate")
		require.NotEmpty(t, authHeader, "WWW-Authenticate header must be present")

		params := parseWWWAuthenticateParams(authHeader)

		// Verify expected fields per RFC 6750
		assert.Equal(t, "mcp", params["realm"], "realm should be 'mcp'")
		assert.Equal(t, testMetadataURL, params["resource_metadata"], "resource_metadata must be present for OAuth discovery")
		assert.NotEmpty(t, params["error_description"], "error_description should provide details")
	})

	t.Run("403 response has correct WWW-Authenticate format per RFC 6750", func(t *testing.T) {
		decoder := &mockTokenDecoder{
			decodeFunc: func(token string) (authentication.Claims, error) {
				return authentication.Claims{
					"sub":   "user123",
					"scope": "mcp:read",
				}, nil
			},
		}

		requiredScopes := []string{"mcp:tools:write", "mcp:admin"}
		middleware, err := NewMCPAuthMiddleware(decoder, true, testMetadataURL, requiredScopes)
		require.NoError(t, err)

		testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		handler := middleware.HTTPMiddleware(testHandler)

		req, _ := http.NewRequest(http.MethodPost, "/mcp", nil)
		req.Header.Set("Authorization", "Bearer valid-token")

		rr := httptest.NewRecorder()

		handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusForbidden, rr.Code)

		// Parse WWW-Authenticate header properly
		authHeader := rr.Header().Get("WWW-Authenticate")
		require.NotEmpty(t, authHeader, "WWW-Authenticate header must be present")

		params := parseWWWAuthenticateParams(authHeader)

		// Per RFC 6750 Section 3.1: Verify all required fields
		assert.Equal(t, "insufficient_scope", params["error"], "error parameter must be 'insufficient_scope'")
		assert.Equal(t, "mcp:tools:write mcp:admin", params["scope"], "scope parameter must list required scopes")
		assert.Equal(t, testMetadataURL, params["resource_metadata"], "resource_metadata must be present")
		assert.NotEmpty(t, params["error_description"], "error_description should provide details")
	})
}
