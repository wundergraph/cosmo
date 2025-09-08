package expr

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
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

	t.Run("clone with query", func(t *testing.T) {
		t.Parallel()

		exprContext := &Context{
			Request: Request{
				URL: RequestURL{
					Query: map[string]string{
						"key": "value",
					},
				},
			},
		}

		clone := exprContext.Clone()

		require.Equal(t, exprContext.Request.URL.Query, clone.Request.URL.Query)

		// Verify modifying clone doesn't affect original
		clone.Request.URL.Query["new"] = "value2"
		require.NotEqual(t, exprContext.Request.URL.Query, clone.Request.URL.Query)
	})

	t.Run("clone with empty maps and slices", func(t *testing.T) {
		t.Parallel()

		exprContext := &Context{
			Request: Request{
				Auth: RequestAuth{
					Claims: map[string]any{},
					Scopes: []string{},
				},
				URL: RequestURL{
					Query: map[string]string{},
				},
			},
		}

		clone := exprContext.Clone()

		require.NotNil(t, clone.Request.Auth.Claims)
		require.NotNil(t, clone.Request.Auth.Scopes)
		require.NotNil(t, clone.Request.URL.Query)
		require.Len(t, clone.Request.Auth.Claims, 0)
		require.Len(t, clone.Request.Auth.Scopes, 0)
		require.Len(t, clone.Request.URL.Query, 0)
	})

	t.Run("clone with nil maps and slices", func(t *testing.T) {
		t.Parallel()

		exprContext := &Context{
			Request: Request{
				Auth: RequestAuth{
					Claims: nil,
					Scopes: nil,
				},
				URL: RequestURL{
					Query: nil,
				},
			},
		}

		clone := exprContext.Clone()

		require.NotNil(t, clone.Request.Auth.Claims)
		require.NotNil(t, clone.Request.Auth.Scopes)
		require.NotNil(t, clone.Request.URL.Query)
		require.Len(t, clone.Request.Auth.Claims, 0)
		require.Len(t, clone.Request.Auth.Scopes, 0)
		require.Len(t, clone.Request.URL.Query, 0)
	})

	t.Run("verify claims and query values are copied correctly", func(t *testing.T) {
		t.Parallel()

		exprContext := &Context{
			Request: Request{
				Auth: RequestAuth{
					Claims: map[string]any{
						"string": "value",
						"number": 42,
						"bool":   true,
						"slice":  []string{"a", "b"},
						"map":    map[string]string{"key": "value"},
					},
				},
				URL: RequestURL{
					Query: map[string]string{
						"page":   "1",
						"limit":  "10",
						"filter": "active",
					},
				},
			},
		}

		clone := exprContext.Clone()

		// Verify claims are copied correctly
		require.Equal(t, "value", clone.Request.Auth.Claims["string"])
		require.Equal(t, 42, clone.Request.Auth.Claims["number"])
		require.Equal(t, true, clone.Request.Auth.Claims["bool"])
		require.Equal(t, []string{"a", "b"}, clone.Request.Auth.Claims["slice"])
		require.Equal(t, map[string]string{"key": "value"}, clone.Request.Auth.Claims["map"])

		// Verify query params are copied correctly
		require.Equal(t, "1", clone.Request.URL.Query["page"])
		require.Equal(t, "10", clone.Request.URL.Query["limit"])
		require.Equal(t, "active", clone.Request.URL.Query["filter"])

		// Verify nested structures in claims are also copied by reference (as that's the current behavior)
		sliceFromOriginal := exprContext.Request.Auth.Claims["slice"].([]string)
		sliceFromClone := clone.Request.Auth.Claims["slice"].([]string)
		require.Equal(t, reflect.ValueOf(sliceFromOriginal).Pointer(), reflect.ValueOf(sliceFromClone).Pointer())

		mapFromOriginal := exprContext.Request.Auth.Claims["map"].(map[string]string)
		mapFromClone := clone.Request.Auth.Claims["map"].(map[string]string)
		require.Equal(t, reflect.ValueOf(mapFromOriginal).Pointer(), reflect.ValueOf(mapFromClone).Pointer())
	})

	t.Run("verify modifying clone doesn't affect original", func(t *testing.T) {
		t.Parallel()

		exprContext := &Context{
			Request: Request{
				Auth: RequestAuth{
					Claims: map[string]any{"key": "value"},
					Scopes: []string{"scope1"},
				},
				URL: RequestURL{
					Query: map[string]string{"param": "value"},
				},
			},
		}

		clone := exprContext.Clone()

		// Modify clone
		clone.Request.Auth.Claims["newKey"] = "newValue"
		clone.Request.Auth.Scopes = append(clone.Request.Auth.Scopes, "scope2")
		clone.Request.URL.Query["newParam"] = "newValue"

		// Verify original is unchanged
		require.Len(t, exprContext.Request.Auth.Claims, 1)
		require.Equal(t, "value", exprContext.Request.Auth.Claims["key"])
		require.Len(t, exprContext.Request.Auth.Scopes, 1)
		require.Equal(t, "scope1", exprContext.Request.Auth.Scopes[0])
		require.Len(t, exprContext.Request.URL.Query, 1)
		require.Equal(t, "value", exprContext.Request.URL.Query["param"])
	})
}
