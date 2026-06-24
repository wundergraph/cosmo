package expr

import (
	"fmt"
	"time"

	"github.com/expr-lang/expr"
)

// customFunctions returns the list of custom functions that are exposed to every compiled
// expression. Function calls are more expensive than field access, so this list should be kept
// minimal (see the package-level recommendations in expr.go).
func customFunctions() []expr.Option {
	return []expr.Option{
		expr.Function(
			"UTC_to_epochUnix",
			utcToEpochUnix,
			new(func(string) int64),
		),
	}
}

// utcToEpochUnix parses an ISO-8601 / RFC3339 timestamp (e.g. "2026-06-22T19:45:39.018Z") and
// returns the corresponding Unix epoch in milliseconds. Fractional seconds and timezone offsets
// are supported. The result is expressed in milliseconds so it can be combined directly with
// subgraph.request.startTime, e.g.:
//
//	(UTC_to_epochUnix(subgraph.response.header.Get('X-Server-Start')) - subgraph.request.startTime) / 1000
func utcToEpochUnix(params ...any) (any, error) {
	if len(params) != 1 {
		return nil, fmt.Errorf("UTC_to_epochUnix expects exactly one argument, got %d", len(params))
	}

	value, ok := params[0].(string)
	if !ok {
		return nil, fmt.Errorf("UTC_to_epochUnix expects a string argument, got %T", params[0])
	}

	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, fmt.Errorf("UTC_to_epochUnix could not parse %q as an RFC3339 timestamp: %w", value, err)
	}

	return t.UnixMilli(), nil
}
