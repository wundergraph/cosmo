package core

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestPreHandlerInternalParseRequestOptions_RequireRequestTracingAuth(t *testing.T) {
	t.Parallel()

	t.Run("allows ART options when require_request_tracing_auth is false without dev mode or token", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:      true,
			developmentMode:          false,
			requireRequestTracingAuth: false,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(req, &ClientInfo{}, zap.NewNop())
		require.NoError(t, err)
		require.True(t, executionOptions.IncludeQueryPlanInResponse)
		require.True(t, traceOptions.Enable)
		require.True(t, traceOptions.ExcludeOutput)
	})

	t.Run("keeps ART options disabled when require_request_tracing_auth is true without dev mode or token", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:      true,
			developmentMode:          false,
			requireRequestTracingAuth: true,
			routerPublicKey:          nil,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(req, &ClientInfo{}, zap.NewNop())
		require.NoError(t, err)
		require.False(t, executionOptions.IncludeQueryPlanInResponse)
		require.False(t, traceOptions.Enable)
		require.True(t, traceOptions.ExcludeOutput)
	})
}
