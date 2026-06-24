package expr

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUtcToEpochUnix(t *testing.T) {
	t.Parallel()

	t.Run("parses RFC3339 with milliseconds", func(t *testing.T) {
		t.Parallel()

		got, err := utcToEpochUnix("2026-06-22T19:45:39.018Z")
		require.NoError(t, err)
		require.Equal(t, int64(1782157539018), got)
	})

	t.Run("parses RFC3339 without fractional seconds", func(t *testing.T) {
		t.Parallel()

		got, err := utcToEpochUnix("2026-06-22T19:45:39Z")
		require.NoError(t, err)
		require.Equal(t, int64(1782157539000), got)
	})

	t.Run("parses RFC3339 with timezone offset", func(t *testing.T) {
		t.Parallel()

		got, err := utcToEpochUnix("2026-06-22T19:45:39.018+02:00")
		require.NoError(t, err)
		require.Equal(t, int64(1782150339018), got)
	})

	t.Run("errors on non-string argument", func(t *testing.T) {
		t.Parallel()

		_, err := utcToEpochUnix(12345)
		require.Error(t, err)
	})

	t.Run("errors on wrong number of arguments", func(t *testing.T) {
		t.Parallel()

		_, err := utcToEpochUnix("a", "b")
		require.Error(t, err)
	})

	t.Run("errors on unparseable timestamp", func(t *testing.T) {
		t.Parallel()

		_, err := utcToEpochUnix("not-a-timestamp")
		require.Error(t, err)
	})
}

func TestUtcToEpochUnixInExpression(t *testing.T) {
	t.Parallel()

	t.Run("usable in a compiled expression", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		program, err := exprManager.CompileAnyExpression("UTC_to_epochUnix('2026-06-22T19:45:39.018Z')")
		require.NoError(t, err)

		result, err := ResolveAnyExpression(program, Context{})
		require.NoError(t, err)
		require.Equal(t, int64(1782157539018), result)
	})

	t.Run("validates as an allowed expression", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()
		require.NoError(t, exprManager.ValidateAnyExpression("UTC_to_epochUnix('2026-06-22T19:45:39.018Z')"))
	})

	t.Run("combined with subgraph startTime yields fractional seconds", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		program, err := exprManager.CompileAnyExpression(
			"(UTC_to_epochUnix(subgraph.response.header.Get('X-Server-Start')) - subgraph.request.startTime) / 1000",
		)
		require.NoError(t, err)

		ctx := Context{}
		ctx.Subgraph.Request.StartTime = 1782157539000
		ctx.Subgraph.Response.Header = ResponseHeaders{
			Header: http.Header{"X-Server-Start": []string{"2026-06-22T19:45:39.500Z"}},
		}

		result, err := ResolveAnyExpression(program, ctx)
		require.NoError(t, err)
		// (1782157539500 - 1782157539000) / 1000 = 0.5 (division always returns float64)
		require.Equal(t, 0.5, result)
	})
}

func TestSubgraphResponseHeaderExpression(t *testing.T) {
	t.Parallel()

	t.Run("reads a present header", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		program, err := exprManager.CompileAnyExpression("subgraph.response.header.Get('X-Ebay-Mesh-Gw-Duration')")
		require.NoError(t, err)

		ctx := Context{}
		ctx.Subgraph.Response.Header = ResponseHeaders{
			Header: http.Header{"X-Ebay-Mesh-Gw-Duration": []string{"1234"}},
		}

		result, err := ResolveAnyExpression(program, ctx)
		require.NoError(t, err)
		require.Equal(t, "1234", result)
	})

	t.Run("returns empty string for a missing header on a nil map", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		program, err := exprManager.CompileAnyExpression("subgraph.response.header.Get('X-Missing')")
		require.NoError(t, err)

		result, err := ResolveAnyExpression(program, Context{})
		require.NoError(t, err)
		require.Equal(t, "", result)
	})

	t.Run("numeric header value divided as float", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		program, err := exprManager.CompileAnyExpression("float(subgraph.response.header.Get('X-Ebay-Mesh-Gw-Duration')) / 1000")
		require.NoError(t, err)

		ctx := Context{}
		ctx.Subgraph.Response.Header = ResponseHeaders{
			Header: http.Header{"X-Ebay-Mesh-Gw-Duration": []string{"1500"}},
		}

		result, err := ResolveAnyExpression(program, ctx)
		require.NoError(t, err)
		require.Equal(t, 1.5, result)
	})
}
