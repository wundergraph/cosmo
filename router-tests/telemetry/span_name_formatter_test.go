package telemetry

import (
"net/http"
"testing"

"github.com/stretchr/testify/require"
"github.com/wundergraph/cosmo/router-tests/testenv"
"github.com/wundergraph/cosmo/router/core"
"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
sdktrace "go.opentelemetry.io/otel/sdk/trace"
"go.opentelemetry.io/otel/trace"
)

// findSpanByNameAndKind returns the first span matching the given name and kind.
func findSpanByNameAndKind(spans []sdktrace.ReadOnlySpan, name string, kind trace.SpanKind) sdktrace.ReadOnlySpan {
for _, s := range spans {
if s.Name() == name && s.SpanKind() == kind {
return s
}
}
return nil
}

func TestSpanNameFormatterDefault(t *testing.T) {
t.Parallel()

t.Run("uses operation type and name for root span", func(t *testing.T) {
t.Parallel()

exporter := tracetest.NewInMemoryExporter(t)

testenv.Run(t, &testenv.Config{
TraceExporter: exporter,
}, func(t *testing.T, xEnv *testenv.Environment) {
res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
Query:         `query myEmployees { employees { id } }`,
OperationName: []byte(`"myEmployees"`),
})
require.Contains(t, res.Body, `"id"`)

sn := exporter.GetSpans().Snapshots()
require.NotEmpty(t, sn)

root := rootSpan(sn)
require.NotNil(t, root)
require.Equal(t, "query myEmployees", root.Name())
require.Equal(t, trace.SpanKindServer, root.SpanKind())
})
})

t.Run("uses unnamed for anonymous operations", func(t *testing.T) {
t.Parallel()

exporter := tracetest.NewInMemoryExporter(t)

testenv.Run(t, &testenv.Config{
TraceExporter: exporter,
}, func(t *testing.T, xEnv *testenv.Environment) {
res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
Query: `query { employees { id } }`,
})
require.Contains(t, res.Body, `"id"`)

sn := exporter.GetSpans().Snapshots()
require.NotEmpty(t, sn)

root := rootSpan(sn)
require.NotNil(t, root)
require.Equal(t, "query unnamed", root.Name())
require.Equal(t, trace.SpanKindServer, root.SpanKind())
})
})
}

func TestSpanNameFormatterCustomOverride(t *testing.T) {
// Not parallel: mutates the package-level SpanNameFormatter variable.
original := core.SpanNameFormatter
t.Cleanup(func() {
core.SpanNameFormatter = original
})

core.SpanNameFormatter = func(_ string, r *http.Request) string {
name := original("", r)
return "custom/" + name
}

exporter := tracetest.NewInMemoryExporter(t)

testenv.Run(t, &testenv.Config{
TraceExporter: exporter,
}, func(t *testing.T, xEnv *testenv.Environment) {
res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
Query:         `query myEmployees { employees { id } }`,
OperationName: []byte(`"myEmployees"`),
})
require.Contains(t, res.Body, `"id"`)

sn := exporter.GetSpans().Snapshots()
require.NotEmpty(t, sn)

// SpanNameFormatter is used for the HTTP transport client span (subgraph call).
// The root server span is subsequently renamed by the pre-handler using GetSpanName directly.
transportSpan := findSpanByNameAndKind(sn, "custom/query myEmployees", trace.SpanKindClient)
require.NotNil(t, transportSpan, "expected transport span with custom formatter prefix")
})
}
