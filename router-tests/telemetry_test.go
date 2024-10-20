package integration

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/metric/metricdata/metricdatatest"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.19.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
)

func TestTelemetry(t *testing.T) {
	t.Parallel()

	const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

	t.Run("Trace unnamed GraphQL operation and validate all metrics and spans", func(t *testing.T) {
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
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation Read

			require.Equal(t, "HTTP - Read Body", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())
			require.Len(t, sn[0].Attributes(), 7)
			require.Contains(t, sn[0].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[0].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[0].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[0].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[0].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[0].Attributes(), otel.WgOperationProtocol.String("http"))

			// Pre-Handler Operation Parse

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			// Span Resource attributes

			rs := attribute.NewSet(sn[1].Resource().Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[1].Attributes(), 7)
			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[1].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[1].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[2].Resource().Attributes()...)

			require.Len(t, sn[2].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[2].Attributes(), 10)

			require.Contains(t, sn[2].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[2].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[2].Attributes(), otel.WgNormalizationCacheHit.Bool(false))
			require.Contains(t, sn[2].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[2].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[2].Attributes(), otel.WgOperationProtocol.String("http"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[3].Resource().Attributes()...)

			require.Len(t, sn[3].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[3].Attributes(), 11)

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Contains(t, sn[3].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[3].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgFederatedGraphID.String("graph"))

			require.Contains(t, sn[3].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			require.Contains(t, sn[3].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[3].Attributes(), otel.WgOperationType.String("query"))

			require.Contains(t, sn[3].Attributes(), otel.WgOperationHash.String("14226210703439426856"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			// Span Resource attributes

			rs = attribute.NewSet(sn[4].Resource().Attributes()...)

			require.Len(t, sn[4].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[4].Attributes(), 12)
			require.Contains(t, sn[4].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[4].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[4].Attributes(), otel.WgEngineRequestTracingEnabled.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgEnginePlanCacheHit.Bool(false))
			require.Contains(t, sn[4].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[4].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[4].Attributes(), otel.WgOperationHash.String("14226210703439426856"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[5].Resource().Attributes()...)

			require.Len(t, sn[5].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			sa := attribute.NewSet(sn[5].Attributes()...)

			require.Len(t, sn[5].Attributes(), 21)
			require.True(t, sa.HasValue(semconv.HTTPURLKey))
			require.True(t, sa.HasValue(semconv.NetPeerPortKey))

			require.Contains(t, sn[5].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[5].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[5].Attributes(), otel.WgComponentName.String("engine-transport"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[5].Attributes(), semconv.NetPeerName("127.0.0.1"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPRequestContentLength(28))
			require.Contains(t, sn[5].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[5].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[5].Attributes(), otel.WgOperationHash.String("14226210703439426856"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[5].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[5].Attributes(), semconv.HTTPResponseContentLength(117))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[6].Resource().Attributes()...)

			require.Len(t, sn[6].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[6].Attributes(), 14)

			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphID.String("0"))
			require.Contains(t, sn[6].Attributes(), otel.WgSubgraphName.String("employees"))
			require.Contains(t, sn[6].Attributes(), semconv.HTTPStatusCode(200))
			require.Contains(t, sn[6].Attributes(), otel.WgComponentName.String("engine-loader"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[6].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[6].Attributes(), otel.WgOperationHash.String("14226210703439426856"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[6].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[6].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[7].Resource().Attributes()...)

			require.Len(t, sn[7].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			// Span attributes

			require.Len(t, sn[7].Attributes(), 11)
			require.Contains(t, sn[7].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[7].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[7].Attributes(), otel.WgOperationHash.String("14226210703439426856"))

			require.Contains(t, sn[7].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[7].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[7].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[7].Attributes(), otel.WgAcquireResolverWaitTimeMs.Int64(0))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())

			// Span Resource attributes

			rs = attribute.NewSet(sn[8].Resource().Attributes()...)

			require.Len(t, sn[8].Resource().Attributes(), 9)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("service.name", "cosmo-router"))

			sa = attribute.NewSet(sn[8].Attributes()...)

			require.Len(t, sn[8].Attributes(), 26)
			require.True(t, sa.HasValue(semconv.NetHostPortKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerAddrKey))
			require.True(t, sa.HasValue(semconv.NetSockPeerPortKey))
			require.True(t, sa.HasValue(otel.WgRouterConfigVersion))
			require.True(t, sa.HasValue(otel.WgFederatedGraphID))
			require.True(t, sa.HasValue("http.user_agent"))
			require.True(t, sa.HasValue("http.host"))
			require.True(t, sa.HasValue("http.read_bytes"))
			require.True(t, sa.HasValue("http.wrote_bytes"))

			require.Contains(t, sn[8].Attributes(), semconv.HTTPMethod("POST"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPScheme("http"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
			require.Contains(t, sn[8].Attributes(), semconv.NetHostName("localhost"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgComponentName.String("router-server"))
			require.Contains(t, sn[8].Attributes(), otel.WgRouterRootSpan.Bool(true))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPTarget("/graphql"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[8].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationName.String(""))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationType.String("query"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationContent.String("{employees {id}}"))
			require.Contains(t, sn[8].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[8].Attributes(), otel.WgOperationHash.String("14226210703439426856"))
			require.Contains(t, sn[8].Attributes(), semconv.HTTPStatusCode(200))

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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
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
					operationPlanningTimeMetric,
				},
			}

			rs = attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Equal(t, 1, len(rm.ScopeMetrics), "expected 1 ScopeMetrics, got %d", len(rm.ScopeMetrics))
			require.Equal(t, 6, len(rm.ScopeMetrics[0].Metrics), "expected 6 Metrics, got %d", len(rm.ScopeMetrics[0].Metrics))

			metricdatatest.AssertEqual(t, want, rm.ScopeMetrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, rm.ScopeMetrics[0].Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, rm.ScopeMetrics[0].Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, rm.ScopeMetrics[0].Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, rm.ScopeMetrics[0].Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, rm.ScopeMetrics[0].Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, rm.ScopeMetrics[0].Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			// make a second request and assert that we're now hitting the validation cache

			exporter.Reset()

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn = exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))
			require.Len(t, sn[3].Attributes(), 11)
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(true))
		})
	})

	t.Run("Trace persisted operation", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"MyQuery"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQuery"}}`),
				Header:        header,
				Variables:     []byte(`{"arg": "a"}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
			require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))

			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 10, "expected 10 spans, got %d", len(sn))
			require.Equal(t, "Load Persisted Operation", sn[1].Name())
			require.Equal(t, trace.SpanKindClient, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())
			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), semconv.HTTPMethod(http.MethodGet))
			require.Contains(t, sn[1].Attributes(), semconv.HTTPStatusCode(200))

			// Ensure the persisted operation span is a child of the root span
			require.Equal(t, sn[1].Parent().SpanID(), sn[9].SpanContext().SpanID())

			exporter.Reset()

			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"MyQuery"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQuery"}}`),
				Header:        header,
				Variables:     []byte(`{"arg": "a"}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))

			sn = exporter.GetSpans().Snapshots()

			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))
			require.Equalf(t, "Load Persisted Operation", sn[1].Name(), "A cache hit")
			require.Contains(t, sn[1].Attributes(), otel.WgEnginePersistedOperationCacheHit.Bool(true))
		})
	})

	t.Run("Custom span and resource attributes are attached to all metrics and spans / from header", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			CustomResourceAttributes: []config.CustomStaticAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			CustomTelemetryAttributes: []config.CustomAttribute{
				{
					Key:     "custom",
					Default: "value",
					ValueFrom: &config.CustomDynamicAttribute{
						RequestHeader: "x-custom-header",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: map[string][]string{
					"x-custom-header": {"value"},
				},
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())
			require.Contains(t, sn[1].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())
			require.Contains(t, sn[2].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())
			require.Contains(t, sn[3].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())
			require.Contains(t, sn[4].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())
			require.Contains(t, sn[5].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())
			require.Contains(t, sn[6].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())
			require.Contains(t, sn[7].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
			require.Contains(t, sn[8].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("custom.resource", "value"))

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
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
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
					operationPlanningTimeMetric,
				},
			}

			rs := attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.Contains(t, rm.Resource.Attributes(), attribute.String("custom.resource", "value"))
			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Equal(t, 1, len(rm.ScopeMetrics), "expected 1 ScopeMetrics, got %d", len(rm.ScopeMetrics))
			require.Equal(t, 6, len(rm.ScopeMetrics[0].Metrics), "expected 6 Metrics, got %d", len(rm.ScopeMetrics[0].Metrics))

			metricdatatest.AssertEqual(t, want, rm.ScopeMetrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, httpRequestsMetric, rm.ScopeMetrics[0].Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, rm.ScopeMetrics[0].Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, rm.ScopeMetrics[0].Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, rm.ScopeMetrics[0].Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, rm.ScopeMetrics[0].Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, rm.ScopeMetrics[0].Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

		})
	})

	t.Run("Custom span and resource attributes are attached to all metrics and spans / static", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			CustomResourceAttributes: []config.CustomStaticAttribute{
				{
					Key:   "custom.resource",
					Value: "value",
				},
			},
			CustomTelemetryAttributes: []config.CustomAttribute{
				{
					Key:     "custom",
					Default: "value",
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: map[string][]string{
					"x-custom-header": {"value_different"},
				},
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())
			require.Contains(t, sn[1].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[1].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())
			require.Contains(t, sn[2].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[2].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())
			require.Contains(t, sn[3].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[3].Resource().Attributes(), attribute.String("custom.resource", "value"))

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())
			require.Contains(t, sn[4].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[4].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Transport
			require.Equal(t, "query unnamed", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())
			require.Contains(t, sn[5].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[5].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())
			require.Contains(t, sn[6].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[6].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())
			require.Contains(t, sn[7].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[7].Resource().Attributes(), attribute.String("custom.resource", "value"))

			// Root Server middleware
			require.Equal(t, "query unnamed", sn[8].Name())
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
			require.Contains(t, sn[8].Attributes(), attribute.String("custom", "value"))
			require.Contains(t, sn[8].Resource().Attributes(), attribute.String("custom.resource", "value"))

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
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 1,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Sum: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 28,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
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
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 117,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								semconv.HTTPStatusCode(200),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Value: 0,
						},
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								attribute.String("custom", "value"),
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
								otel.WgRouterVersion.String("dev"),
							),
							Sum: 0,
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
					operationPlanningTimeMetric,
				},
			}

			rs := attribute.NewSet(rm.Resource.Attributes()...)

			require.True(t, rs.HasValue("host.name"))
			require.True(t, rs.HasValue("os.type"))
			require.True(t, rs.HasValue("process.pid"))

			require.Contains(t, rm.Resource.Attributes(), attribute.String("custom.resource", "value"))
			require.NotEmpty(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.version", "1.24.0"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.instance.id", "test-instance"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.name", "opentelemetry"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("telemetry.sdk.language", "go"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.version", "dev"))
			require.Contains(t, rm.Resource.Attributes(), attribute.String("service.name", "cosmo-router"))

			require.Equal(t, 1, len(rm.ScopeMetrics), "expected 1 ScopeMetrics, got %d", len(rm.ScopeMetrics))
			require.Equal(t, 6, len(rm.ScopeMetrics[0].Metrics), "expected 6 Metrics, got %d", len(rm.ScopeMetrics[0].Metrics))

			metricdatatest.AssertEqual(t, want, rm.ScopeMetrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, rm.ScopeMetrics[0].Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, rm.ScopeMetrics[0].Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, rm.ScopeMetrics[0].Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, rm.ScopeMetrics[0].Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, rm.ScopeMetrics[0].Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, rm.ScopeMetrics[0].Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

		})
	})

	t.Run("Requesting a feature flags will emit different router config version and add the feature flag attribute", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			/**
			* Spans
			 */

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Len(t, sn[1].Attributes(), 8)
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[1].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Len(t, sn[2].Attributes(), 11)
			require.Contains(t, sn[2].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[2].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Len(t, sn[3].Attributes(), 12)
			require.Contains(t, sn[3].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[3].Attributes(), otel.WgFeatureFlag.String("myff"))
			require.Contains(t, sn[3].Attributes(), otel.WgValidationCacheHit.Bool(false))

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Len(t, sn[4].Attributes(), 13)
			require.Contains(t, sn[4].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[4].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "query unnamed", sn[5].Name())
			require.Len(t, sn[5].Attributes(), 22)
			require.Contains(t, sn[5].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[5].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Len(t, sn[6].Attributes(), 15)
			require.Contains(t, sn[6].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[6].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Len(t, sn[7].Attributes(), 12)
			require.Contains(t, sn[7].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[7].Attributes(), otel.WgFeatureFlag.String("myff"))

			require.Equal(t, "query unnamed", sn[8].Name())
			require.Len(t, sn[8].Attributes(), 27)

			require.Contains(t, sn[8].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()))
			require.Contains(t, sn[8].Attributes(), otel.WgFeatureFlag.String("myff"))

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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 117,
						},
					},
				},
			}

			requestInFlightMetric := metricdata.Metrics{
				Name:        "router.http.requests.in_flight",
				Description: "Number of requests in flight",
				Unit:        "",
				Data: metricdata.Sum[int64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.DataPoint[int64]{
						{
							Attributes: attribute.NewSet(
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationProtocol.String("http"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
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
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgSubgraphID.String("0"),
								otel.WgSubgraphName.String("employees"),
								otel.WgFeatureFlag.String("myff"),
							),
							Value: 0,
						},
					},
				},
			}

			operationPlanningTimeMetric := metricdata.Metrics{
				Name:        "router.graphql.operation.planning_time",
				Description: "Operation planning time in milliseconds",
				Unit:        "ms",
				Data: metricdata.Histogram[float64]{
					Temporality: metricdata.CumulativeTemporality,
					DataPoints: []metricdata.HistogramDataPoint[float64]{
						{
							Attributes: attribute.NewSet(
								otel.WgEnginePlanCacheHit.Bool(false),
								otel.WgClientName.String("unknown"),
								otel.WgClientVersion.String("missing"),
								otel.WgFederatedGraphID.String("graph"),
								otel.WgOperationHash.String("14226210703439426856"),
								otel.WgOperationName.String(""),
								otel.WgOperationProtocol.String("http"),
								otel.WgOperationType.String("query"),
								otel.WgRouterClusterName.String(""),
								otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMyFF()),
								otel.WgRouterVersion.String("dev"),
								otel.WgFeatureFlag.String("myff"),
							),
							Sum: 0,
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
					operationPlanningTimeMetric,
				},
			}

			require.Equal(t, 1, len(rm.ScopeMetrics), "expected 1 ScopeMetrics, got %d", len(rm.ScopeMetrics))
			require.Equal(t, 6, len(rm.ScopeMetrics[0].Metrics), "expected 6 Metrics, got %d", len(rm.ScopeMetrics[0].Metrics))

			metricdatatest.AssertEqual(t, want, rm.ScopeMetrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())

			metricdatatest.AssertEqual(t, httpRequestsMetric, rm.ScopeMetrics[0].Metrics[0], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestDurationMetric, rm.ScopeMetrics[0].Metrics[1], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			metricdatatest.AssertEqual(t, requestContentLengthMetric, rm.ScopeMetrics[0].Metrics[2], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, responseContentLengthMetric, rm.ScopeMetrics[0].Metrics[3], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, requestInFlightMetric, rm.ScopeMetrics[0].Metrics[4], metricdatatest.IgnoreTimestamp())
			metricdatatest.AssertEqual(t, operationPlanningTimeMetric, rm.ScopeMetrics[0].Metrics[5], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
		})
	})

	t.Run("Spans are sampled because parent based sampling is disabled and ratio based sampler is set 1 (always)", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter:             exporter,
			DisableParentBasedSampler: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header without sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 00 = not sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sn[1].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sn[2].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sn[3].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sn[4].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Transport
			require.Equal(t, "query myQuery", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sn[5].Parent().SpanID(), sn[6].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, sn[6].Parent().SpanID(), sn[7].SpanContext().SpanID())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sn[7].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Root Server middleware
			require.Equal(t, "query myQuery", sn[8].Name())
			require.Equal(t, sn[8].ChildSpanCount(), 6)
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
		})
	})

	t.Run("Spans are sampled because parent based sampler is enabled by default and parent span sample flag is set", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header with sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-01"}, // 01 = sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sn[1].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sn[2].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sn[3].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sn[4].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Transport
			require.Equal(t, "query myQuery", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sn[5].Parent().SpanID(), sn[6].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, sn[6].Parent().SpanID(), sn[7].SpanContext().SpanID())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sn[7].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Root Server middleware
			require.Equal(t, "query myQuery", sn[8].Name())
			require.Equal(t, sn[8].ChildSpanCount(), 6)
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
		})
	})

	t.Run("Spans are not sampled because parent based sampler is enabled by default and parent span sample flag is not set", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header without sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 00 = not sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 0, "expected 0 spans, got %d", len(sn))
		})
	})

	t.Run("Client TraceID is respected with parent based sampler", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id } }`,
				Header: map[string][]string{
					// traceparent header without sample flag set
					"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-01"}, // 01 = sampled
				},
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))
			require.Equal(t, "0af7651916cd43dd8448eb211c80319c", sn[0].SpanContext().TraceID().String())
		})
	})

	t.Run("Trace named operation with parent-child relationship", func(t *testing.T) {
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
			require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

			require.Equal(t, "HTTP - Read Body", sn[0].Name())
			require.Equal(t, trace.SpanKindInternal, sn[0].SpanKind())
			require.Equal(t, sn[0].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())

			// Pre-Handler Operation steps
			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, sn[1].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[1].Status())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, sn[2].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[2].Status())

			require.Equal(t, "Operation - Validate", sn[3].Name())
			require.Equal(t, trace.SpanKindInternal, sn[3].SpanKind())
			require.Equal(t, sn[3].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[3].Status())

			require.Equal(t, "Operation - Plan", sn[4].Name())
			require.Equal(t, trace.SpanKindInternal, sn[4].SpanKind())
			require.Equal(t, sn[4].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[4].Status())

			// Engine Transport
			require.Equal(t, "query myQuery", sn[5].Name())
			require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
			require.Equal(t, sn[5].Parent().SpanID(), sn[6].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())

			// Engine Loader Hooks
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, sn[6].Parent().SpanID(), sn[7].SpanContext().SpanID())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			// GraphQL handler
			require.Equal(t, "Operation - Execute", sn[7].Name())
			require.Equal(t, trace.SpanKindInternal, sn[7].SpanKind())
			require.Equal(t, sn[7].Parent().SpanID(), sn[8].SpanContext().SpanID())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())

			// Root Server middleware
			require.Equal(t, "query myQuery", sn[8].Name())
			require.Equal(t, sn[8].ChildSpanCount(), 6)
			require.Equal(t, trace.SpanKindServer, sn[8].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[8].Status())
		})
	})

	t.Run("Origin connectivity issue is traced", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					CloseOnStart: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 11, "expected 11 spans, got %d", len(sn))

			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Lenf(t, sn[6].Attributes(), 14, "expected 14 attributes, got %d", len(sn[8].Attributes()))
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			require.Equal(t, "Engine - Fetch", sn[8].Name())
			require.Equal(t, trace.SpanKindInternal, sn[8].SpanKind())
			require.Equal(t, codes.Error, sn[8].Status().Code)
			require.Lenf(t, sn[8].Attributes(), 14, "expected 14 attributes, got %d", len(sn[8].Attributes()))
			require.Contains(t, sn[8].Status().Description, "connect: connection refused\nFailed to fetch from Subgraph 'products' at Path: 'employees'.")

			events := sn[8].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL request failed")
			require.Equal(t, "exception", events[0].Name)

			// Validate if the root span has the correct status and error
			require.Equal(t, "query unnamed", sn[10].Name())
			require.Equal(t, trace.SpanKindServer, sn[10].SpanKind())
			require.Equal(t, codes.Error, sn[10].Status().Code)
			require.Contains(t, sn[10].Status().Description, "connect: connection refused\nFailed to fetch from Subgraph 'products' at Path: 'employees'.")

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
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","path": ["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path": ["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","path":["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path":["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
			sn := exporter.GetSpans().Snapshots()
			require.Len(t, sn, 11, "expected 11 spans, got %d", len(sn))

			// The request to the employees subgraph succeeded
			require.Equal(t, "Engine - Fetch", sn[6].Name())
			require.Equal(t, trace.SpanKindInternal, sn[6].SpanKind())
			require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[6].Status())

			require.Lenf(t, sn[6].Attributes(), 14, "expected 14 attributes, got %d", len(sn[6].Attributes()))

			given := attribute.NewSet(sn[6].Attributes()...)
			want := attribute.NewSet([]attribute.KeyValue{
				semconv.HTTPStatusCode(200),
				otel.WgClientName.String("unknown"),
				otel.WgClientVersion.String("missing"),
				otel.WgComponentName.String("engine-loader"),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgOperationHash.String("16884868987896027258"),
				otel.WgOperationProtocol.String("http"),
				otel.WgOperationType.String("query"),
				otel.WgRouterClusterName.String(""),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
				otel.WgOperationName.String("myQuery"),
				otel.WgSubgraphName.String("employees"),
				otel.WgSubgraphID.String("0"),
			}...)

			require.True(t, given.Equals(&want))

			// The request to the products subgraph failed with a 403 status code
			require.Equal(t, "Engine - Fetch", sn[8].Name())
			require.Equal(t, trace.SpanKindInternal, sn[8].SpanKind())

			require.Lenf(t, sn[8].Attributes(), 14, "expected 14 attributes, got %d", len(sn[6].Attributes()))

			given = attribute.NewSet(sn[8].Attributes()...)
			want = attribute.NewSet([]attribute.KeyValue{
				otel.WgSubgraphName.String("products"),
				otel.WgSubgraphID.String("3"),
				semconv.HTTPStatusCode(403),
				otel.WgComponentName.String("engine-loader"),
				otel.WgFederatedGraphID.String("graph"),
				otel.WgRouterClusterName.String(""),
				otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
				otel.WgRouterVersion.String("dev"),
				otel.WgClientName.String("unknown"),
				otel.WgClientVersion.String("missing"),
				otel.WgOperationName.String("myQuery"),
				otel.WgOperationType.String("query"),
				otel.WgOperationProtocol.String("http"),
				otel.WgOperationHash.String("16884868987896027258"),
			}...)

			require.True(t, given.Equals(&want))

			require.Equal(t, sdktrace.Status{Code: codes.Error, Description: `Failed to fetch from Subgraph 'products' at Path: 'employees'.`}, sn[8].Status())

			events := sn[8].Events()
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

			// Validate if the root span has the correct status and error
			require.Equal(t, "query myQuery", sn[10].Name())
			require.Equal(t, trace.SpanKindServer, sn[10].SpanKind())
			require.Equal(t, codes.Error, sn[10].Status().Code)
			require.Contains(t, sn[10].Status().Description, `Failed to fetch from Subgraph 'products' at Path: 'employees'.`)
		})
	})

	t.Run("Operation parsing errors are tracked", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `invalid query`,
			})
			require.Equal(t, `{"errors":[{"message":"unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]","locations":[{"line":1,"column":1}]}]}`, res.Body)
			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 3, "expected 3 spans, got %d", len(sn))

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, codes.Error, sn[1].Status().Code)
			require.Contains(t, sn[1].Status().Description, "unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]")

			require.Lenf(t, sn[1].Attributes(), 8, "expected 14 attributes, got %d", len(sn[1].Attributes()))

			require.Contains(t, sn[1].Attributes(), otel.WgRouterVersion.String("dev"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterClusterName.String(""))
			require.Contains(t, sn[1].Attributes(), otel.WgFederatedGraphID.String("graph"))
			require.Contains(t, sn[1].Attributes(), otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
			require.Contains(t, sn[1].Attributes(), otel.WgClientName.String("unknown"))
			require.Contains(t, sn[1].Attributes(), otel.WgClientVersion.String("missing"))
			require.Contains(t, sn[1].Attributes(), otel.WgOperationProtocol.String("http"))
			require.Contains(t, sn[1].Attributes(), otel.WgRequestError.Bool(true))

			events := sn[1].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL parsing failed")
			require.Equal(t, "exception", events[0].Name)

			require.Equal(t, "POST /graphql", sn[2].Name())
			require.Equal(t, trace.SpanKindServer, sn[2].SpanKind())
			require.Equal(t, codes.Error, sn[2].Status().Code)
			require.Contains(t, sn[2].Status().Description, "unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]")

			require.Lenf(t, sn[2].Attributes(), 23, "expected 23 attributes, got %d", len(sn[2].Attributes()))
			require.Contains(t, sn[2].Attributes(), otel.WgRequestError.Bool(true))

			events = sn[2].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL request failed")
			require.Equal(t, "exception", events[0].Name)
		})
	})

	t.Run("Operation normalization errors are tracked", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query foo { employeesTypeNotExist { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"field: employeesTypeNotExist not defined on type: Query","path":["query","employeesTypeNotExist"]}]}`, res.Body)
			sn := exporter.GetSpans().Snapshots()

			require.Len(t, sn, 4, "expected 4 spans, got %d", len(sn))

			require.Equal(t, "Operation - Parse", sn[1].Name())
			require.Equal(t, trace.SpanKindInternal, sn[1].SpanKind())
			require.Equal(t, codes.Unset, sn[1].Status().Code)
			require.Empty(t, sn[1].Status().Description)

			require.Empty(t, sn[1].Events())

			require.Equal(t, "Operation - Normalize", sn[2].Name())
			require.Equal(t, trace.SpanKindInternal, sn[2].SpanKind())
			require.Equal(t, codes.Error, sn[2].Status().Code)
			require.Equal(t, sn[2].Status().Description, "field: employeesTypeNotExist not defined on type: Query")

			events := sn[2].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL normalization failed")
			require.Equal(t, "exception", events[0].Name)

			require.Equal(t, "query foo", sn[3].Name())
			require.Equal(t, trace.SpanKindServer, sn[3].SpanKind())
			require.Equal(t, codes.Error, sn[3].Status().Code)
			require.Contains(t, sn[3].Status().Description, "field: employeesTypeNotExist not defined on type: Query")

			events = sn[3].Events()
			require.Len(t, events, 1, "expected 1 event because the GraphQL request failed")
			require.Equal(t, "exception", events[0].Name)
		})
	})

	t.Run("Datadog Propagation", func(t *testing.T) {
		var (
			datadogTraceId = "9532127138774266268"
			testPropConfig = config.PropagationConfig{
				TraceContext: true,
				Datadog:      true,
			}
		)

		t.Run("Datadog headers are propagated if enabled", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: testPropConfig,
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, datadogTraceId, r.Header.Get("x-datadog-trace-id"))
								require.NotEqual(t, "", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "1", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-01"}, // 01 = sampled
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})

		t.Run("Datadog headers correctly recognize sampling bit", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: testPropConfig,
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, datadogTraceId, r.Header.Get("x-datadog-trace-id"))
								require.NotEqual(t, "", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "0", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 01 = sampled
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})

		t.Run("Correctly pass along Datadog headers", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: testPropConfig,
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, datadogTraceId, r.Header.Get("x-datadog-trace-id"))
								require.NotEqual(t, "6023947403358210776", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "1", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"x-datadog-trace-id":          {datadogTraceId},
						"x-datadog-parent-id":         {"6023947403358210776"},
						"x-datadog-sampling-priority": {"1"},
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)

				sn := exporter.GetSpans().Snapshots()
				require.GreaterOrEqual(t, len(sn), 1)
				require.Equal(t, "00000000000000008448eb211c80319c", sn[0].SpanContext().TraceID().String())
			})
		})

		t.Run("Doesn't propagate headers in datadog format if datadog config is not set", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)

			testenv.Run(t, &testenv.Config{
				TraceExporter:     exporter,
				PropagationConfig: config.PropagationConfig{Datadog: false},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								require.Equal(t, "", r.Header.Get("x-datadog-trace-id"))
								require.Equal(t, "", r.Header.Get("x-datadog-parent-id"))
								require.Equal(t, "", r.Header.Get("x-datadog-sampling-priority"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employees { id } }`,
					Header: map[string][]string{
						"traceparent": {"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203332-00"}, // 01 = sampled
					},
				})
				require.JSONEq(t, employeesIDData, res.Body)
			})
		})
	})

	t.Run("Trace ID Response header", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		customTraceHeader := "trace-id"

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			ResponseTraceHeader: config.ResponseTraceHeader{
				Enabled:    true,
				HeaderName: customTraceHeader,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Equal(t, sn[0].SpanContext().TraceID().String(), res.Response.Header.Get("trace-id"))
		})
	})

	t.Run("Trace ID Response header with default header name", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			ResponseTraceHeader: config.ResponseTraceHeader{
				Enabled:    true,
				HeaderName: "x-wg-trace-id",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()
			require.Equal(t, sn[0].SpanContext().TraceID().String(), res.Response.Header.Get("x-wg-trace-id"))
		})
	})

	t.Run("Custom client name and client version headers", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		customClientHeaderName := "client-name"
		customClientHeaderVersion := "client-version"

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			ClientHeader: config.ClientHeader{
				Name:    customClientHeaderName,
				Version: customClientHeaderVersion,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("client-name", "name")
			header.Add("client-version", "version")
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `query { employees { id } }`,
				Header: header,
			})
			require.JSONEq(t, employeesIDData, res.Body)

			sn := exporter.GetSpans().Snapshots()

			var clientName, clientVersion string
			for _, v := range sn[0].Attributes() {
				if v.Key == "wg.client.name" {
					clientName = v.Value.AsString()
				}
				if v.Key == "wg.client.version" {
					clientVersion = v.Value.AsString()
				}
			}
			require.Equal(t, "name", clientName)
			require.Equal(t, "version", clientVersion)
		})
	})

	t.Run("Custom Metric Attributes", func(t *testing.T) {

		t.Run("Custom attributes are added to all metrics / subgraph error", func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter(t)
			metricReader := metric.NewManualReader()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: "from_header",
						ValueFrom: &config.CustomDynamicAttribute{
							RequestHeader: "x-custom-header",
						},
					},
					{
						Key: "sha256",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationSha256,
						},
					},
					{
						Key: "error_codes",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorCodes,
						},
					},
					{
						Key: "error_services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldGraphQLErrorServices,
						},
					},
					{
						Key: "services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationServices,
						},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Products: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set("Content-Type", "application/json")
								w.WriteHeader(http.StatusForbidden)
								_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","path": ["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path": ["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}]}`))
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {"custom-value"},
					},
					Query: `query myQuery { employees { id details { forename surname } notes } }`,
				})
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","path":["foo"],"extensions":{"code":"UNAUTHORIZED"}},{"message":"MyErrorMessage","path":["bar"],"extensions":{"code":"YOUR_ERROR_CODE"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)

				/**
				* Traces
				 */

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 11, "expected 11 spans, got %d", len(sn))

				// No additional attributes are added to the spans

				/**
				* Metrics
				 */
				rm := metricdata.ResourceMetrics{}
				err := metricReader.Collect(context.Background(), &rm)
				require.NoError(t, err)

				require.Equal(t, 1, len(rm.ScopeMetrics), "expected 1 ScopeMetrics, got %d", len(rm.ScopeMetrics))
				require.Equal(t, 7, len(rm.ScopeMetrics[0].Metrics), "expected 7 Metrics, got %d", len(rm.ScopeMetrics[0].Metrics))

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
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
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
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Sum: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Sum: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
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
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 494,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									semconv.HTTPStatusCode(200),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 81,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 66,
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
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(200),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 863,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 177,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									semconv.HTTPStatusCode(200),
									otel.WgRequestError.Bool(true),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 1046,
							},
						},
					},
				}

				requestInFlightMetric := metricdata.Metrics{
					Name:        "router.http.requests.in_flight",
					Description: "Number of requests in flight",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("0"),
									otel.WgSubgraphName.String("employees"),
								),
								Value: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 0,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationProtocol.String("http"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Value: 0,
							},
						},
					},
				}

				operationPlanningTimeMetric := metricdata.Metrics{
					Name:        "router.graphql.operation.planning_time",
					Description: "Operation planning time in milliseconds",
					Unit:        "ms",
					Data: metricdata.Histogram[float64]{
						Temporality: metricdata.CumulativeTemporality,
						DataPoints: []metricdata.HistogramDataPoint[float64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									otel.WgEnginePlanCacheHit.Bool(false),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
								),
								Sum: 0,
							},
						},
					},
				}

				failedRequestsMetric := metricdata.Metrics{
					Name:        "router.http.requests.error",
					Description: "Total number of failed requests",
					Unit:        "",
					Data: metricdata.Sum[int64]{
						Temporality: metricdata.CumulativeTemporality,
						IsMonotonic: true,
						DataPoints: []metricdata.DataPoint[int64]{
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									semconv.HTTPStatusCode(403),
									otel.WgComponentName.String("engine-loader"),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgSubgraphID.String("3"),
									otel.WgSubgraphName.String("products"),
								),
								Value: 1,
							},
							{
								Attributes: attribute.NewSet(
									attribute.String("from_header", "custom-value"),
									attribute.String("sha256", "b0066f89f91315b4610ed127be677e6cea380494eb20c83cc121c97552ca44b2"),
									attribute.StringSlice("error_codes", []string{"UNAUTHORIZED", "YOUR_ERROR_CODE"}),
									attribute.StringSlice("services", []string{"employees", "products"}),
									attribute.StringSlice("error_services", []string{"products"}),
									otel.WgClientName.String("unknown"),
									otel.WgClientVersion.String("missing"),
									otel.WgFederatedGraphID.String("graph"),
									otel.WgOperationHash.String("16884868987896027258"),
									otel.WgOperationName.String("myQuery"),
									otel.WgOperationProtocol.String("http"),
									otel.WgOperationType.String("query"),
									otel.WgRouterClusterName.String(""),
									otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()),
									otel.WgRouterVersion.String("dev"),
									otel.WgRequestError.Bool(true),
								),
								Value: 1,
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
						operationPlanningTimeMetric,
						failedRequestsMetric,
					},
				}
				metricdatatest.AssertEqual(t, want, rm.ScopeMetrics[0], metricdatatest.IgnoreTimestamp(), metricdatatest.IgnoreValue())
			})
		})

		t.Run("Tracing is not affected by custom metric attributes", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				CustomMetricAttributes: []config.CustomAttribute{
					{
						Key: "from_header",
						ValueFrom: &config.CustomDynamicAttribute{
							RequestHeader: "x-custom-header",
						},
					},
					{
						Key: "services",
						ValueFrom: &config.CustomDynamicAttribute{
							ContextField: core.ContextFieldOperationServices,
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: map[string][]string{
						"x-custom-header": {"custom-value"},
					},
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, res.Body)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 9, "expected 9 spans, got %d", len(sn))

				/**
				* Spans
				 */

				// Pre-Handler Operation Read

				require.Equal(t, "HTTP - Read Body", sn[0].Name())
				require.Len(t, sn[0].Resource().Attributes(), 9)
				require.Len(t, sn[0].Attributes(), 7)

				require.Equal(t, "Operation - Parse", sn[1].Name())
				require.Len(t, sn[1].Resource().Attributes(), 9)
				require.Len(t, sn[1].Attributes(), 7)

				require.Equal(t, "Operation - Normalize", sn[2].Name())
				require.Len(t, sn[2].Resource().Attributes(), 9)
				require.Len(t, sn[2].Attributes(), 10)

				require.Equal(t, "Operation - Validate", sn[3].Name())
				require.Len(t, sn[3].Resource().Attributes(), 9)
				require.Len(t, sn[3].Attributes(), 11)

				require.Equal(t, "Operation - Plan", sn[4].Name())
				require.Len(t, sn[4].Resource().Attributes(), 9)
				require.Len(t, sn[4].Attributes(), 12)

				// Engine Transport
				require.Equal(t, "query unnamed", sn[5].Name())
				require.Len(t, sn[5].Resource().Attributes(), 9)
				require.Len(t, sn[5].Attributes(), 21)

				require.Equal(t, "Engine - Fetch", sn[6].Name())
				require.Len(t, sn[6].Resource().Attributes(), 9)
				require.Len(t, sn[6].Attributes(), 14)

				// GraphQL handler
				require.Equal(t, "Operation - Execute", sn[7].Name())
				require.Len(t, sn[7].Resource().Attributes(), 9)
				require.Len(t, sn[7].Attributes(), 11)

				// Root Server middleware
				require.Equal(t, "query unnamed", sn[8].Name())
				require.Len(t, sn[8].Resource().Attributes(), 9)
				require.Len(t, sn[8].Attributes(), 26)
			})
		})

	})
}
