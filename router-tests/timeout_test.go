package integration_test

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http"
	"testing"
	"time"
)

func TestTimeouts(t *testing.T) {
	t.Parallel()

	const queryEmployeeWithHobby = `{
	  employee(id: 1) {
		id
		hobbies {
		  ... on Gaming {
			name
		  }
		}
	  }
	}`

	const queryEmployeeWithNoHobby = `{
	  employee(id: 1) {
		id
	  }
	}`

	t.Run("applies RequestTimeout", func(t *testing.T) {
		t.Parallel()

		hobbySubgraphSleep := testenv.SubgraphsConfig{
			Hobbies: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusOK)
						time.Sleep(5 * time.Millisecond) // Slow response
						w.Write([]byte("Hello, world!"))
					})
				},
			},
		}

		trafficConfig := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout: 10 * time.Millisecond,
			},
			Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
				"hobbies": {
					RequestTimeout: 3 * time.Millisecond,
				},
			},
		}
		t.Run("applied subgraph timeout to request", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				Subgraphs: hobbySubgraphSleep,
				RouterOptions: []core.Option{
					core.WithSubgraphTransportOptions(
						core.NewSubgraphTransportOptions(trafficConfig)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})

				// It can also result in invalid JSON, but we don't care about that here
				require.Contains(t, res.Body, "Failed to fetch from Subgraph 'hobbies'")
			})
		})

		t.Run("Subgraph timeout options don't affect unrelated subgraph", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				Subgraphs: hobbySubgraphSleep,
				RouterOptions: []core.Option{
					core.WithSubgraphTransportOptions(
						core.NewSubgraphTransportOptions(trafficConfig)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithNoHobby,
				})
				require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			})
		})
	})

	t.Run("ResponseHeaderTimeout exceeded", func(t *testing.T) {
		t.Parallel()

		hobbySubgraphSleep := testenv.SubgraphsConfig{
			Hobbies: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusOK)
						time.Sleep(5 * time.Millisecond) // Slow response
						w.Write([]byte("Hello, world!"))
					})
				},
			},
		}

		trafficConfig := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout: 10 * time.Millisecond,
			},
			Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
				"hobbies": {
					ResponseHeaderTimeout: 3 * time.Millisecond,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: hobbySubgraphSleep,
			RouterOptions: []core.Option{
				core.WithSubgraphTransportOptions(
					core.NewSubgraphTransportOptions(trafficConfig)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithNoHobby,
			})
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})
}
