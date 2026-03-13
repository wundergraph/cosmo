package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestPersistedOperationOverGET(t *testing.T) {
	t.Parallel()

	t.Run("Operation not found", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + cacheHashNotStored + `"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
		})
	})

	t.Run("Operation executed successfully", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Employees`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("Operation with variables executed successfully", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Find`),
				Variables:     []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)
		})
	})

	t.Run("Only queries are supported over GET", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`updateEmployeeTag`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "49a2f7dd56b06f620c7d040dd9d562a1c16eadf7c149be5decdd62cfc92e1b12"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusMethodNotAllowed, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Mutations can only be sent over HTTP POST"}]}`, res.Body)
		})
	})
}

func TestAutomatedPersistedQueriesOverGET(t *testing.T) {
	t.Parallel()

	t.Run("Operation not found", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + cacheHashNotStored + `"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
		})
	})

	t.Run("Operation executed successfully", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache: config.AutomaticPersistedQueriesCacheConfig{
					Size: 1024 * 1024,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			res0, err0 := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
				Header:     header,
			})
			require.NoError(t, err0)
			require.Equal(t, http.StatusOK, res0.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res0.Body)

			res1, err1 := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Query:      `{__typename}`,
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
				Header:     header,
			})
			require.NoError(t, err1)
			require.Equal(t, http.StatusOK, res1.Response.StatusCode)
			require.Equal(t, `{"data":{"__typename":"Query"}}`, res1.Body)

			res2, err2 := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
				Header:     header,
			})
			require.NoError(t, err2)
			require.Equal(t, http.StatusOK, res2.Response.StatusCode)
			require.Equal(t, `{"data":{"__typename":"Query"}}`, res2.Body)
		})
	})

	t.Run("Operation with variables executed successfully", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache: config.AutomaticPersistedQueriesCacheConfig{
					Size: 1024 * 1024,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Query: `query Find($criteria: SearchInput!) {
  findEmployees(criteria: $criteria) {
    id
    details {
      forename
      surname
    }
  }
}`,
				Variables:  []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

			res2, err2 := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Variables:  []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
				Header:     header,
			})
			require.NoError(t, err2)
			require.Equal(t, http.StatusOK, res2.Response.StatusCode)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res2.Body)
		})
	})

	t.Run("Only queries are supported over GET", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache: config.AutomaticPersistedQueriesCacheConfig{
					Size: 1024 * 1024,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Query: `mutation updateEmployeeTag {
  updateEmployeeTag(id: 10, tag: "dd") {
    id
  }
}`,
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "49a2f7dd56b06f620c7d040dd9d562a1c16eadf7c149be5decdd62cfc92e1b12"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusMethodNotAllowed, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Mutations can only be sent over HTTP POST"}]}`, res.Body)
		})
	})
}

func TestPersistedSubscriptionOverGET(t *testing.T) {
	t.Parallel()

	t.Run("subscription over sse subgraph", func(t *testing.T) {
		t.Parallel()

		type currentTimePayload struct {
			Data struct {
				CurrentTime struct {
					UnixTime  float64 `json:"unixTime"`
					Timestamp string  `json:"timestamp"`
				} `json:"currentTime"`
			} `json:"data"`
		}

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			var wg sync.WaitGroup
			wg.Add(2)

			go xEnv.GraphQLSubscriptionOverSSE(ctx, testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "a78014f326504cdcc3ed9c4440c989ca0ac7ef237f6379ea7fee0ffde5ea71cb"}}`),
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Accept":        {"text/event-stream,application/json"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},

					"graphql-client-name": {"my-client"},
				},
			}, func(data string) {
				defer wg.Done()

				var payload currentTimePayload
				err := json.Unmarshal([]byte(data), &payload)
				require.NoError(t, err)

				require.NotZero(t, payload.Data.CurrentTime.UnixTime)
				require.NotEmpty(t, payload.Data.CurrentTime.Timestamp)
			})

			wg.Wait()
		})
	})
}
