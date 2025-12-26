package core

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"
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
		key, suffix, err := rl.generateKey(expressionResolveContext(t, nil, nil))
		assert.NoError(t, err)
		assert.Equal(t, "test", key)
		assert.Equal(t, "", suffix)
	})

	t.Run("from header", func(t *testing.T) {
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

	t.Run("from header number", func(t *testing.T) {
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

	t.Run("from header whitespace", func(t *testing.T) {
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

	t.Run("from claims", func(t *testing.T) {
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

	t.Run("from claims invalid claim", func(t *testing.T) {
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

	t.Run("from claims or X-Forwarded-For header claims present", func(t *testing.T) {
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

	t.Run("from claims or X-Forwarded-For header claims not present", func(t *testing.T) {
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

func TestRateLimiterOverrides(t *testing.T) {
	t.Parallel()

	baseCtx := func(header http.Header) *resolve.Context {
		ctx := expressionResolveContext(t, header, nil)
		ctx.RateLimitOptions.RateLimitKey = "cosmo_rate_limit"
		ctx.RateLimitOptions.Rate = 100
		ctx.RateLimitOptions.Burst = 50
		ctx.RateLimitOptions.Period = 2 * time.Second
		return ctx
	}

	info := &resolve.FetchInfo{RootFields: []resolve.GraphCoordinate{{TypeName: "Query", FieldName: "product"}}}

	t.Run("uses override when key matches", func(t *testing.T) {
		t.Parallel()
		overrideLimit := RateLimitOverride{Rate: 5, Burst: 10, Period: time.Second}
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.header.Get('Authorization')",
			ExprManager:         expr.CreateNewExprManager(),
			Overrides: map[string]RateLimitOverride{
				"cosmo_rate_limit:planA": overrideLimit,
			},
		})
		require.NoError(t, err)

		fake := &fakeLimiter{result: &redis_rate.Result{Allowed: 1, Remaining: 9}}
		rl.limiter = fake

		_, err = rl.RateLimitPreFetch(baseCtx(http.Header{"Authorization": []string{"planA"}}), info, nil)
		require.NoError(t, err)

		expected := redis_rate.Limit{Rate: overrideLimit.Rate, Burst: overrideLimit.Burst, Period: overrideLimit.Period}
		assert.Equal(t, "cosmo_rate_limit:planA", fake.lastKey)
		assert.Equal(t, expected, fake.lastLimit)
	})

	t.Run("falls back to default when key missing", func(t *testing.T) {
		t.Parallel()
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.header.Get('Authorization')",
			ExprManager:         expr.CreateNewExprManager(),
			Overrides: map[string]RateLimitOverride{
				"planA": {Rate: 5, Burst: 10, Period: time.Second},
			},
		})
		require.NoError(t, err)

		fake := &fakeLimiter{result: &redis_rate.Result{Allowed: 1, Remaining: 9}}
		rl.limiter = fake

		ctx := baseCtx(http.Header{"Authorization": []string{"unknown"}})
		_, err = rl.RateLimitPreFetch(ctx, info, nil)
		require.NoError(t, err)

		expected := redis_rate.Limit{Rate: ctx.RateLimitOptions.Rate, Burst: ctx.RateLimitOptions.Burst, Period: ctx.RateLimitOptions.Period}
		assert.Equal(t, "cosmo_rate_limit:unknown", fake.lastKey)
		assert.Equal(t, expected, fake.lastLimit)
	})

	t.Run("uses client_id claim for suffix", func(t *testing.T) {
		t.Parallel()
		overrideLimit := RateLimitOverride{Rate: 1000, Burst: 1000, Period: time.Second}
		rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixExpression: "request.auth.claims.client_id",
			ExprManager:         expr.CreateNewExprManager(),
			Overrides: map[string]RateLimitOverride{
				"cosmo_rate_limit:id_my_client": overrideLimit,
			},
		})
		require.NoError(t, err)

		ctx := expressionResolveContext(t, nil, map[string]any{"client_id": "id_my_client"})
		ctx.RateLimitOptions.RateLimitKey = "cosmo_rate_limit"
		ctx.RateLimitOptions.Rate = 100
		ctx.RateLimitOptions.Burst = 100
		ctx.RateLimitOptions.Period = time.Second

		fake := &fakeLimiter{result: &redis_rate.Result{Allowed: 1, Remaining: 999}}
		rl.limiter = fake

		_, err = rl.RateLimitPreFetch(ctx, info, nil)
		require.NoError(t, err)

		expected := redis_rate.Limit{Rate: overrideLimit.Rate, Burst: overrideLimit.Burst, Period: overrideLimit.Period}
		assert.Equal(t, "cosmo_rate_limit:id_my_client", fake.lastKey)
		assert.Equal(t, expected, fake.lastLimit)
	})
}

func TestRateLimiterOverrideEndToEnd(t *testing.T) {
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = client.Close()
	})

	rl, err := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
		RedisClient:         client,
		KeySuffixExpression: "request.auth.claims.client_id",
		ExprManager:         expr.CreateNewExprManager(),
		Overrides: map[string]RateLimitOverride{
			"cosmo_rate_limit:id_my_client": {Rate: 1, Burst: 1, Period: time.Second},
		},
	})
	require.NoError(t, err)

	ctx := expressionResolveContext(t, nil, map[string]any{"client_id": "id_my_client"})
	ctx.RateLimitOptions.RateLimitKey = "cosmo_rate_limit"
	ctx.RateLimitOptions.Rate = 5
	ctx.RateLimitOptions.Burst = 5
	ctx.RateLimitOptions.Period = time.Second

	info := &resolve.FetchInfo{RootFields: []resolve.GraphCoordinate{{TypeName: "Query", FieldName: "product"}}}

	result, err := rl.RateLimitPreFetch(ctx, info, nil)
	require.NoError(t, err)
	assert.Nil(t, result)

	result, err = rl.RateLimitPreFetch(ctx, info, nil)
	require.NoError(t, err)
	assert.NotNil(t, result)
}

type fakeLimiter struct {
	lastKey         string
	lastLimit       redis_rate.Limit
	lastRequestRate int
	result          *redis_rate.Result
	err             error
}

func (f *fakeLimiter) AllowN(ctx context.Context, key string, limit redis_rate.Limit, n int) (*redis_rate.Result, error) {
	f.lastKey = key
	f.lastLimit = limit
	f.lastRequestRate = n
	return f.result, f.err
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
