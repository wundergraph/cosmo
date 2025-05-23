package expr

import (
	"github.com/stretchr/testify/require"
	"reflect"
	"testing"
)

func TestExpr(t *testing.T) {
	t.Parallel()

	t.Run("clone where context is not a ptr", func(t *testing.T) {
		t.Parallel()

		exprContext := Context{}
		clone := exprContext.Clone()

		require.False(t, &exprContext == clone)
	})

	t.Run("clone where context is a ptr", func(t *testing.T) {
		t.Parallel()

		exprContext := &Context{}
		ptrCopy := exprContext
		require.True(t, ptrCopy == exprContext)

		clone := exprContext.Clone()
		require.False(t, exprContext == clone)
	})

	t.Run("clone slices and maps", func(t *testing.T) {
		t.Parallel()

		claims := map[string]any{
			"key": "value",
		}
		strings := []string{"value"}

		exprContext := Context{
			Request: Request{
				Auth: RequestAuth{
					Claims: claims,
					Scopes: strings,
				},
			},
		}
		partialClone := exprContext
		require.True(t, reflect.ValueOf(exprContext.Request.Auth.Claims).Pointer() == reflect.ValueOf(partialClone.Request.Auth.Claims).Pointer())
		require.True(t, reflect.ValueOf(exprContext.Request.Auth.Scopes).Pointer() == reflect.ValueOf(partialClone.Request.Auth.Scopes).Pointer())
		require.True(t, reflect.ValueOf(exprContext.Request.URL.Query).Pointer() == reflect.ValueOf(partialClone.Request.URL.Query).Pointer())

		properClone := exprContext.Clone()
		require.False(t, reflect.ValueOf(exprContext.Request.Auth.Claims).Pointer() == reflect.ValueOf(properClone.Request.Auth.Claims).Pointer())
		require.False(t, reflect.ValueOf(exprContext.Request.Auth.Scopes).Pointer() == reflect.ValueOf(properClone.Request.Auth.Scopes).Pointer())
		require.False(t, reflect.ValueOf(exprContext.Request.URL.Query).Pointer() == reflect.ValueOf(properClone.Request.URL.Query).Pointer())
	})
}
