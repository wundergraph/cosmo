package integration

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"google.golang.org/protobuf/proto"
)

func TestGraphQLMetrics(t *testing.T) {
	t.Parallel()

	waitForMetrics := make(chan struct{})

	var (
		data    []byte
		request graphqlmetrics.PublishAggregatedGraphQLRequestMetricsRequest
	)

	fakeGraphQLMetricsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		read, err := gzip.NewReader(r.Body)
		require.NoError(t, err)
		defer read.Close()

		data, err = io.ReadAll(read)
		require.NoError(t, err)

		res := &graphqlmetrics.PublishAggregatedGraphQLRequestMetricsResponse{}
		out, err := proto.Marshal(res)
		require.NoError(t, err)

		w.Header().Set("Content-Type", "application/proto")
		_, err = w.Write(out)
		require.NoError(t, err)

		close(waitForMetrics)
	}))

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
				Enabled:           true,
				CollectorEndpoint: fakeGraphQLMetricsServer.URL,
			}),
			//core.WithAwsLambdaRuntime(),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)

		res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
	})

	select {
	case <-waitForMetrics:
	case <-time.After(60 * time.Second):
		t.Fatal("timeout waiting for metrics")
	}
	err := proto.Unmarshal(data, &request)
	require.NoError(t, err)
	require.Len(t, request.Aggregation, 1)
	require.Equal(t, uint64(2), request.Aggregation[0].RequestCount)
	require.Equal(t, "{employees {id}}", request.Aggregation[0].SchemaUsage.RequestDocument)
	require.Equal(t, int32(200), request.Aggregation[0].SchemaUsage.RequestInfo.StatusCode)
	require.Equal(t, "1163600561566987607", request.Aggregation[0].SchemaUsage.OperationInfo.Hash)
	require.Equal(t, graphqlmetrics.OperationType_QUERY, request.Aggregation[0].SchemaUsage.OperationInfo.Type)
	require.Len(t, request.Aggregation[0].SchemaUsage.TypeFieldMetrics, 2)
	require.Equal(t, []string{"employees"}, request.Aggregation[0].SchemaUsage.TypeFieldMetrics[0].Path)
}
