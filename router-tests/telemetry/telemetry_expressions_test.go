package telemetry

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/trace"
	"testing"
)

func TestTelemetryExpressions(t *testing.T) {
	t.Parallel()

	metricReader := metric.NewManualReader()
	exporter := tracetest.NewInMemoryExporter(t)

	testenv.Run(t, &testenv.Config{
		TraceExporter:             exporter,
		MetricReader:              metricReader,
		SubgraphAccessLogsEnabled: true,
		SubgraphTracingOptions: &core.SubgraphTracingOptions{
			ExpressionAttributes: []core.ExpressionAttribute{
				{
					Key:        "wg.test.hostPort",
					Expression: "subgraph.operation.trace.connCreate?.hostPort",
				},
			},
		},
		RouterOptions: []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				All: &config.GlobalHeaderRule{
					Request: []*config.RequestHeaderRule{
						{
							Operation: config.HeaderRuleOperationPropagate,
							Named:     "service-name",
						},
					},
				},
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:  `query employees { employees { id details { forename surname } notes } }`,
			Header: map[string][]string{"service-name": {"service-name"}},
		})

		sn := exporter.GetSpans().Snapshots()
		engineFetchSpan := sn[6]
		require.Equal(t, "Engine - Fetch", engineFetchSpan.Name())
		require.Equal(t, trace.SpanKindInternal, engineFetchSpan.SpanKind())

		attributes := engineFetchSpan.Attributes()
		value := attributes[14]
		require.Contains(t, value.Value.AsString(), "127.0.0.1:")
	})
}
