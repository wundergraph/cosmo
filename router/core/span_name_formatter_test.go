package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	rcontext "github.com/wundergraph/cosmo/router/internal/context"
)

func TestDefaultSpanNameFormatter(t *testing.T) {
	t.Parallel()

	t.Run("returns operation type and name when request context has operation", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		rc := buildRequestContext(requestContextOptions{r: req})
		rc.operation = &operationContext{
			name:   "GetUser",
			opType: OperationTypeQuery,
		}
		ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, rc)
		req = req.WithContext(ctx)

		assert.Equal(t, "query GetUser", DefaultSpanNameFormatter(req))
	})

	t.Run("returns operation type and unnamed when operation name is empty", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		rc := buildRequestContext(requestContextOptions{r: req})
		rc.operation = &operationContext{
			name:   "",
			opType: OperationTypeMutation,
		}
		ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, rc)
		req = req.WithContext(ctx)

		assert.Equal(t, "mutation unnamed", DefaultSpanNameFormatter(req))
	})

	t.Run("returns method and path when no request context", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodGet, "/health", nil)

		assert.Equal(t, "GET /health", DefaultSpanNameFormatter(req))
	})
}

func TestSpanNameFormatterProviderChain(t *testing.T) {
	t.Parallel()

	t.Run("composes wrappers in priority order with default at the bottom", func(t *testing.T) {
		t.Parallel()

		// Two synthetic wrappers prove the fold direction. The chain is
		// [outer, inner]; folding right-to-left wraps inner first, then
		// outer, so calling the composed formatter produces
		// "outer/inner/<default>".
		outer := func(next SpanNameFormatterFunc) SpanNameFormatterFunc {
			return func(r *http.Request) string {
				return "outer/" + next(r)
			}
		}
		inner := func(next SpanNameFormatterFunc) SpanNameFormatterFunc {
			return func(r *http.Request) string {
				return "inner/" + next(r)
			}
		}

		chain := []func(SpanNameFormatterFunc) SpanNameFormatterFunc{outer, inner}

		formatter := SpanNameFormatterFunc(DefaultSpanNameFormatter)
		for i := len(chain) - 1; i >= 0; i-- {
			formatter = chain[i](formatter)
		}

		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		assert.Equal(t, "outer/inner/GET /health", formatter(req))
	})

	t.Run("returns the default formatter when no wrappers are registered", func(t *testing.T) {
		t.Parallel()

		// Folding an empty chain must leave the default in place.
		chain := []func(SpanNameFormatterFunc) SpanNameFormatterFunc{}
		formatter := SpanNameFormatterFunc(DefaultSpanNameFormatter)
		for i := len(chain) - 1; i >= 0; i-- {
			formatter = chain[i](formatter)
		}

		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		rc := buildRequestContext(requestContextOptions{r: req})
		rc.operation = &operationContext{name: "Q", opType: OperationTypeQuery}
		ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, rc)
		req = req.WithContext(ctx)

		assert.Equal(t, "query Q", formatter(req))
	})
}

func TestGetSpanName(t *testing.T) {
	t.Parallel()

	t.Run("returns type and name when name is provided", func(t *testing.T) {
		t.Parallel()

		assert.Equal(t, "query MyQuery", GetSpanName("MyQuery", "query"))
	})

	t.Run("returns type and unnamed when name is empty", func(t *testing.T) {
		t.Parallel()

		assert.Equal(t, "subscription unnamed", GetSpanName("", "subscription"))
	})
}
