package integration

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.19.0"
	"go.opentelemetry.io/otel/trace"
)

func TestBatch(t *testing.T) {
	t.Run("verify batching", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				entries := getBatchedEntriesForLength(t, res.Body, 2)
				expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected2 := `{"data":{"employees":[{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false}]}}`
				require.Equal(t, expected1, entries[0])
				require.Equal(t, expected2, entries[1])
			},
		)
	})

	t.Run("verify batching request when batching is not enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            false,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.JSONEq(t, `{"errors":[{"message":"error parsing request body"}]}`, res.Body)
			},
		)
	})

	t.Run("send batch request over max allowed count validate trace", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)
		defer exporter.Reset()

		testenv.Run(t,
			&testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 5,
					OmitExtensions:     true,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				sn := exporter.GetSpans().Snapshots()
				rootSpan := sn[len(sn)-1]

				events := rootSpan.Events()
				require.Len(t, events, 1)
				event := events[0]
				require.Equal(t, "exception", event.Name)

				require.Equal(t, event.Attributes[0], attribute.String("exception.type", "*core.httpGraphqlError"))
				require.Equal(t, trace.SpanKindServer, rootSpan.SpanKind())
				require.Contains(t, rootSpan.Attributes(), otel.WgRouterRootSpan.Bool(true))
				require.Equal(t, codes.Error, rootSpan.Status().Code)
				require.Contains(t, rootSpan.Status().Description, "Invalid GraphQL request")
			},
		)
	})

	t.Run("send batch request over max allowed count with omit extensions true", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 5,
					OmitExtensions:     true,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, "application/json; charset=utf-8", res.Response.Header.Get("Content-Type"))
				require.JSONEq(t, `{"errors":[{"message":"Invalid GraphQL request"}]}`, res.Body)
			},
		)
	})

	t.Run("send batch request over max allowed count with omit extensions false", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 5,
					OmitExtensions:     false,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, "application/json; charset=utf-8", res.Response.Header.Get("Content-Type"))
				require.JSONEq(t, `{"errors":[{"message":"Invalid GraphQL request","extensions":{"code":"BATCH_LIMIT_EXCEEDED"}}]}`, res.Body)
			},
		)
	})

	t.Run("attempt to start server with invalid max concurrent", func(t *testing.T) {
		t.Parallel()

		err := testenv.RunWithError(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     0,
				MaxEntriesPerBatch: 100,
			},
		}, func(t *testing.T, _ *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.Error(t, err, "maxConcurrent must be greater than 0")
	})

	t.Run("attempt to start server with invalid max entries per batch", func(t *testing.T) {
		t.Parallel()

		err := testenv.RunWithError(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     10,
				MaxEntriesPerBatch: 0,
			},
		}, func(t *testing.T, _ *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.Error(t, err, "maxEntriesPerBatch must be greater than 0")
	})

	t.Run("prevent running a subscription with omit extensions false", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
					OmitExtensions:     false,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `subscription SubscriptionSuccess { countEmp2(max: 3, intervalMilliseconds: 500) }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				entries := getBatchedEntriesForLength(t, res.Body, 2)
				expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected2 := `{"errors":[{"message":"Subscriptions aren't supported in batch operations","extensions":{"code":"BATCHING_SUBSCRIPTION_UNSUPPORTED"}}]}`
				require.Equal(t, expected1, entries[0])
				require.Equal(t, expected2, entries[1])
			},
		)
	})

	t.Run("prevent running a subscription with omit extensions true", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
					OmitExtensions:     true,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `subscription SubscriptionSuccess { countEmp2(max: 3, intervalMilliseconds: 500) }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				entries := getBatchedEntriesForLength(t, res.Body, 2)
				expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected2 := `{"errors":[{"message":"Subscriptions aren't supported in batch operations"}]}`
				require.Equal(t, expected1, entries[0])
				require.Equal(t, expected2, entries[1])
			},
		)
	})

	t.Run("run a mutation in a batch request", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)

		testenv.Run(t,
			&testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, false)),
				},
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				token, err := authServer.Token(map[string]any{
					"scope": "write:fact read:miscellaneous read:all",
				})
				require.NoError(t, err)
				headers := map[string]string{"Authorization": "Bearer " + token}
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: "mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }",
					},
					{
						Query: `query employees { employees { id } }`,
					},
				}, headers)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				entries := getBatchedEntriesForLength(t, res.Body, 3)
				expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected2 := `{"data":{"addFact":{"title":"title","description":"description"}}}`
				expected3 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				require.Equal(t, expected1, entries[0])
				require.Equal(t, expected2, entries[1])
				require.Equal(t, expected3, entries[2])
			},
		)
	})

	t.Run("verify batching with operation causing errors", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employee { employees2 { id } }`,
					},
					{
						Query: `query employee { employees { id } }`,
					},
					{
						Query: `query employee { employee(id: "4") { id, isAvailable } }`,
					},
				}, nil)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				entries := getBatchedEntriesForLength(t, res.Body, 3)
				expected1 := `{"errors":[{"message":"Cannot query field \"employees2\" on type \"Query\".","path":["query"]}]}`
				expected2 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected3 := `{"errors":[{"message":"Variable \"$a\" got invalid value \"4\"; Int cannot represent non-integer value: \"4\""}]}`
				require.Equal(t, expected1, entries[0])
				require.Equal(t, expected2, entries[1])
				require.Equal(t, expected3, entries[2])
			},
		)
	})

	t.Run("checked passthrough errors on batch requests", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     10,
				MaxEntriesPerBatch: 100,
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
				{
					Query: `query employee { employees { id } }`,
				},
				{
					Query: `query employee { employees { notes } }`,
				},
				{
					Query: `query employee { employee(id: "5") { id, isAvailable } }`,
				},
			}, nil)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)

			entries := getBatchedEntriesForLength(t, res.Body, 3)
			expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
			expected2 := `{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED","statusCode":403}}],"data":{"employees":[{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null}]}}`
			expected3 := `{"errors":[{"message":"Variable \"$a\" got invalid value \"5\"; Int cannot represent non-integer value: \"5\""}]}`
			require.Equal(t, expected1, entries[0])
			require.Equal(t, expected2, entries[1])
			require.Equal(t, expected3, entries[2])
		})
	})

	t.Run("checked wrapped errors on batch requests", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     10,
				MaxEntriesPerBatch: 100,
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
				{
					Query: `query employee { employees { id } }`,
				},
				{
					Query: `query employee { employees { notes } }`,
				},
				{
					Query: `query employee { employee(id: "5") { id, isAvailable } }`,
				},
			}, nil)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)

			entries := getBatchedEntriesForLength(t, res.Body, 3)
			expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
			expected2 := `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null}]}}`
			expected3 := `{"errors":[{"message":"Variable \"$a\" got invalid value \"5\"; Int cannot represent non-integer value: \"5\""}]}`
			require.Equal(t, expected1, entries[0])
			require.Equal(t, expected2, entries[1])
			require.Equal(t, expected3, entries[2])
		})
	})

	t.Run("check when start character is [ and request body is malformed", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)
		defer exporter.Reset()

		testenv.Run(t,
			&testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 5,
					OmitExtensions:     false,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				malformedRequestBody := `[{}`
				req, err := http.NewRequestWithContext(
					xEnv.Context,
					http.MethodPost,
					xEnv.GraphQLRequestURL(),
					bytes.NewReader([]byte(malformedRequestBody)),
				)
				require.NoError(t, err)

				res, err := xEnv.MakeGraphQLRequestRaw(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.JSONEq(t, `{"errors":[{"message":"failed to read request body"}]}`, res.Body)

				sn := exporter.GetSpans().Snapshots()
				rootSpan := sn[len(sn)-1]

				events := rootSpan.Events()
				require.Len(t, events, 1)
				event := events[0]
				require.Equal(t, "exception", event.Name)

				require.Equal(t, event.Attributes[0], attribute.String("exception.type", "*core.httpGraphqlError"))
				require.Equal(t, trace.SpanKindServer, rootSpan.SpanKind())

				require.Equal(t, codes.Error, rootSpan.Status().Code)
				require.Contains(t, rootSpan.Status().Description, "failed to read request body")
			},
		)
	})

	t.Run("Batch Tracing", func(t *testing.T) {
		t.Parallel()

		t.Run("Verify primary root span attributes for batch request", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				operations := []testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}
				_, err := xEnv.MakeGraphQLBatchedRequestRequest(operations, nil)
				require.NoError(t, err)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 29)
				rootSpan := sn[len(sn)-1]

				rootSpanAttributes := rootSpan.Attributes()
				require.Contains(t, rootSpanAttributes, otel.WgRouterConfigVersion.String(xEnv.RouterConfigVersionMain()))
				require.Contains(t, rootSpanAttributes, otel.WgRouterRootSpan.Bool(true))
				require.Contains(t, rootSpanAttributes, otel.WgIsBatchingOperation.Bool(true))
				require.Contains(t, rootSpanAttributes, otel.WgBatchingOperationsCount.Int(len(operations)))

				require.Contains(t, rootSpanAttributes, otel.WgOperationHash.String("12924042114100782429"))
				require.Contains(t, rootSpanAttributes, otel.WgClientName.String("unknown"))
				require.Contains(t, rootSpanAttributes, otel.WgClientVersion.String("missing"))
			})
		})

		t.Run("Verify all root span attributes for batch requests", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				operations := []testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `query employee { employees { isAvailable } }`,
					},
				}
				_, err := xEnv.MakeGraphQLBatchedRequestRequest(operations, nil)
				require.NoError(t, err)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 29)
				rootSpan := sn[len(sn)-1]

				rootSpanAttributes := rootSpan.Attributes()
				require.Len(t, rootSpanAttributes, 24)

				sa := attribute.NewSet(rootSpanAttributes...)
				require.True(t, sa.HasValue(semconv.NetHostPortKey))
				require.True(t, sa.HasValue(semconv.NetSockPeerAddrKey))
				require.True(t, sa.HasValue(semconv.NetSockPeerPortKey))
				require.True(t, sa.HasValue("http.user_agent"))
				require.True(t, sa.HasValue("http.host"))
				require.True(t, sa.HasValue("http.read_bytes"))
				require.True(t, sa.HasValue("http.wrote_bytes"))
				require.True(t, sa.HasValue(otel.WgRouterConfigVersion))
				require.True(t, sa.HasValue(otel.WgFederatedGraphID))

				require.Contains(t, rootSpanAttributes, semconv.HTTPMethod("POST"))
				require.Contains(t, rootSpanAttributes, semconv.HTTPScheme("http"))
				require.Contains(t, rootSpanAttributes, semconv.HTTPFlavorKey.String("1.1"))
				require.Contains(t, rootSpanAttributes, semconv.NetHostName("localhost"))
				require.Contains(t, rootSpanAttributes, semconv.HTTPTarget("/graphql"))
				require.Contains(t, rootSpanAttributes, semconv.HTTPStatusCode(200))

				require.Contains(t, rootSpanAttributes, otel.WgComponentName.String("router-server"))
				require.Contains(t, rootSpanAttributes, otel.WgRouterVersion.String("dev"))
				require.Contains(t, rootSpanAttributes, otel.WgRouterClusterName.String(""))

				require.Contains(t, rootSpanAttributes, otel.WgRouterRootSpan.Bool(true))
				require.Contains(t, rootSpanAttributes, otel.WgIsBatchingOperation.Bool(true))
				require.Contains(t, rootSpanAttributes, otel.WgBatchingOperationsCount.Int(len(operations)))
				require.Contains(t, rootSpanAttributes, otel.WgOperationHash.String("12924042114100782429"))
				require.Contains(t, rootSpanAttributes, otel.WgClientName.String("unknown"))
				require.Contains(t, rootSpanAttributes, otel.WgClientVersion.String("missing"))
			})
		})

		t.Run("Verify the span of the batch operations", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			defer exporter.Reset()

			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrency:     10,
					MaxEntriesPerBatch: 100,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				spanNames := []string{
					"query employees1",
					"query employees2",
					"query employees3",
				}
				operationIds := []string{
					"batch-operation-0",
					"batch-operation-1",
					"batch-operation-2",
				}
				operations := []testenv.GraphQLRequest{
					{
						Query: spanNames[0] + ` { employees { id } }`,
					},
					{
						Query: spanNames[1] + ` { employees { id } }`,
					},
					{
						Query: spanNames[2] + ` { employees { isAvailable } }`,
					},
				}
				_, err := xEnv.MakeGraphQLBatchedRequestRequest(operations, nil)
				require.NoError(t, err)

				sn := exporter.GetSpans().Snapshots()
				require.Len(t, sn, 29)
				rootSpan := sn[len(sn)-1]

				rootSpanChildSpanCount := rootSpan.ChildSpanCount()
				require.Equal(t, rootSpanChildSpanCount, len(operations))

				directChildSpans := getRootDirectChildSpans(rootSpan, rootSpanChildSpanCount, sn)
				require.Len(t, directChildSpans, rootSpanChildSpanCount)

				retrievedSpanNames, operationNumberAttrs := getChildSpanDetails(directChildSpans)

				require.ElementsMatch(t, operationNumberAttrs, operationIds)
				require.ElementsMatch(t, retrievedSpanNames, spanNames)
			})
		})
	})

	t.Run("check batch request with gzip compression", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     10,
				MaxEntriesPerBatch: 100,
			},
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes:  5 << 20, // 5MiB
					DecompressionEnabled: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "write:fact read:miscellaneous read:all",
			})
			require.NoError(t, err)

			header := http.Header{
				"Content-Type":     []string{"application/json"},
				"Accept":           []string{"application/json"},
				"Content-Encoding": []string{"gzip"},
				"Authorization":    []string{"Bearer " + token},
			}

			body := []byte(
				`[
					{"query":"query Sauce {    employees {    id  }  }","operationName":"Sauce"},
					{"query":"mutation Testing { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }", "operationName": "Testing"},
					{"query":"query Sauce {    employees {    id  }  }","operationName":"Sauce"}
				]`)

			var builder strings.Builder
			gzBody := gzip.NewWriter(&builder)
			defer func() {}()

			_, err = gzBody.Write(body)
			require.NoError(t, err)
			require.NoError(t, gzBody.Close())

			res, err := xEnv.MakeRequest("POST", "/graphql", header, strings.NewReader(builder.String()))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			b, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			expectedString := `[{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}},{"data":{"addFact":{"title":"title","description":"description"}}},{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}]`
			require.JSONEq(t, expectedString, string(b))
		})
	})

}

func getChildSpanDetails(directChildSpans []sdktrace.ReadOnlySpan) ([]string, []string) {
	var operationNumberAttrs = make([]string, 0, len(directChildSpans))
	var retrievedSpanNames = make([]string, 0, len(directChildSpans))
	for _, span := range directChildSpans {
		attributes := span.Attributes()
		retrievedSpanNames = append(retrievedSpanNames, span.Name())
		for _, attr := range attributes {
			if attr.Key == otel.WgBatchingOperationIndex {
				operationNumberAttrs = append(operationNumberAttrs, attr.Value.AsString())
			}
		}
	}
	return retrievedSpanNames, operationNumberAttrs
}

func getRootDirectChildSpans(rootSpan sdktrace.ReadOnlySpan, rootSpanChildSpanCount int, sn []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
	rootSpanID := rootSpan.SpanContext().SpanID()
	directChildSpans := make([]sdktrace.ReadOnlySpan, 0, rootSpanChildSpanCount)
	for _, spanEntry := range sn {
		if spanEntry.Parent().SpanID() == rootSpanID {
			directChildSpans = append(directChildSpans, spanEntry)
		}
	}
	return directChildSpans
}

func getBatchedEntriesForLength(t *testing.T, body string, expectedLength int) []string {
	t.Helper()
	var rawMessages []json.RawMessage
	if err := json.Unmarshal([]byte(body), &rawMessages); err != nil {
		require.Fail(t, "failed to unmarshal batched response", err)
	}

	rawStrings := make([]string, len(rawMessages))
	for i, msg := range rawMessages {
		rawStrings[i] = string(msg)
	}

	require.Len(t, rawStrings, expectedLength)
	return rawStrings
}
