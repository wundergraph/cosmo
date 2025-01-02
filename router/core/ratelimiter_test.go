package core

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestRateLimiterGenerateKey(t *testing.T) {
	t.Parallel()
	t.Run("default", func(t *testing.T) {
		t.Parallel()
		rl := NewCosmoRateLimiter(&CosmoRateLimiterOptions{})
		key := rl.generateKey(&resolve.Context{
			RateLimitOptions: resolve.RateLimitOptions{
				RateLimitKey: "test",
			},
		})
		assert.Equal(t, "test", key)
	})
	t.Run("from header", func(t *testing.T) {
		t.Parallel()
		rl := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixFromRequestHeader: true,
			RequestHeaderName:          "Authorization",
		})
		key := rl.generateKey(&resolve.Context{
			RateLimitOptions: resolve.RateLimitOptions{
				RateLimitKey: "test",
			},
			Request: resolve.Request{
				Header: map[string][]string{
					"Authorization": {"token"},
				},
			},
		})
		assert.Equal(t, "test:token", key)
	})
	t.Run("from header number", func(t *testing.T) {
		t.Parallel()
		rl := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixFromRequestHeader: true,
			RequestHeaderName:          "Authorization",
		})
		key := rl.generateKey(&resolve.Context{
			RateLimitOptions: resolve.RateLimitOptions{
				RateLimitKey: "test",
			},
			Request: resolve.Request{
				Header: map[string][]string{
					"Authorization": {"123"},
				},
			},
		})
		assert.Equal(t, "test:123", key)
	})
	t.Run("from header whitespace", func(t *testing.T) {
		t.Parallel()
		rl := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixFromRequestHeader: true,
			RequestHeaderName:          "Authorization",
		})
		key := rl.generateKey(&resolve.Context{
			RateLimitOptions: resolve.RateLimitOptions{
				RateLimitKey: "test",
			},
			Request: resolve.Request{
				Header: map[string][]string{
					"Authorization": {"  token  "},
				},
			},
		})
		assert.Equal(t, "test:token", key)
	})
	t.Run("from claims", func(t *testing.T) {
		t.Parallel()
		rl := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixFromClaim: true,
			ClaimName:          "sub",
		})
		ctx := ContextWithClaims(&resolve.Context{
			RateLimitOptions: resolve.RateLimitOptions{
				RateLimitKey: "test",
			},
		}, map[string]any{"sub": "token"})
		key := rl.generateKey(ctx)
		assert.Equal(t, "test:token", key)
	})
	t.Run("from claims invalid claim", func(t *testing.T) {
		t.Parallel()
		rl := NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			KeySuffixFromClaim: true,
			ClaimName:          "sub",
		})
		ctx := ContextWithClaims(&resolve.Context{
			RateLimitOptions: resolve.RateLimitOptions{
				RateLimitKey: "test",
			},
		}, map[string]any{"sub": 123})
		key := rl.generateKey(ctx)
		assert.Equal(t, "test", key)
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
}

func (f *FakeAuthenticator) Authenticator() string {
	//TODO implement me
	panic("implement me")
}

func (f *FakeAuthenticator) Claims() authentication.Claims {
	return f.claims
}

func (f *FakeAuthenticator) SetScopes(scopes []string) {
	//TODO implement me
	panic("implement me")
}

func (f *FakeAuthenticator) Scopes() []string {
	//TODO implement me
	panic("implement me")
}
