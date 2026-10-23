package expr

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAccessLogFilter(t *testing.T) {
	t.Parallel()
	for _, expression := range []string{"true", "false", "log.status >= 500", "request.url.method == 'POST'", "rand() >= 0 && rand() < 1"} {
		t.Run(expression, func(t *testing.T) {
			manager := CreateNewExprManager()
			program, err := manager.CompileAccessLogFilter(expression)
			require.NoError(t, err)
			result, err := ResolveAccessLogFilter(program, AccessLogContext{
				Context: Context{Request: Request{URL: RequestURL{Method: "POST"}}},
				Log:     map[string]any{"status": 500},
			})
			require.NoError(t, err)
			require.Equal(t, expression != "false", result)
		})
	}
	for _, expression := range []string{"1", "'true'", "nil", "request.nonexistent", "true &&", "rand(1)"} {
		t.Run("invalid/"+expression, func(t *testing.T) {
			_, err := CreateNewExprManager().CompileAccessLogFilter(expression)
			require.Error(t, err)
		})
	}
	t.Run("runtime errors", func(t *testing.T) {
		for _, expression := range []string{"int(request.header.Get('absent')) > 0", "log.status"} {
			program, err := CreateNewExprManager().CompileAccessLogFilter(expression)
			require.NoError(t, err)
			_, err = ResolveAccessLogFilter(program, AccessLogContext{Log: map[string]any{"status": "not a boolean"}})
			require.Error(t, err)
		}
	})
	t.Run("no filter", func(t *testing.T) {
		program, err := CreateNewExprManager().CompileAccessLogFilter("")
		require.NoError(t, err)
		require.Nil(t, program)
		result, err := ResolveAccessLogFilter(program, AccessLogContext{})
		require.NoError(t, err)
		require.True(t, result)
	})
	t.Run("duration retains type", func(t *testing.T) {
		program, err := CreateNewExprManager().CompileAccessLogFilter("log.latency > duration('100ms')")
		require.NoError(t, err)
		result, err := ResolveAccessLogFilter(program, AccessLogContext{Log: map[string]any{"latency": time.Second}})
		require.NoError(t, err)
		require.True(t, result)
	})
}

func TestAccessLogFilterVisitors(t *testing.T) {
	t.Parallel()
	manager := CreateNewExprManager()
	_, err := manager.CompileAccessLogFilter(`request.body.raw != '' && response.body.raw != '' &&
 subgraph.response.body.raw != '' && subgraph.request.clientTrace.fetchDuration > duration('1ms') &&
 request.operation.sha256Hash != '' && request.operation.variables != ''`)
	require.NoError(t, err)
	visitors := manager.VisitorManager
	require.True(t, visitors.IsRequestBodyUsedInExpressions())
	require.True(t, visitors.IsResponseBodyUsedInExpressions())
	require.True(t, visitors.IsSubgraphResponseBodyUsedInExpressions())
	require.True(t, visitors.IsSubgraphTraceUsedInExpressions())
	require.True(t, visitors.IsRequestOperationSha256UsedInExpressions())
	require.True(t, visitors.IsRequestOperationVariablesUsedInExpressions())
}
