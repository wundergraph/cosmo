package integration_test

import (
	"context"
	"github.com/goccy/go-json"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestPersistedOperationOverGET(t *testing.T) {
	t.Parallel()

	t.Run("Operation not found", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "does-not-exist"}}`),
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"persisted Query not found"}],"data":null}`, res.Body)
		})
	})

	t.Run("Operation executed successfully", func(t *testing.T) {
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
			require.Equal(t, `{"errors":[{"message":"Mutations can only be sent over HTTP POST"}],"data":null}`, res.Body)
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
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			var wg sync.WaitGroup
			wg.Add(2)

			go xEnv.GraphQLSubscriptionOverGetAndSSE(ctx, testenv.GraphQLRequest{
				Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "a78014f326504cdcc3ed9c4440c989ca0ac7ef237f6379ea7fee0ffde5ea71cb"}}`),
				Header:     header,
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
