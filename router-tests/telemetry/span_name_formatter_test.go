package telemetry

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace"

	custom_span_name_formatter "github.com/wundergraph/cosmo/router-tests/modules/custom-span-name-formatter"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// findSpanByNameAndKind returns the first span matching the given name and
// kind. Span order from the in-memory exporter is not guaranteed to match
// emission order across producers, so callers always look up by attributes
// rather than indexing.
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

func TestSpanNameFormatterModuleProvider(t *testing.T) {
	t.Parallel()

	t.Run("wraps root server span when module overrides formatter", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			RouterOptions: []core.Option{
				core.WithCustomModules(&custom_span_name_formatter.Module{
					Prefix: "wrapped/",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query myEmployees { employees { id } }`,
				OperationName: []byte(`"myEmployees"`),
			})
			require.Contains(t, res.Body, `"id"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)

			// The root span is renamed by the prehandler via the configured
			// formatter chain. If the prehandler still bypassed the chain we
			// would see "query myEmployees" here instead.
			root := rootSpan(sn)
			require.NotNil(t, root)
			require.Equal(t, trace.SpanKindServer, root.SpanKind())
			require.Equal(t, "wrapped/query myEmployees", root.Name())
		})
	})

	t.Run("wraps subgraph client span when module overrides formatter", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			RouterOptions: []core.Option{
				core.WithCustomModules(&custom_span_name_formatter.Module{
					Prefix: "wrapped/",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query myEmployees { employees { id } }`,
				OperationName: []byte(`"myEmployees"`),
			})
			require.Contains(t, res.Body, `"id"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)

			// otelhttp drives the subgraph client span name through the same
			// configured formatter, so the prefix must appear here too.
			client := findSpanByNameAndKind(sn, "wrapped/query myEmployees", trace.SpanKindClient)
			require.NotNil(t, client, "expected subgraph client span with wrapped prefix; got names: %v", spanNames(sn))
		})
	})

	t.Run("composes multiple modules with lower priority outermost", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		// Two providers prove the chain order. Priority 1 sorts before
		// priority 2 in sortModules; the fold in router.go installs the
		// lower-priority wrapper outermost, so its prefix appears first in
		// the produced span name. The instances need distinct IDs so they
		// don't collide in the router's module registry.
		outer := &custom_span_name_formatter.Module{Prefix: "outer/", Priority: 1, ID: "customSpanNameFormatterOuter"}
		inner := &custom_span_name_formatter.Module{Prefix: "inner/", Priority: 2, ID: "customSpanNameFormatterInner"}

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			RouterOptions: []core.Option{
				core.WithCustomModules(outer, inner),
			},
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
			require.Equal(t, trace.SpanKindServer, root.SpanKind())
			require.Equal(t, "outer/inner/query myEmployees", root.Name())

			client := findSpanByNameAndKind(sn, "outer/inner/query myEmployees", trace.SpanKindClient)
			require.NotNil(t, client, "expected subgraph client span with composed prefixes; got names: %v", spanNames(sn))
		})
	})
}

// spanNames returns the names of all spans in the slice. It is used purely to
// produce a useful failure message when the expected span cannot be located.
func spanNames(spans []sdktrace.ReadOnlySpan) []string {
	out := make([]string, 0, len(spans))
	for _, s := range spans {
		out = append(out, s.Name())
	}
	return out
}
