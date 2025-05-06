package core

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func expressionResolveContext(t *testing.T, header http.Header, claims map[string]any) *resolve.Context {
	req, err := http.NewRequest(http.MethodGet, "http://localhost:3002/graphql", nil)
	assert.NoError(t, err)
	if header != nil {
		req.Header = header
	}
	rcc := buildRequestContext(requestContextOptions{
		r: req,
	})
	ctx := withRequestContext(context.Background(), rcc)
	rc := &resolve.Context{
		RateLimitOptions: resolve.RateLimitOptions{
			RateLimitKey: "test",
		},
	}
	if claims != nil {
		rc = ContextWithClaims(rc, claims)
		rcc.expressionContext.Request.Auth = expr.LoadAuth(rc.Context())
	}
	return rc.WithContext(ctx)
}

func TestRateLimiterGenerateKey(t *testing.T) {
	t.Parallel()
	t.Run("default", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{})
		assert.NoError(t, err)
		key, err := rl.generateKey(expressionResolveContext(t, nil, nil))
		assert.NoError(t, err)
		assert.Equal(t, "test", key)
	})
	t.Run("from header", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.header.Get('Authorization')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		require.NoError(t, err)
		key, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"Authorization": []string{"token"}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
	})
	t.Run("from header number", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.header.Get('Authorization')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"Authorization": []string{"123"}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:123", key)
	})
	t.Run("from header whitespace", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "trim(request.header.Get('Authorization'))",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"Authorization": []string{"  token  "}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
	})
	t.Run("from claims", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, err := rl.generateKey(
			expressionResolveContext(t, nil, map[string]any{"sub": "token"}),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
	})
	t.Run("from claims invalid claim", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, err := rl.generateKey(
			expressionResolveContext(t, nil, map[string]any{"sub": 123}),
		)
		assert.Error(t, err)
		assert.Empty(t, key)
	})
	t.Run("from claims or X-Forwarded-For header claims present", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub ?? request.header.Get('X-Forwarded-For')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"X-Forwarded-For": []string{"192.168.0.1"}}, map[string]any{"sub": "token"}),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
	})
	t.Run("from claims or X-Forwarded-For header claims not present", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub ?? request.header.Get('X-Forwarded-For')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"X-Forwarded-For": []string{"192.168.0.1"}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:192.168.0.1", key)
	})
}

func ContextWithClaims(ctx *resolve.Context, claims map[string]any) *resolve.Context {
	auth := &FakeAuthenticator{
		claims: claims,
	}
	withScopes := authentication.NewContext(context.Background(), auth)
	return ctx.WithContext(withScopes)
}

type FakeAuthenticator struct {
	claims map[string]any
	scopes []string
}

func (f *FakeAuthenticator) Authenticator() string {
	return "fake"
}

func (f *FakeAuthenticator) Claims() authentication.Claims {
	return f.claims
}

func (f *FakeAuthenticator) SetScopes(scopes []string) {
	//TODO implement me
	panic("implement me")
}

func (f *FakeAuthenticator) Scopes() []string {
	return f.scopes
}
