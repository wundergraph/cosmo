package core

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/go-redis/redis_rate/v10"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
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
	t.Run("returns bare key when no suffix expression configured", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{})
		assert.NoError(t, err)
		key, suffix, err := rl.generateKey(expressionResolveContext(t, nil, nil))
		assert.NoError(t, err)
		assert.Equal(t, "test", key)
		assert.Equal(t, "test", suffix)
	})
	t.Run("returns prefixed key and suffix from header", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.header.Get('Authorization')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		require.NoError(t, err)
		key, suffix, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"Authorization": []string{"token"}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
		assert.Equal(t, "token", suffix)
	})
	t.Run("returns prefixed key and suffix from header number", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.header.Get('Authorization')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, suffix, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"Authorization": []string{"123"}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:123", key)
		assert.Equal(t, "123", suffix)
	})
	t.Run("trims whitespace from header suffix", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "trim(request.header.Get('Authorization'))",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, suffix, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"Authorization": []string{"  token  "}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
		assert.Equal(t, "token", suffix)
	})
	t.Run("returns prefixed key and suffix from claims", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, suffix, err := rl.generateKey(
			expressionResolveContext(t, nil, map[string]any{"sub": "token"}),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
		assert.Equal(t, "token", suffix)
	})
	t.Run("returns error for invalid claim type", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, suffix, err := rl.generateKey(
			expressionResolveContext(t, nil, map[string]any{"sub": 123}),
		)
		assert.Error(t, err)
		assert.Empty(t, key)
		assert.Empty(t, suffix)
	})
	t.Run("prefers claims over header when both present", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub ?? request.header.Get('X-Forwarded-For')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, suffix, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"X-Forwarded-For": []string{"192.168.0.1"}}, map[string]any{"sub": "token"}),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:token", key)
		assert.Equal(t, "token", suffix)
	})
	t.Run("falls back to header when claims not present", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.sub ?? request.header.Get('X-Forwarded-For')",
			ExprManager:         expr.CreateNewExprManager(),
		})
		assert.NoError(t, err)
		key, suffix, err := rl.generateKey(
			expressionResolveContext(t, http.Header{"X-Forwarded-For": []string{"192.168.0.1"}}, nil),
		)
		assert.NoError(t, err)
		assert.Equal(t, "test:192.168.0.1", key)
		assert.Equal(t, "192.168.0.1", suffix)
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

func TestRateLimiterResolveLimit(t *testing.T) {
	t.Parallel()

	defaultLimit := redis_rate.Limit{Rate: 10, Burst: 10, Period: time.Second}

	t.Run("returns default when no overrides configured", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{})
		require.NoError(t, err)

		got := rl.resolveLimit("any-key", defaultLimit)
		assert.Equal(t, defaultLimit, got)
	})

	t.Run("returns matching override limit for key", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			Overrides: []config.RateLimitOverride{
				{Matching: "^premium-.*", Rate: 100, Burst: 100, Period: time.Second},
				{Matching: "^internal-.*", Rate: 1000, Burst: 1000, Period: time.Second},
			},
		})
		require.NoError(t, err)

		got := rl.resolveLimit("premium-user-123", defaultLimit)
		assert.Equal(t, redis_rate.Limit{Rate: 100, Burst: 100, Period: time.Second}, got)

		got = rl.resolveLimit("internal-service", defaultLimit)
		assert.Equal(t, redis_rate.Limit{Rate: 1000, Burst: 1000, Period: time.Second}, got)
	})

	t.Run("returns default when no override matches", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			Overrides: []config.RateLimitOverride{
				{Matching: "^premium-.*", Rate: 100, Burst: 100, Period: time.Second},
			},
		})
		require.NoError(t, err)

		got := rl.resolveLimit("regular-user", defaultLimit)
		assert.Equal(t, defaultLimit, got)
	})

	t.Run("returns first match when multiple overrides match", func(t *testing.T) {
		t.Parallel()

		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			Overrides: []config.RateLimitOverride{
				{Matching: "^premium-.*", Rate: 100, Burst: 100, Period: time.Second},
				{Matching: "^premium-vip-.*", Rate: 500, Burst: 500, Period: time.Second},
			},
		})
		require.NoError(t, err)

		got := rl.resolveLimit("premium-vip-user", defaultLimit)
		assert.Equal(t, redis_rate.Limit{Rate: 100, Burst: 100, Period: time.Second}, got)
	})
}

func TestNewCosmoRateLimiter(t *testing.T) {
	t.Parallel()

	t.Run("returns error for invalid override pattern", func(t *testing.T) {
		t.Parallel()

		_, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			Overrides: []config.RateLimitOverride{
				{Matching: "[invalid", Rate: 10, Burst: 10, Period: time.Second},
			},
		})
		require.ErrorContains(t, err, "invalid regex '[invalid' for rate limit override")
	})
}
