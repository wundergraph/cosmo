package core

import (
	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/internal/expr"
)

func TestResponseCachePrivateIDResolve(t *testing.T) {
	t.Parallel()

	claims := func(sub any) expr.Context {
		return expr.Context{Request: expr.Request{Auth: expr.RequestAuth{Claims: map[string]any{"sub": sub}}}}
	}
	failing := func(t *testing.T) func(error) {
		return func(err error) { t.Errorf("unexpected error: %v", err) }
	}
	compile := func(t *testing.T, expression string) *responseCachePrivateID {
		t.Helper()
		p, err := newResponseCachePrivateID(expression, expr.CreateNewExprManager())
		require.NoError(t, err)
		return p
	}

	t.Run("nothing configured yields nothing", func(t *testing.T) {
		t.Parallel()
		p := compile(t, "")
		require.Nil(t, p)
		require.Empty(t, p.resolve(claims("u1"), failing(t)))
	})

	t.Run("a claim is the id", func(t *testing.T) {
		t.Parallel()
		require.Equal(t, "u1", compile(t, "request.auth.claims.sub").resolve(claims("u1"), failing(t)))
	})

	t.Run("a header is the id", func(t *testing.T) {
		t.Parallel()
		ctx := expr.Context{Request: expr.Request{Header: expr.Headers{Header: http.Header{"X-User-Id": []string{"h1"}}}}}
		require.Equal(t, "h1", compile(t, "request.header.Get('X-User-Id')").resolve(ctx, failing(t)))
	})

	t.Run("a nil claim is no id and not an error", func(t *testing.T) {
		t.Parallel()
		require.Empty(t, compile(t, "request.auth.claims.sub").resolve(expr.Context{}, failing(t)))
	})

	t.Run("a non string value is reported and no id", func(t *testing.T) {
		t.Parallel()
		var reported []error
		id := compile(t, "request.auth.claims.sub").resolve(claims(42), func(err error) { reported = append(reported, err) })
		require.Empty(t, id)
		require.Len(t, reported, 1)
		require.ErrorContains(t, reported[0], "expected string, got int")
	})
}

func TestNewResponseCachePrivateID(t *testing.T) {
	t.Parallel()

	t.Run("a bad expression is refused", func(t *testing.T) {
		t.Parallel()
		_, err := newResponseCachePrivateID("request.nope", expr.CreateNewExprManager())
		require.ErrorContains(t, err, "private_id")
	})

	t.Run("a non string expression is refused", func(t *testing.T) {
		t.Parallel()
		_, err := newResponseCachePrivateID("1 + 1", expr.CreateNewExprManager())
		require.ErrorContains(t, err, "expected string")
	})

	t.Run("an empty expression yields no resolver", func(t *testing.T) {
		t.Parallel()
		p, err := newResponseCachePrivateID("", expr.CreateNewExprManager())
		require.NoError(t, err)
		require.Nil(t, p)
	})

	t.Run("a valid expression passes", func(t *testing.T) {
		t.Parallel()
		p, err := newResponseCachePrivateID("request.auth.claims.sub", expr.CreateNewExprManager())
		require.NoError(t, err)
		require.NotNil(t, p)
	})
}

func TestHitDirectives(t *testing.T) {
	t.Parallel()

	hit := func(client, shared time.Duration, private, public, sharedOnly bool) string {
		_, header := createMostRestrictivePolicy([]*cachedirective.Object{{RespDirectives: hitDirectives(client, shared, private, public, sharedOnly)}})
		return header
	}
	require.Equal(t, "max-age=30, public", hit(30*time.Second, 30*time.Second, false, true, false))
	require.Equal(t, "max-age=30", hit(30*time.Second, 30*time.Second, false, false, false))
	require.Equal(t, "max-age=30, private", hit(30*time.Second, 30*time.Second, true, false, false))
	require.Equal(t, "max-age=30, s-maxage=600, public", hit(30*time.Second, 600*time.Second, false, true, false))
	require.Equal(t, "max-age=30, private", hit(30*time.Second, 600*time.Second, true, false, false), "s-maxage is for shared caches")
	require.Equal(t, "no-cache", hit(0, 600*time.Second, false, false, false))
	require.Equal(t, "no-cache, public", hit(0, 0, false, true, false))
	require.Equal(t, "no-cache, private", hit(0, 0, true, false, false))
	require.Equal(t, "s-maxage=60, public", hit(0, 60*time.Second, false, true, true), "shared only: no max-age")
	require.Equal(t, "s-maxage=60", hit(0, 60*time.Second, false, false, true))
	require.Equal(t, "no-cache", hit(0, 0, false, false, true))
	require.Equal(t, "max-age=60, s-maxage=5, public", hit(60*time.Second, 5*time.Second, false, true, false), "a shared-only entry's shorter life caps shared caches")
}
