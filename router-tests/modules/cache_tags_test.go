package module_test

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	cachetags "github.com/wundergraph/cosmo/router-tests/modules/cache-tags"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const (
	cacheTagsModuleID = "cacheTagsModule"

	queryEmployeeWithHobbies = `{
	  employee(id: 1) {
	    id
	    hobbies {
	      ... on Gaming {
	        name
	      }
	    }
	  }
	}`
)

func TestCacheTagsModuleConfiguration(t *testing.T) {
	t.Parallel()

	for _, headerName := range []string{"", "invalid header", "Cache-Control", "Content-Length"} {
		t.Run(headerName, func(t *testing.T) {
			t.Parallel()

			module := &cachetags.CacheTagsModule{HeaderName: headerName}
			require.Error(t, module.Provision(&core.ModuleContext{}))
		})
	}

	module := &cachetags.CacheTagsModule{HeaderName: " x-cache-tags "}
	require.NoError(t, module.Provision(&core.ModuleContext{}))
	require.Equal(t, "X-Cache-Tags", module.HeaderName)
}

func TestCacheTagsModule(t *testing.T) {
	t.Parallel()

	t.Run("merges configured cache tags and uses the lowest max age", func(t *testing.T) {
		t.Parallel()

		const tagHeader = "X-Cache-Tags"

		testenv.Run(t, &testenv.Config{
			RouterOptions: cacheTagsModuleOptions(tagHeader),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"employee:1, shared", "employee:2"},
						"Cache-Control": {"max-age=120, public"},
					}),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"hobby:gaming, shared"},
						"Cache-Control": {"max-age=90", "max-age=60, public"},
					}),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobbies,
			})

			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "employee:1,employee:2,hobby:gaming,shared", res.Response.Header.Get(tagHeader))
			require.Equal(t, "max-age=60, public", res.Response.Header.Get("Cache-Control"))
			require.JSONEq(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
		})
	})

	t.Run("combines restrictive cache control directives", func(t *testing.T) {
		t.Parallel()

		const tagHeader = "X-Cache-Tags"

		testenv.Run(t, &testenv.Config{
			RouterOptions: cacheTagsModuleOptions(tagHeader),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"employees"},
						"Cache-Control": {"max-age=600, private"},
					}),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"hobbies"},
						"Cache-Control": {"max-age=300, public"},
					}),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobbies,
			})

			require.Equal(t, "employees,hobbies", res.Response.Header.Get(tagHeader))
			require.Equal(t, "max-age=300, private", res.Response.Header.Get("Cache-Control"))
		})
	})

	t.Run("only collects the configured tag header", func(t *testing.T) {
		t.Parallel()

		const (
			tagHeader   = "X-Entity-Tags"
			otherHeader = "X-Cache-Tags"
		)

		testenv.Run(t, &testenv.Config{
			RouterOptions: cacheTagsModuleOptions(tagHeader),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:   {"employee:1"},
						otherHeader: {"not-collected:employees"},
					}),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:   {"hobby:gaming"},
						otherHeader: {"not-collected:hobbies"},
					}),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobbies,
			})

			require.Equal(t, "employee:1,hobby:gaming", res.Response.Header.Get(tagHeader))
			require.Empty(t, res.Response.Header.Get(otherHeader))
			require.Empty(t, res.Response.Header.Get("Cache-Control"))
		})
	})

	t.Run("is race safe for parallel subgraph responses", func(t *testing.T) {
		t.Parallel()

		const tagHeader = "X-Cache-Tags"

		testenv.Run(t, &testenv.Config{
			RouterOptions: cacheTagsModuleOptions(tagHeader),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"employees"},
						"Cache-Control": {"max-age=300"},
					}),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"hobbies"},
						"Cache-Control": {"max-age=0"},
					}),
				},
				Availability: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"availability"},
						"Cache-Control": {"max-age=120"},
					}),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{
				  employees {
				    id
				    isAvailable
				    hobbies {
				      ... on Gaming {
				        name
				      }
				    }
				  }
				}`,
			})

			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "availability,employees,hobbies", res.Response.Header.Get(tagHeader))
			require.Equal(t, "max-age=0", res.Response.Header.Get("Cache-Control"))
		})
	})

	t.Run("returns collected headers to concurrent clients", func(t *testing.T) {
		t.Parallel()

		const tagHeader = "X-Cache-Tags"

		routerOptions := append(
			cacheTagsModuleOptions(tagHeader),
			core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
				EnableSingleFlight:      true,
				ForceEnableSingleFlight: false,
				MaxConcurrentResolvers:  0,
			}),
		)

		testenv.Run(t, &testenv.Config{
			RouterOptions: routerOptions,
			Subgraphs: testenv.SubgraphsConfig{
				GlobalDelay: 100 * time.Millisecond,
				Employees: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"employees"},
						"Cache-Control": {"max-age=120"},
					}),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: subgraphHeadersMiddleware(http.Header{
						tagHeader:       {"hobbies"},
						"Cache-Control": {"max-age=60"},
					}),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			responses := makeConcurrentGraphQLRequests(t, xEnv, queryEmployeeWithHobbies, 5)
			for _, res := range responses {
				require.Equal(t, "employees,hobbies", res.Response.Header.Get(tagHeader))
				require.Equal(t, "max-age=60", res.Response.Header.Get("Cache-Control"))
			}
		})
	})

	t.Run("keeps aggregation isolated between requests", func(t *testing.T) {
		t.Parallel()

		const tagHeader = "X-Cache-Tags"
		var requestCount atomic.Uint32

		testenv.Run(t, &testenv.Config{
			RouterOptions: cacheTagsModuleOptions(tagHeader),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							requestNumber := requestCount.Add(1)
							w.Header().Set(tagHeader, fmt.Sprintf("request:%d", requestNumber))
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 2) { id } }`,
			})

			require.Equal(t, "request:1", first.Response.Header.Get(tagHeader))
			require.Equal(t, "request:2", second.Response.Header.Get(tagHeader))
		})
	})
}

func makeConcurrentGraphQLRequests(
	t *testing.T,
	xEnv *testenv.Environment,
	query string,
	requestCount int,
) []*testenv.TestResponse {
	t.Helper()

	var ready, done sync.WaitGroup
	ready.Add(requestCount)
	done.Add(requestCount)

	trigger := make(chan struct{})
	errs := make(chan error, requestCount)
	responses := make([]*testenv.TestResponse, requestCount)
	for i := range requestCount {
		go func() {
			defer done.Done()
			ready.Done()
			<-trigger

			response, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: query})
			if err != nil {
				errs <- err
				return
			}
			responses[i] = response
		}()
	}

	ready.Wait()
	close(trigger)
	done.Wait()
	close(errs)

	for err := range errs {
		require.NoError(t, err)
	}
	for _, response := range responses {
		require.NotNil(t, response)
		require.Equal(t, http.StatusOK, response.Response.StatusCode)
	}

	return responses
}

func cacheTagsModuleOptions(headerName string) []core.Option {
	return []core.Option{
		core.WithModulesConfig(map[string]any{
			cacheTagsModuleID: map[string]any{
				"header_name": headerName,
			},
		}),
		core.WithCustomModules(&cachetags.CacheTagsModule{}),
	}
}

func subgraphHeadersMiddleware(headers http.Header) func(http.Handler) http.Handler {
	return func(handler http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for name, values := range headers {
				for _, value := range values {
					w.Header().Add(name, value)
				}
			}
			handler.ServeHTTP(w, r)
		})
	}
}
