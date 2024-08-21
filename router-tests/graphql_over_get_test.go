package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestOperationsOverGET(t *testing.T) {
	t.Parallel()

	t.Run("Operation executed successfully", func(t *testing.T) {
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
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				OperationName: []byte(`updateEmployeeTag`),
				Query:         "mutation updateEmployeeTag {\n  updateEmployeeTag(id: 10, tag: \"dd\") {\n    id\n  }\n}",
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusMethodNotAllowed, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Mutations can only be sent over HTTP POST"}],"data":null}`, res.Body)
		})
	})
}

func TestSubscriptionOverGET(t *testing.T) {
	t.Parallel()

	t.Run("subscription over sse", func(t *testing.T) {
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

			go xEnv.GraphQLSubscriptionOverGetAndSSE(ctx, testenv.GraphQLRequest{
				OperationName: []byte(`CurrentTime`),
				Query:         `subscription CurrentTime { currentTime { unixTime timeStamp }}`,
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
