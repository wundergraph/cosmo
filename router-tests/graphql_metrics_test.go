package integration

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

func TestGraphQLMetrics(t *testing.T) {
	t.Parallel()

	waitForMetrics := make(chan struct{})

	fakeGraphQLMetricsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		read, err := gzip.NewReader(r.Body)
		require.NoError(t, err)
		defer read.Close()

		data, err := io.ReadAll(read)
		require.NoError(t, err)

		switch r.URL.Path {
		case "/wg.cosmo.graphqlmetrics.v1.GraphQLMetricsService/PublishNormalizationCacheWarmupData":

			req := &graphqlmetrics.PublishNormalizationCacheWarmupDataRequest{}
			err := proto.Unmarshal(data, req)
			require.NoError(t, err)
			require.Len(t, req.Aggregation.Operations, 1)
			for _, v := range req.Aggregation.Operations {
				require.Len(t, v.VariableVariations, 1)
				for _, v := range v.VariableVariations {
					require.Len(t, v.VariableValues, 2)
					require.Equal(t, "include", v.VariableValues[0].Key)
					require.Equal(t, true, v.VariableValues[0].Value)
					require.Equal(t, "skip", v.VariableValues[1].Key)
					require.Equal(t, false, v.VariableValues[1].Value)
				}
			}

			res := &graphqlmetrics.PublishNormalizationCacheWarmupDataResponse{}
			out, err := proto.Marshal(res)
			require.NoError(t, err)

			w.Header().Set("Content-Type", "application/proto")
			_, err = w.Write(out)
			require.NoError(t, err)

			waitForMetrics <- struct{}{}

		case "/wg.cosmo.graphqlmetrics.v1.GraphQLMetricsService/PublishAggregatedGraphQLMetrics":

			req := &graphqlmetrics.PublishAggregatedGraphQLRequestMetricsRequest{}
			err := proto.Unmarshal(data, req)
			require.NoError(t, err)

			res := &graphqlmetrics.PublishAggregatedGraphQLRequestMetricsResponse{}
			out, err := proto.Marshal(res)
			require.NoError(t, err)

			w.Header().Set("Content-Type", "application/proto")
			_, err = w.Write(out)
			require.NoError(t, err)

			waitForMetrics <- struct{}{}
		}
	}))

	logger, err := zap.NewDevelopment()
	require.NoError(t, err)

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
				Enabled:           true,
				CollectorEndpoint: fakeGraphQLMetricsServer.URL,
				// we only expect 2 operations, so we can immediately send the data to keep the test as fast as possible
				BatchSize:     2,
				BatchInterval: time.Second,
			}),
			core.WithLogger(logger),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query IncludeQuery($include: Boolean!, $skip: Boolean!) {
					  employees {
						id
						details {
						  nationality
						  forename @include(if: $include)
						  surname @skip(if: $skip)
						}
					  }
					}`,
			Variables: json.RawMessage(`{"include": true, "skip": false}`),
		})
		require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"nationality":"GERMAN","forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"nationality":"AMERICAN","forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"nationality":"GERMAN","forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"nationality":"UKRAINIAN","forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"nationality":"INDIAN","forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"nationality":"INDIAN","forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"nationality":"DUTCH","forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"nationality":"GERMAN","forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"nationality":"ENGLISH","forename":"David","surname":"Stutt"}}]}}`, res.Body)
		res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query IncludeQuery($include: Boolean!, $skip: Boolean!) {
					  employees {
						id
						details {
						  nationality
						  forename @include(if: $include)
						  surname @skip(if: $skip)
						}
					  }
					}`,
			Variables: json.RawMessage(`{"skip": false, "include": true}`),
		})
		require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"nationality":"GERMAN","forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"nationality":"GERMAN","forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"nationality":"AMERICAN","forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"nationality":"GERMAN","forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"nationality":"UKRAINIAN","forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"nationality":"INDIAN","forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"nationality":"INDIAN","forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"nationality":"DUTCH","forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"nationality":"GERMAN","forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"nationality":"ENGLISH","forename":"David","surname":"Stutt"}}]}}`, res.Body)
	})

	timeout := time.After(5 * time.Second)

	for i := 0; i < 2; i++ {
		select {
		case <-waitForMetrics:
		case <-timeout:
			t.Fatal("timeout waiting for metrics")
		}
	}
}
