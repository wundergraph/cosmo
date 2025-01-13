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
	"github.com/wundergraph/cosmo/router/core"
	"golang.org/x/net/html"
)

func TestOperationsOverGET(t *testing.T) {
	t.Parallel()

	t.Run("Operation executed successfully", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Employees`),
				Query:         `query Employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("Operation with variables executed successfully", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Find`),
				Query:         `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables:     []byte(`{"criteria":{   "nationality":"GERMAN"}  }   `),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)
		})
	})

	t.Run("Only queries are supported over GET", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`updateEmployeeTag`),
				Query:         "mutation updateEmployeeTag {\n  updateEmployeeTag(id: 10, tag: \"dd\") {\n    id\n  }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusMethodNotAllowed, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Mutations can only be sent over HTTP POST"}]}`, res.Body)
		})
	})

	t.Run("Query should be successful with custom path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/custom-graphql",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Employees`),
				Query:         `query Employees { employees { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("Mutation should not be allowed with custom path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/custom-graphql",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`updateEmployeeTag`),
				Query:         "mutation updateEmployeeTag {\n  updateEmployeeTag(id: 10, tag: \"dd\") {\n    id\n  }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusMethodNotAllowed, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Mutations can only be sent over HTTP POST"}]}`, res.Body)
		})
	})

	t.Run("Should return 404 for unknown path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithGraphQLPath("/custom-graphql"),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Default path for creating requests is /graphql if not updated with `OverrideGraphQLPath`
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Employees`),
				Query:         `query Employees { employees { id } }`,
			})

			require.NoError(t, err)
			require.Equal(t, http.StatusNotFound, res.Response.StatusCode)
		})
	})

	t.Run("Should not create wildcard for root path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithGraphQLPath("/"),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Default path for creating requests is /graphql if not updated with `OverrideGraphQLPath`
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Employees`),
				Query:         `query Employees { employees { id } }`,
			})

			require.NoError(t, err)
			require.Equal(t, http.StatusNotFound, res.Response.StatusCode)
		})
	})

	t.Run("Should allow to create wildcard path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithGraphQLPath("/*"),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Default path for creating requests is /graphql if not updated with `OverrideGraphQLPath`
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Employees`),
				Query:         `query Employees { employees { id } }`,
			})

			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

		})
	})

	t.Run("Should serve both graphql and playground on the same path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/", // Default playground handler path
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// We could see that successful graphql queries have been made in the previous tests
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`Employees`),
				Query:         `query Employees { employees { id } }`,
			})

			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, res.Body)

			// If the graphql path and the playground path is the same, the playground will be mounted as a middleware and served based on the Accept header
			// The accept header must be text/html to get the playground
			header := http.Header{
				"Accept": {"text/html; charset=utf-8"}, // simulate simplified browser request
			}

			httpRes, err := xEnv.MakeRequest(http.MethodGet, "/", header, nil)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, httpRes.StatusCode)

			defer func() { _ = httpRes.Body.Close() }()
			_, err = html.Parse(httpRes.Body)
			require.NoError(t, err)
		})
	})
}

func TestSubscriptionOverGET(t *testing.T) {
	t.Parallel()

	t.Run("subscription over sse with content negotiation", func(t *testing.T) {
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
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Accept":        {"text/event-stream"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},
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

	t.Run("subscription over sse with wg_sse params and without content negotiation", func(t *testing.T) {
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

			go xEnv.GraphQLSubscriptionOverSSEWithQueryParam(ctx, testenv.GraphQLRequest{
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},
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

	t.Run("should create subscription for custom graphql path", func(t *testing.T) {
		t.Parallel()

		type currentTimePayload struct {
			Data struct {
				CurrentTime struct {
					UnixTime  float64 `json:"unixTime"`
					Timestamp string  `json:"timestamp"`
				} `json:"currentTime"`
			} `json:"data"`
		}

		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/custom-graphql",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			var wg sync.WaitGroup
			wg.Add(2)

			go xEnv.GraphQLSubscriptionOverSSEWithQueryParam(ctx, testenv.GraphQLRequest{
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
				Header: map[string][]string{
					"Content-Type":  {"application/json"},
					"Connection":    {"keep-alive"},
					"Cache-Control": {"no-cache"},
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
