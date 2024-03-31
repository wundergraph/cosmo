package integration

import (
	"context"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
	"net/http"
	"testing"
)

func TestTelemetry(t *testing.T) {
	t.Parallel()

	const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

	t.Run("Trace unnamed GraphQL operation with metrics", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 8, "expected 8 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())

			require.Equal(t, "Operation - Normalize", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Validate", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Plan", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			// Engine Transport
			require.Equal(t, "query unnamed", sn[4].Name())
			require.Equal(t, trace.SpanKindClient, sn[4].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[5].Name())
			require.Equal(t, trace.SpanKindInternal, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[7].Name())
			require.Equal(t, trace.SpanKindServer, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			/**
			* Metrics
			 */
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(context.Background(), &rm)
			require.NoError(t, err)

			httpRequestsMetric := metricdata.Metrics{
				Name:        "router.http.requests",
				Description: "Total number of requests",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 1,
						},
					},
				},
			}

			requestDurationMetric := metricdata.Metrics{
				Name:        "router.http.request.duration_milliseconds",
				Description: "Server latency in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
						},
					},
				},
			}

			requestContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.request.content_length",
				Description: "Total number of request bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 38,
						},
					},
				},
			}

			responseContentLengthMetric := metricdata.Metrics{
				Name:        "router.http.response.content_length",
				Description: "Total number of response bytes",
				Unit:        "bytes",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					IsMonotonic: true,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight.count",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgFederatedGraphID.String("graph"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(""),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			want := metricdata.ScopeMetrics{
				Scope: instrumentation.Scope{
					Name:      "cosmo.router",
					SchemaURL: "",
					Version:   "0.0.1",
				},
				Metrics: []metricdata.Metrics{
					httpRequestsMetric,
					requestDurationMetric,
					requestContentLengthMetric,
					responseContentLengthMetric,
					requestInFlightMetric,
				},
			}

			require.Equal(t, 1, len(rm.ScopeMetrics), "expected 1 ScopeMetrics, got %d", len(rm.ScopeMetrics))
			require.Equal(t, 5, len(rm.ScopeMetrics[0].Metrics), "expected 5 Metrics, got %d", len(rm.ScopeMetrics[0].Metrics))

			metricdatatest.AssertEqual(t, want, rm.ScopeMetrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, rm.ScopeMetrics[0].Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, rm.ScopeMetrics[0].Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, rm.ScopeMetrics[0].Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, rm.ScopeMetrics[0].Metrics[4], metricdatatest.IgnoreTimestamp())

		})
	})

	t.Run("Trace named operation", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 8, "expected 8 spans, got %d", len(sn))

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())

			require.Equal(t, "Operation - Normalize", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Validate", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Plan", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			// Engine Transport
			require.Equal(t, "query myQuery", sn[4].Name())
			require.Equal(t, trace.SpanKindClient, sn[4].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[5].Name())
			require.Equal(t, trace.SpanKindInternal, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// Root Server middleware
			require.Equal(t, "query myQuery", sn[7].Name())
			require.Equal(t, trace.SpanKindServer, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())
		})
	})

	t.Run("Subgraph error produces a span event per GraphQL error", func(t *testing.T) {
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","extensions":{"code":"YOUR_ERROR_CODE"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at path 'query.employees.@'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 10, "expected 10 spans, got %d", len(sn))

			// The request to the employees subgraph succeeded
			require.Equal(t, "Engine - Fetch", sn[5].Name())
			require.Equal(t, trace.SpanKindInternal, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			given := attribute.NewSet(sn[5].Attributes()...)
			want := attribute.NewSet([]attribute.KeyValue{
				semconv.HTTPStatusCode(200),
				otel.WgClientName.String("unknown"),
				otel.WgClientVersion.String("missing"),
				otel.WgComponentName.String("engine-loader"),
				otel.WgOperationHash.String("16884868987896027258"),
				otel.WgOperationName.String("myQuery"),
				otel.WgOperationProtocol.String("http"),
				otel.WgOperationType.String("query"),
				otel.WgSubgraphName.String("employees"),
				otel.WgSubgraphID.String("0"),
			}...)

			require.True(t, given.Equals(&want))

			// The request to the products subgraph failed with a 403 status code
			require.Equal(t, "Engine - Fetch", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())

			given = attribute.NewSet(sn[7].Attributes()...)
			want = attribute.NewSet([]attribute.KeyValue{
				otel.WgSubgraphName.String("products"),
				otel.WgSubgraphID.String("3"),
				semconv.HTTPStatusCode(403),
				otel.WgComponentName.String("engine-loader"),
				otel.WgClientName.String("unknown"),
				otel.WgClientVersion.String("missing"),
				otel.WgOperationName.String("myQuery"),
				otel.WgOperationType.String("query"),
				otel.WgOperationProtocol.String("http"),
				otel.WgOperationHash.String("16884868987896027258"),
				// Downstream errors
				otel.WgSubgraphErrorExtendedCode.String("UNAUTHORIZED,YOUR_ERROR_CODE"),
			}...)

			require.True(t, given.Equals(&want))

			require.Equal(t, sdktrace.Status{Code: codes.Error, Description: `Failed to fetch Subgraph '3' at path: 'query.employees.@'.
Downstream errors:
1. Subgraph error, Message: Unauthorized, Extension Code: UNAUTHORIZED
2. Subgraph error, Message: MyErrorMessage, Extension Code: YOUR_ERROR_CODE
`}, sn[7].Status())

			events := sn[7].Events()
			require.Len(t, events, 3, "expected 2 events, one for the fetch and one two downstream GraphQL errors")
			require.Equal(t, "exception", events[0].Name)

			require.Equal(t, "Downstream error 1", events[1].Name)
			require.Equal(t, []attribute.KeyValue{
				otel.WgSubgraphErrorExtendedCode.String("UNAUTHORIZED"),
				otel.WgSubgraphErrorMessage.String("Unauthorized"),
			}, events[1].Attributes)

			require.Equal(t, "Downstream error 2", events[2].Name)
			require.Equal(t, []attribute.KeyValue{
				otel.WgSubgraphErrorExtendedCode.String("YOUR_ERROR_CODE"),
				otel.WgSubgraphErrorMessage.String("MyErrorMessage"),
			}, events[2].Attributes)

		})
	})
}
