package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/buger/jsonparser"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestPersistedOperationNotFound(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "does-not-exist"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
		require.Equal(t, `{"errors":[{"message":"persisted Query not found"}],"data":null}`, res.Body)
	})
}

func TestPersistedOperation(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
	})
}

func TestPersistedOperationWithBlock(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
			securityConfiguration.BlockNonPersistedOperations = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
	})
}

func TestPersistedOperationPOExtensionNotTransmittedToSubgraph(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")

						data, err := io.ReadAll(r.Body)
						require.NoError(t, err)

						_, dt, _, _ := jsonparser.Get(data, "extensions", "persistedQuery")
						require.Equal(t, jsonparser.NotExist, dt)

						_, _ = w.Write([]byte(`{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
	})
}

func TestPersistedOperationsCache(t *testing.T) {
	t.Parallel()

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
		require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res1.Body)
		res2, err := xEnv.MakeGraphQLRequest(req)
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res2.Body)
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
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			sendTwoRequests(t, xEnv)
			numberOfCDNRequests := retrieveNumberOfCDNRequests(t, xEnv.CDN.URL)
			require.Equal(t, 1, numberOfCDNRequests)
		})
	})

	t.Run("without cache", func(t *testing.T) {
		t.Parallel()

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
