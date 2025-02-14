package integration

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestFlakyTimeouts(t *testing.T) {
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

	// Make sure `bytes` in the test is equal to this
	// 50000 was sufficiently large in testing to consistently produce an error
	// but its a race, so it might not always fail
	const queryLongResponse = `{
	  longResponse(artificialDelay:0, bytes:50000)
	}`

	t.Run("very long response should not fail", func(t *testing.T) {
		t.Parallel()

		trafficConfig := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout: ToPtr(500 * time.Millisecond),
			},
			Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
				"test1": {
					ResponseHeaderTimeout: ToPtr(100 * time.Millisecond),
				},
			},
		}

		bytes := 50000

		b := make([]byte, bytes)
		for i := 0; i < bytes; i++ {
			b[i] = 'a'
		}

		expectedResponse := string(b)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTransportOptions(
					core.NewSubgraphTransportOptions(trafficConfig)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryLongResponse,
			})
			require.Equal(t, fmt.Sprintf(`{"data":{"longResponse":"%s"}}`, expectedResponse), res.Body)
		})
	})

	t.Run("Global timeouts", func(t *testing.T) {
		t.Parallel()

		subgraphSleep := func(hobbies, employees time.Duration) testenv.SubgraphsConfig {
			return testenv.SubgraphsConfig{
				Hobbies: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							time.Sleep(hobbies)
							handler.ServeHTTP(w, r)
						})
					},
				},
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							time.Sleep(employees) // Slow response
							handler.ServeHTTP(w, r)
						})
					},
				},
			}
		}

		trafficConfig := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout: ToPtr(200 * time.Millisecond),
			},
		}
		t.Run("no timeout below global timeout value", func(t *testing.T) {
			t.Parallel()

			delay := 100 * time.Millisecond // 100ms is lower than the global 200ms timeout

			testenv.Run(t, &testenv.Config{
				Subgraphs: subgraphSleep(delay, 0),
				RouterOptions: []core.Option{
					core.WithSubgraphTransportOptions(
						core.NewSubgraphTransportOptions(trafficConfig)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})

				// It can also result in invalid JSON, but we don't care about that here
				require.NotContains(t, res.Body, "Failed to fetch from Subgraph 'hobbies'")

				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("timeout above global timeout value", func(t *testing.T) {
			t.Parallel()

			delay := 500 * time.Millisecond // 500ms is bigger than the global 200ms timeout

			testenv.Run(t, &testenv.Config{
				Subgraphs: subgraphSleep(delay, 0),
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
	})

	t.Run("Per subgraph timeouts", func(t *testing.T) {
		t.Parallel()

		subgraphSleep := func(hobbies, employees time.Duration) testenv.SubgraphsConfig {
			return testenv.SubgraphsConfig{
				Hobbies: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							time.Sleep(hobbies)
							handler.ServeHTTP(w, r)
						})
					},
				},
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							time.Sleep(employees) // Slow response
							handler.ServeHTTP(w, r)
						})
					},
				},
			}
		}

		trafficConfig := config.TrafficShapingRules{
			All: config.GlobalSubgraphRequestRule{
				RequestTimeout: ToPtr(200 * time.Millisecond),
			},
			Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
				"hobbies": {
					RequestTimeout: ToPtr(300 * time.Millisecond),
				},
				"test1": {
					RequestTimeout: ToPtr(500 * time.Millisecond),
				},
			},
		}
		t.Run("no timeout on hobbies subgraph", func(t *testing.T) {
			t.Parallel()

			hobbiesDelay := 200 * time.Millisecond   // 200ms is lower than the hobbies 300ms timeout
			employeesDelay := 100 * time.Millisecond // 100ms is lower than the global 200ms timeout

			testenv.Run(t, &testenv.Config{
				Subgraphs: subgraphSleep(hobbiesDelay, employeesDelay),
				RouterOptions: []core.Option{
					core.WithSubgraphTransportOptions(
						core.NewSubgraphTransportOptions(trafficConfig)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})

				// It can also result in invalid JSON, but we don't care about that here
				require.NotContains(t, res.Body, "Failed to fetch from Subgraph 'hobbies'")

				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("timeout on hobbies request", func(t *testing.T) {
			t.Parallel()

			hobbiesDelay := 500 * time.Millisecond   // 500 is bigger than hobbies 300ms timeout
			employeesDelay := 100 * time.Millisecond // 100ms is lower than the global 200ms timeout

			testenv.Run(t, &testenv.Config{
				Subgraphs: subgraphSleep(hobbiesDelay, employeesDelay),
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

		t.Run("no timeout on employees subgraph", func(t *testing.T) {
			t.Parallel()

			hobbiesDelay := 500 * time.Millisecond   // hobbies delay doesn't matter in this test case
			employeesDelay := 100 * time.Millisecond // 100ms is lower than the global 200ms timeout

			testenv.Run(t, &testenv.Config{
				Subgraphs: subgraphSleep(hobbiesDelay, employeesDelay),
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

		t.Run("timeout on employees subgraph", func(t *testing.T) {
			t.Parallel()

			hobbiesDelay := 500 * time.Millisecond   // 500 is bigger than hobbies 300ms timeout
			employeesDelay := 300 * time.Millisecond // 300ms is bigger than the global 200ms timeout

			testenv.Run(t, &testenv.Config{
				Subgraphs: subgraphSleep(hobbiesDelay, employeesDelay),
				RouterOptions: []core.Option{
					core.WithSubgraphTransportOptions(
						core.NewSubgraphTransportOptions(trafficConfig)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithNoHobby,
				})

				require.Contains(t, res.Body, "Failed to fetch from Subgraph 'employees'")
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
				RequestTimeout: ToPtr(500 * time.Millisecond),
			},
			Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
				"hobbies": {
					ResponseHeaderTimeout: ToPtr(100 * time.Millisecond),
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
