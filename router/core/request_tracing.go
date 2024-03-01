package core

import (
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	// RequestTraceHeader is the header used to enable request tracing
	RequestTraceHeader = "X-WG-Trace"
	// RequestTraceQueryParameter is the query parameter used to enable request tracing
	RequestTraceQueryParameter                      = "wg_trace"
	requestTraceOptionExcludeParseStats             = "exclude_parse_stats"
	requestTraceOptionExcludeNormalizeStats         = "exclude_normalize_stats"
	requestTraceOptionExcludeValidateStats          = "exclude_validate_stats"
	requestTraceOptionExcludePlannerStats           = "exclude_planner_stats"
	requestTraceOptionExcludeRawInputData           = "exclude_raw_input_data"
	requestTraceOptionExcludeInput                  = "exclude_input"
	requestTraceOptionExcludeOutput                 = "exclude_output"
	requestTraceOptionExcludeLoadStats              = "exclude_load_stats"
	requestTraceOptionEnablePredictableDebugTimings = "enable_predictable_debug_timings"
)

func ParseRequestTraceOptions(r *http.Request) (options resolve.TraceOptions) {
	var (
		values []string
	)
	if r.Header.Get(RequestTraceHeader) != "" {
		options.Enable = true
		values = r.Header.Values(RequestTraceHeader)
	}
	if r.URL.Query().Get(RequestTraceQueryParameter) != "" {
		options.Enable = true
		values = r.URL.Query()[RequestTraceQueryParameter]
	}
	if len(values) == 0 {
		options.ExcludePlannerStats = true
		options.ExcludeRawInputData = true
		options.ExcludeInput = true
		options.ExcludeOutput = true
		options.ExcludeLoadStats = true
		options.EnablePredictableDebugTimings = true
		return
	}
	options.IncludeTraceOutputInResponseExtensions = true
	for i := range values {
		switch values[i] {
		case requestTraceOptionExcludeParseStats:
			options.ExcludeParseStats = true
		case requestTraceOptionExcludeNormalizeStats:
			options.ExcludeNormalizeStats = true
		case requestTraceOptionExcludeValidateStats:
			options.ExcludeValidateStats = true
		case requestTraceOptionExcludePlannerStats:
			options.ExcludePlannerStats = true
		case requestTraceOptionExcludeRawInputData:
			options.ExcludeRawInputData = true
		case requestTraceOptionExcludeInput:
			options.ExcludeInput = true
		case requestTraceOptionExcludeOutput:
			options.ExcludeOutput = true
		case requestTraceOptionExcludeLoadStats:
			options.ExcludeLoadStats = true
		case requestTraceOptionEnablePredictableDebugTimings:
			options.EnablePredictableDebugTimings = true
		}
	}
	return
}
