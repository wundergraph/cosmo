package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	rcontext "github.com/wundergraph/cosmo/router/internal/context"
)

func TestSpanNameFormatter_DefaultBehavior(t *testing.T) {
	t.Parallel()

	t.Run("returns operation type and name when request context has operation", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		rc := buildRequestContext(requestContextOptions{r: req})
		rc.operation = &operationContext{
			name:   "GetUser",
			opType: "query",
		}
		ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, rc)
		req = req.WithContext(ctx)

		result := SpanNameFormatter("", req)
		assert.Equal(t, "query GetUser", result)
	})

	t.Run("returns operation type and unnamed when operation name is empty", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		rc := buildRequestContext(requestContextOptions{r: req})
		rc.operation = &operationContext{
			name:   "",
			opType: "mutation",
		}
		ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, rc)
		req = req.WithContext(ctx)

		result := SpanNameFormatter("", req)
		assert.Equal(t, "mutation unnamed", result)
	})

	t.Run("returns method and path when no request context", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest(http.MethodGet, "/health", nil)

		result := SpanNameFormatter("", req)
		assert.Equal(t, "GET /health", result)
	})
}

func TestSpanNameFormatter_Configurable(t *testing.T) {
	// Not parallel: mutates the package-level SpanNameFormatter variable
	original := SpanNameFormatter
	t.Cleanup(func() {
		SpanNameFormatter = original
	})

	SpanNameFormatter = func(_ string, r *http.Request) string {
		return "custom: " + original("", r)
	}

	req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	rc := buildRequestContext(requestContextOptions{r: req})
	rc.operation = &operationContext{
		name:   "GetUser",
		opType: "query",
	}
	ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, rc)
	req = req.WithContext(ctx)

	result := SpanNameFormatter("", req)
	assert.Equal(t, "custom: query GetUser", result)
}

func TestGetSpanName(t *testing.T) {
	t.Parallel()

	t.Run("returns type and name when name is provided", func(t *testing.T) {
		t.Parallel()

		result := GetSpanName("MyQuery", "query")
		assert.Equal(t, "query MyQuery", result)
	})

	t.Run("returns type and unnamed when name is empty", func(t *testing.T) {
		t.Parallel()

		result := GetSpanName("", "subscription")
		assert.Equal(t, "subscription unnamed", result)
	})
}
