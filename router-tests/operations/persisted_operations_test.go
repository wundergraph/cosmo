package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/buger/jsonparser"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/core"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// cacheHashNotStored is a constant representing a non-existent entry in Persisted Queries Cache
// of the testenv. All the pre-stored persistent entries used in testing are located here:
// ./testenv/testdata/cdn/organization/graph/operations/my-client
const cacheHashNotStored = "0000000000000000000000000000000000000000000000000000000000000000"

func TestPersistedOperationNotFound(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + cacheHashNotStored + `"}}`),
		})
		require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
		require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
	})
}

func TestPersistedOperationInvalidHash(t *testing.T) {
	t.Parallel()

	malformed := []string{
		"malformed",
		"some-words-free-style-not-allowed",
		"../../../path/not/ok",
		// too short
		strings.Repeat("0", 63),
		strings.Repeat("0", 62),
		"0000",
		"0",
		"",
		// too long
		strings.Repeat("0", 74),
		strings.Repeat("0", 65),
		// 1 bad character spoils everything
		"0000000000000z00000000000000000000000000000000000000000000000000",
		"0000000000000000000000000000000000000z00000000000000000000000000",
		"000000000000000000000000000000000000000000000000000000000000000z",
	}
	for _, hash := range malformed {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + hash + `"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
			require.Equal(t, `{"errors":[{"message":"invalid request body: persistedQuery does not have a valid sha256 hash"}]}`, res.Body)
		})
	}
}

func TestPersistedOperation(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "9015ddfadd802bb378a14e48cea51e9bf9a07c7f8a71d85c56d7b104fea84937"}}`),
			Header:        header,
		})
		require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
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
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "9015ddfadd802bb378a14e48cea51e9bf9a07c7f8a71d85c56d7b104fea84937"}}`),
			Header:        header,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
	})
}

func TestPersistedNormalizationCacheWithMultiOperationDocument(t *testing.T) {
	t.Parallel()

	t.Run("Should identify correct document after removing unused operations during normalization", func(t *testing.T) {

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"A"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "724399f210ef3f16e6e5427a70bb9609ecea7297e99c3e9241d5912d04eabe60"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"a":{"id":1,"details":{"pets":null}}}}`, res.Body)
			require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, "MISS", res.Response.Header.Get(core.ExecutionPlanCacheHeader))

			header = make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"A"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "724399f210ef3f16e6e5427a70bb9609ecea7297e99c3e9241d5912d04eabe60"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"a":{"id":1,"details":{"pets":null}}}}`, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.ExecutionPlanCacheHeader))

			header = make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"B"`),
				Variables:     []byte(`{"id": 1}`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "724399f210ef3f16e6e5427a70bb9609ecea7297e99c3e9241d5912d04eabe60"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"b":{"id":1,"details":{"pets":null}}}}`, res.Body)
			require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, "MISS", res.Response.Header.Get(core.ExecutionPlanCacheHeader))

			header = make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"B"`),
				Variables:     []byte(`{"id": 1}`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "724399f210ef3f16e6e5427a70bb9609ecea7297e99c3e9241d5912d04eabe60"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"b":{"id":1,"details":{"pets":null}}}}`, res.Body)
			require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
			require.Equal(t, "HIT", res.Response.Header.Get(core.ExecutionPlanCacheHeader))
		})
	})
}

func TestPersistedOperationsCache(t *testing.T) {
	t.Parallel()

	sendTwoRequests := func(t *testing.T, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
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
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
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
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, "HIT", res.Response.Header.Get(core.ExecutionPlanCacheHeader))

		header = make(http.Header)
		header.Add("graphql-client-name", "not-my-client")
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
		require.Equal(t, "", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, "", res.Response.Header.Get(core.ExecutionPlanCacheHeader))
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
			require.Equal(t, 2, numberOfCDNRequests)
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
			require.Equal(t, 3, numberOfCDNRequests)
		})
	})
}

func TestPersistedOperationsCacheMixedCallsWithSafeList(t *testing.T) {
	t.Parallel()

	expectedData := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

	sendViaBody := func(t *testing.T, xEnv *testenv.Environment, expectedCacheHeaderValue string) {
		t.Helper()
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Query:         "query Employees {\n  employees {\n    id\n    }\n}",
			Header:        header,
		})
		require.NoError(t, err)
		require.Equal(t, expectedData, res.Body)
		require.Equal(t, expectedCacheHeaderValue, res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, expectedCacheHeaderValue, res.Response.Header.Get(core.ExecutionPlanCacheHeader))
	}

	sendViaHash := func(t *testing.T, xEnv *testenv.Environment, expectedCacheHeaderValue string) {
		t.Helper()
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "9015ddfadd802bb378a14e48cea51e9bf9a07c7f8a71d85c56d7b104fea84937"}}`),
			Header:     header,
		})
		require.NoError(t, err)
		require.Equal(t, expectedData, res.Body)
		require.Equal(t, expectedCacheHeaderValue, res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, expectedCacheHeaderValue, res.Response.Header.Get(core.ExecutionPlanCacheHeader))
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

	t.Run("first via body, second via hash", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{
						Enabled: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			sendViaBody(t, xEnv, "MISS")
			sendViaHash(t, xEnv, "HIT")
			sendViaBody(t, xEnv, "HIT")
			numberOfCDNRequests := retrieveNumberOfCDNRequests(t, xEnv.CDN.URL)
			require.Equal(t, 1, numberOfCDNRequests)
		})
	})

	t.Run("first via hash, following via body - with fs provider", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					FileSystem: []config.FileSystemStorageProvider{
						{
							ID:   "fs-cdn",
							Path: "../testenv/testdata/cdn/organization/graph/operations",
						},
					},
				}),
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					Safelist: config.SafelistConfiguration{
						Enabled: true,
					},
					Storage: config.PersistedOperationsStorageConfig{
						ProviderID:   "fs-cdn",
						ObjectPrefix: "my-client",
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			sendViaHash(t, xEnv, "MISS")
			sendViaBody(t, xEnv, "HIT")
			sendViaBody(t, xEnv, "HIT")
			numberOfCDNRequests := retrieveNumberOfCDNRequests(t, xEnv.CDN.URL)
			require.Equal(t, 0, numberOfCDNRequests)
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
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator","class":"REPTILE","dangerous":"yes","gender":"UNKNOWN"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator","class":"REPTILE","dangerous":"yes","gender":"UNKNOWN"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ae568d0762d13e0c10fa2a1343fb6233dbb3ff9132c42cb4aede828d57cbaa41"}}`),
			Header:        header,
			Variables:     []byte(`{"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "6b65c52ed847b8bd573927996913a8516a230fe27fe1bbc8239dd2facaba95d0"}}`),
			Header:        header,
			Variables:     []byte(`{"id":3,"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "6b65c52ed847b8bd573927996913a8516a230fe27fe1bbc8239dd2facaba95d0"}}`),
			Header:        header,
			Variables:     []byte(`{"id":4,"withAligators": false,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "6b65c52ed847b8bd573927996913a8516a230fe27fe1bbc8239dd2facaba95d0"}}`),
			Header:        header,
			Variables:     []byte(`{"id":4,"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "79b4aed4b6442e3ffc14e47a648fda7e90c69d020ed50c288152dd3ba25a576c"}}`),
			Header:        header,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "79b4aed4b6442e3ffc14e47a648fda7e90c69d020ed50c288152dd3ba25a576c"}}`),
			Header:        header,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "79b4aed4b6442e3ffc14e47a648fda7e90c69d020ed50c288152dd3ba25a576c"}}`),
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
		nestedVariableExtraction := "ba68efe9c44f415ed5af168f39a01fcb1ac11280e507fff0610c9cc533b461b7"
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nestedVariableExtraction + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"a"}]}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nestedVariableExtraction + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"a"}]}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nestedVariableExtraction + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":"b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"b"}]}}`, res.Body)
	})
}

func TestPersistedOperationCacheWithVariablesAndDefaultValues(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		skipVariableWithDefault := "0e77273273405d787611ff60755c97f9e9de86879723253d6df7b2a03d9d7a26"
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + skipVariableWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + skipVariableWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + skipVariableWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":false}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens"}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + skipVariableWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":false}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens"}}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + skipVariableWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + skipVariableWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{"yes":true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
	})
}

func TestPersistedOperationCacheWithVariablesCoercion(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		listArgQuery := "f78a19e2e525a86dfa1beb3a45d1654b74c461e524cdff350721bc4cc1cea6d7"
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQuery + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQuery + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQuery + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["b"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))

		listArgQueryWithDefault := "3703ff86bbacb900a2f071604f5705da4486fc4e7fae43aa9cd7a3c34da4c0b8"
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQueryWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQueryWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQueryWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["b"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + listArgQueryWithDefault + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg": ["c"]}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["c"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))

		nestedEnum := "2925ebccfd6a730dad6439d6812d2f3ffff075e6f8618ce0967d6f3bfca45645"
		// nested list of enums
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nestedEnum + `"}}`),
			Header:        header,
			Variables:     []byte(`{"arg":{"enums":"A"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"A"}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.PersistedOperationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nestedEnum + `"}}`),
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
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "27feb15f92b000437ffd50a557f06db2813949353ed716e0c65f6e41b5d4e6af"}}`),
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
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "27feb15f92b000437ffd50a557f06db2813949353ed716e0c65f6e41b5d4e6af"}}`),
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
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "27feb15f92b000437ffd50a557f06db2813949353ed716e0c65f6e41b5d4e6af"}}`),
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
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "27feb15f92b000437ffd50a557f06db2813949353ed716e0c65f6e41b5d4e6af"}}`),
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
