package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestPersistedOperationNotFound(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "does-not-exist"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
		require.JSONEq(t, `{"data": null, "errors": [{ "message": "PersistedQueryNotFound" }]}`, res.Body)
	})
}

func TestPersistedOperation(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
		})
		require.NoError(t, err)
		require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
	})
}

func TestPersistedOperationsCache(t *testing.T) {

	sendTwoRequests := func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		req := testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
		}
		res1, err := xEnv.MakeGraphQLRequest(req)
		require.NoError(t, err)
		require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res1.Body)
		res2, err := xEnv.MakeGraphQLRequest(req)
		require.NoError(t, err)
		require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res2.Body)
	}

	retrieveNumberOfCDNRequests := func(t *testing.T, cdnURL string) int {
		requestLogResp, err := http.Get(cdnURL)
		require.NoError(t, err)
		defer requestLogResp.Body.Close()
		var requestLog []string
		if err := json.NewDecoder(requestLogResp.Body).Decode(&requestLog); err != nil {
			t.Fatal(err)
		}
		return len(requestLog)
	}

	t.Run("with cache", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			sendTwoRequests(t, xEnv)
			numberOfCDNRequests := retrieveNumberOfCDNRequests(t, xEnv.CDN.URL)
			require.Equal(t, 1, numberOfCDNRequests)
		})
	})

	t.Run("without cache", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifyCDNConfig: func(cfg *config.CDNConfiguration) {
				cfg.CacheSize = 0
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			sendTwoRequests(t, xEnv)
			numberOfCDNRequests := retrieveNumberOfCDNRequests(t, xEnv.CDN.URL)
			require.Equal(t, 2, numberOfCDNRequests)
		})
	})
}
