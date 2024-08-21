package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/buger/jsonparser"
	"github.com/wundergraph/cosmo/router/core"

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
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "2267510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, "MISS", res.Response.Header.Get(core.ExecutionPlanCacheHeader))

		header = make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "2267510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, "MISS", res.Response.Header.Get(core.ExecutionPlanCacheHeader))

		header = make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "2267510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, "HIT", res.Response.Header.Get(core.ExecutionPlanCacheHeader))
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

func TestPersistedOperationCacheWithVariables(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "2267510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator","class":"REPTILE","dangerous":"yes","gender":"UNKNOWN"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "2267510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator","class":"REPTILE","dangerous":"yes","gender":"UNKNOWN"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "2267510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "2267510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "3367510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"id":3,"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "3367510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"id":4,"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "3367510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"id":4,"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "4467510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "4467510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "4467510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false,"id":3}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}}}}`, res.Body)
	})
}

func TestPersistedOperationsWithNestedVariablesExtraction(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "nestedVariableExtraction"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"a"}]}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "nestedVariableExtraction"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"a"}]}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "nestedVariableExtraction"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":"b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"b"}]}}`, res.Body)
	})
}

func TestPersistedOperationCacheWithVariablesAndDefaultValues(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "skipVariableWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "skipVariableWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "skipVariableWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":false}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens"}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "skipVariableWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":false}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens"}}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "skipVariableWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "skipVariableWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
	})
}

func TestPersistedOperationCacheWithVariablesCoercion(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
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
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQuery"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQuery"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["b"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQueryWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQueryWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQueryWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["b"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "listArgQueryWithDefault"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": ["c"]}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["c"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))

		// nested list of enums
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "nestedEnum"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":{"enums":"A"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"A"}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "nestedEnum"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":{"enums":"B"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"B"}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
	})
}

func BenchmarkPersistedOperationCacheEnabled(b *testing.B) {
	expected := `{"data":{"employees":[{"details":{"forename":"Jens","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"Dustin","hasChildren":false,"location":{"key":{"name":"Germany"}},"maritalStatus":"ENGAGED","middlename":"Klaus","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Deus"}},{"details":{"forename":"Stefan","hasChildren":false,"location":{"key":{"name":"America"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"AMERICAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"REPTILE","gender":"UNKNOWN","name":"Snappy","__typename":"Alligator","dangerous":"yes"}],"surname":"Avram"}},{"details":{"forename":"Björn","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"Volker","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER"},{"class":"MAMMAL","gender":"MALE","name":"Survivor","__typename":"Pony"}],"surname":"Schwenzer"}},{"details":{"forename":"Sergiy","hasChildren":false,"location":{"key":{"name":"Ukraine"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"UKRAINIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Blotch","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Grayone","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Rusty","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Manya","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Peach","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Panda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Mommy","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Terry","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Tilda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Vasya","__typename":"Cat","type":"HOME"}],"surname":"Petrunin"}},{"details":{"forename":"Suvij","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Surya"}},{"details":{"forename":"Nithin","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Kumar"}},{"details":{"forename":"Eelco","hasChildren":false,"location":{"key":{"name":"Netherlands"}},"maritalStatus":null,"middlename":"","nationality":"DUTCH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"UNKNOWN","name":"Vanson","__typename":"Mouse"}],"surname":"Wiersma"}},{"details":{"forename":"Alexandra","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"David","hasChildren":false,"location":{"key":{"name":"England"}},"maritalStatus":"MARRIED","middlename":null,"nationality":"ENGLISH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Pepper","__typename":"Cat","type":"HOME"}],"surname":"Stutt"}}]}}`

	b.ReportAllocs()
	b.SetBytes(int64(len(expected)))
	b.ResetTimer()

	testenv.Bench(b, &testenv.Config{}, func(b *testing.B, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
		})
		if err != nil {
			b.Fatal(err)
		}
		if res.Body != expected {
			b.Fatalf("unexpected response: %s", res.Body)
		}
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				if err != nil {
					b.Fatal(err)
				}
				if res.Body != expected {
					b.Fatalf("unexpected response: %s", res.Body)
				}
			}
		})
	})
}

func BenchmarkPersistedOperationCacheDisabled(b *testing.B) {
	expected := `{"data":{"employees":[{"details":{"forename":"Jens","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"Dustin","hasChildren":false,"location":{"key":{"name":"Germany"}},"maritalStatus":"ENGAGED","middlename":"Klaus","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Deus"}},{"details":{"forename":"Stefan","hasChildren":false,"location":{"key":{"name":"America"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"AMERICAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"REPTILE","gender":"UNKNOWN","name":"Snappy","__typename":"Alligator","dangerous":"yes"}],"surname":"Avram"}},{"details":{"forename":"Björn","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"Volker","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER"},{"class":"MAMMAL","gender":"MALE","name":"Survivor","__typename":"Pony"}],"surname":"Schwenzer"}},{"details":{"forename":"Sergiy","hasChildren":false,"location":{"key":{"name":"Ukraine"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"UKRAINIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Blotch","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Grayone","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Rusty","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Manya","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Peach","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Panda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Mommy","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Terry","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Tilda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Vasya","__typename":"Cat","type":"HOME"}],"surname":"Petrunin"}},{"details":{"forename":"Suvij","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Surya"}},{"details":{"forename":"Nithin","hasChildren":false,"location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Kumar"}},{"details":{"forename":"Eelco","hasChildren":false,"location":{"key":{"name":"Netherlands"}},"maritalStatus":null,"middlename":"","nationality":"DUTCH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"UNKNOWN","name":"Vanson","__typename":"Mouse"}],"surname":"Wiersma"}},{"details":{"forename":"Alexandra","hasChildren":true,"location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"David","hasChildren":false,"location":{"key":{"name":"England"}},"maritalStatus":"MARRIED","middlename":null,"nationality":"ENGLISH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Pepper","__typename":"Cat","type":"HOME"}],"surname":"Stutt"}}]}}`

	b.ReportAllocs()
	b.SetBytes(int64(len(expected)))
	b.ResetTimer()

	testenv.Bench(b, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnablePersistedOperationsCache = false
		},
	}, func(b *testing.B, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
			Header:        header,
		})
		if err != nil {
			b.Fatal(err)
		}
		if res.Body != expected {
			b.Fatalf("unexpected response: %s", res.Body)
		}
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					OperationName: []byte(`"Employees"`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
					Header:        header,
				})
				if err != nil {
					b.Fatal(err)
				}
				if res.Body != expected {
					b.Fatalf("unexpected response: %s", res.Body)
				}
			}
		})
	})
}
