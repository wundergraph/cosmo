package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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
			middleware, err := NewMCPAuthMiddleware(tt.decoder, tt.enabled, "http://localhost:5025/.well-known/oauth-protected-resource", []string{"mcp:tools"})
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
			middleware, err := NewMCPAuthMiddleware(tt.decoder, tt.enabled, "http://localhost:5025/.well-known/oauth-protected-resource", []string{})
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

	middleware, err := NewMCPAuthMiddleware(decoder, true, "http://localhost:5025/.well-known/oauth-protected-resource", []string{})
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

	middleware, err := NewMCPAuthMiddleware(decoder, true, "http://localhost:5025/.well-known/oauth-protected-resource", []string{})
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

			middleware, err := NewMCPAuthMiddleware(decoder, true, "http://localhost:5025/.well-known/oauth-protected-resource", tt.requiredScopes)
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
