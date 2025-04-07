package integration

import (
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http"
	"testing"
)

func TestBatch(t *testing.T) {
	t.Run("verify batching", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:       true,
					MaxConcurrent: 10,
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
				})
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
					Enabled:       false,
					MaxConcurrent: 10,
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
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"error parsing request body"}]}`, res.Body)
			},
		)
	})

	t.Run("send batch request over max allowed count", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrent:      10,
					MaxEntriesPerBatch: 5,
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
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.Equal(t, "unable to process request", res.Body)
			},
		)
	})

	t.Run("verify batched requests when max is unlimited", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:            true,
					MaxConcurrent:      10,
					MaxEntriesPerBatch: 0,
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
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				entries := getBatchedEntriesForLength(t, res.Body, 7)
				expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected2 := `{"data":{"employees":[{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false},{"isAvailable":false}]}}`
				require.Equal(t, expected1, entries[0])
				require.Equal(t, expected2, entries[1])
			},
		)
	})

	t.Run("attempt to start server with invalid max concurrent", func(t *testing.T) {
		err := testenv.RunWithError(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:       true,
				MaxConcurrent: 0,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.Error(t, err, "maxConcurrent must be greater than 0")
	})

	t.Run("attempt to start server with invalid max entries per batch", func(t *testing.T) {
		err := testenv.RunWithError(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxEntriesPerBatch: 0,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.Error(t, err, "maxEntriesPerBatch must be greater than 0")
	})

	t.Run("prevent running a subscription", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:       true,
					MaxConcurrent: 10,
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
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				entries := getBatchedEntriesForLength(t, res.Body, 2)
				expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected2 := `{"errors":[{"message":"Batched requests can only contain queries"}]}`
				require.Equal(t, expected1, entries[0])
				require.Equal(t, expected2, entries[1])
			},
		)
	})

	t.Run("prevent running a mutation", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t,
			&testenv.Config{
				BatchingConfig: config.BatchingConfig{
					Enabled:       true,
					MaxConcurrent: 10,
				},
			},
			func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
					{
						Query: `query employees { employees { id } }`,
					},
					{
						Query: `mutation AddFact { addFact(fact: { title: "re2", factType: DIRECTIVE, description: "werwer" }) { description } }`,
					},
					{
						Query: `query employees { employees { id } }`,
					},
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				entries := getBatchedEntriesForLength(t, res.Body, 3)
				expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
				expected2 := `{"errors":[{"message":"Batched requests can only contain queries"}]}`
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
					Enabled:       true,
					MaxConcurrent: 10,
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
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)

				entries := getBatchedEntriesForLength(t, res.Body, 3)
				expected1 := `{"errors":[{"message":"field: employees2 not defined on type: Query","path":["query"]}]}`
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
				Enabled:       true,
				MaxConcurrent: 10,
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			})
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
				Enabled:       true,
				MaxConcurrent: 10,
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)

			entries := getBatchedEntriesForLength(t, res.Body, 3)
			fmt.Println(entries[1])
			expected1 := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
			expected2 := `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null},{"notes":null}]}}`
			expected3 := `{"errors":[{"message":"Variable \"$a\" got invalid value \"5\"; Int cannot represent non-integer value: \"5\""}]}`
			require.Equal(t, expected1, entries[0])
			require.Equal(t, expected2, entries[1])
			require.Equal(t, expected3, entries[2])
		})
	})

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
