package integration

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCacheControl(t *testing.T) {
	t.Run("Unreachable subgraph causes no-cache", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			CacheControlPolicy: config.CacheControlPolicy{
				Enabled: true,
				Value:   "max-age=300",
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					CloseOnStart: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})

			assert.Equal(t, "no-store, no-cache, must-revalidate", res.Response.Header.Get("Cache-Control"))
			assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("PERSISTED_QUERY_NOT_FOUND causes no-cache", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			CacheControlPolicy: config.CacheControlPolicy{
				Enabled: true,
				Value:   "max-age=300",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make request that triggers PERSISTED_QUERY_NOT_FOUND error
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:      "", // Empty query
				Variables:  json.RawMessage(`{}`),
				Extensions: json.RawMessage(`{"persistedQuery": {"version": 1, "sha256Hash": "invalid-hash"}}`),
			})

			require.Contains(t, res.Body, "PERSISTED_QUERY_NOT_FOUND")
			require.Equal(t, "no-store, no-cache, must-revalidate", res.Response.Header.Get("Cache-Control"))
		})
	})

	t.Run("Erroring subgraph response causes no-cache", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			CacheControlPolicy: config.CacheControlPolicy{
				Enabled: true,
				Value:   "max-age=300",
			},
			Subgraphs: testenv.SubgraphsConfig{},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id rootFieldThrowsError } }`,
			})

			assert.Equal(t, "no-store, no-cache, must-revalidate", res.Response.Header.Get("Cache-Control"))
			assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employee","rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE"}}],"statusCode":200}}],"data":{"employee":{"id":1,"rootFieldThrowsError":null}}}`, res.Body)
		})
	})
}

func TestHeaderPropagation(t *testing.T) {
	t.Parallel()

	const (
		customHeader = "X-Custom-Header"
		employeeVal  = "employee-value"
		employeeVal2 = "employee-value-2"
		hobbyVal     = "hobby-value"
		hobbyVal2    = "hobby-value-2"
	)

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

	getRule := func(alg config.ResponseHeaderRuleAlgorithm, named, defaultVal string) *config.ResponseHeaderRule {
		rule := &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationPropagate,
			Algorithm: alg,
		}
		if named != "" {
			rule.Named = named
		}
		if defaultVal != "" {
			rule.Default = defaultVal
		}
		return rule
	}

	global := func(alg config.ResponseHeaderRuleAlgorithm, named, defaultVal string) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				All: &config.GlobalHeaderRule{
					Response: []*config.ResponseHeaderRule{
						getRule(alg, named, defaultVal),
					},
				},
			}),
		}
	}

	partial := func(alg config.ResponseHeaderRuleAlgorithm, named, defaultVal string) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				Subgraphs: map[string]*config.GlobalHeaderRule{
					"employees": {
						Response: []*config.ResponseHeaderRule{
							getRule(alg, named, defaultVal),
						},
					},
				},
			}),
		}
	}

	local := func(alg config.ResponseHeaderRuleAlgorithm, named, defaultValA, defaultValB string) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				Subgraphs: map[string]*config.GlobalHeaderRule{
					"employees": {
						Response: []*config.ResponseHeaderRule{
							getRule(alg, named, defaultValA),
						},
					},
					"hobbies": {
						Response: []*config.ResponseHeaderRule{
							getRule(alg, named, defaultValB),
						},
					},
				},
			}),
		}
	}

	setSubgraphPropagateHeader := func(header string, valA, valB []string) testenv.SubgraphsConfig {
		return testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header()[header] = valA
						handler.ServeHTTP(w, r)
					})
				},
			},
			Hobbies: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header()[header] = valB
						handler.ServeHTTP(w, r)
					})
				},
			},
		}
	}

	subgraphsWithExpiresHeader := testenv.SubgraphsConfig{
		Employees: testenv.SubgraphConfig{
			Middleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					expiresTime := time.Now().UTC().Add(10 * time.Minute).Format(http.TimeFormat)
					w.Header().Set("Expires", expiresTime)
					handler.ServeHTTP(w, r)
				})
			},
		},
		Hobbies: testenv.SubgraphConfig{
			Middleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					expiresTime := time.Now().UTC().Add(5 * time.Minute).Format(http.TimeFormat)
					w.Header().Set("Expires", expiresTime) // Earlier, more restrictive
					handler.ServeHTTP(w, r)
				})
			},
		},
	}

	cacheOptions := func(cacheControlEmployees, cacheControlHobbies string) testenv.SubgraphsConfig {
		return setSubgraphPropagateHeader("Cache-Control", []string{cacheControlEmployees}, []string{cacheControlHobbies})
	}

	var (
		subgraphsPropagateCustomHeader         = setSubgraphPropagateHeader(customHeader, []string{employeeVal}, []string{hobbyVal})
		subgraphsPropagateRepeatedCustomHeader = setSubgraphPropagateHeader(customHeader, []string{employeeVal, employeeVal2}, []string{hobbyVal, hobbyVal2})
	)

	t.Run(" no propagate", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			Subgraphs: subgraphsPropagateCustomHeader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobby,
			})
			ch := strings.Join(res.Response.Header.Values(customHeader), ",")
			require.Equal(t, "", ch)
			require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
		})
	})

	t.Run("LastWriteWins", func(t *testing.T) {
		t.Parallel()
		t.Run("global last write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmLastWrite, customHeader, ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, hobbyVal, ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("works with unresponsive subgraph", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmLastWrite, customHeader, ""),
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set(customHeader, employeeVal)
								handler.ServeHTTP(w, r)
							})
						},
					},
					Hobbies: testenv.SubgraphConfig{
						CloseOnStart: true,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, employeeVal, ch)
				require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'hobbies' at Path 'employee'."}],"data":{"employee":{"id":1,"hobbies":null}}}`, res.Body)
			})
		})

		t.Run("local last write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: local(config.ResponseHeaderRuleAlgorithmLastWrite, customHeader, "", ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, hobbyVal, ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("partial last write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: partial(config.ResponseHeaderRuleAlgorithmLastWrite, customHeader, ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, employeeVal, ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("repeated header names last write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmLastWrite, customHeader, ""),
				Subgraphs:     subgraphsPropagateRepeatedCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "hobby-value,hobby-value-2", ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})
	})

	// Test for the First Write Wins Algorithm
	t.Run("FirstWriteWins", func(t *testing.T) {
		t.Parallel()
		t.Run("global first write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmFirstWrite, customHeader, ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, employeeVal, ch) // First write is "employee-value"
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("local first write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: local(config.ResponseHeaderRuleAlgorithmFirstWrite, customHeader, "", ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, employeeVal, ch) // First write is "employee-value"
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("partial first write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: partial(config.ResponseHeaderRuleAlgorithmFirstWrite, customHeader, ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, employeeVal, ch) // First write is "employee-value"
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("repeated header names first write wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: partial(config.ResponseHeaderRuleAlgorithmFirstWrite, customHeader, ""),
				Subgraphs:     subgraphsPropagateRepeatedCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "employee-value,employee-value-2", ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})
	})

	// Test for the Append Algorithm
	t.Run("AppendHeaders", func(t *testing.T) {
		t.Parallel()
		t.Run("global append headers", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmAppend, customHeader, ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "employee-value,hobby-value", ch) // Headers are appended
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("local append headers", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: local(config.ResponseHeaderRuleAlgorithmAppend, customHeader, "", ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "employee-value,hobby-value", ch) // Headers are appended
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("partial append headers", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: partial(config.ResponseHeaderRuleAlgorithmAppend, customHeader, ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, employeeVal, ch) // Only employee's header is appended
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("repeated header names append headers", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmAppend, customHeader, ""),
				Subgraphs:     subgraphsPropagateRepeatedCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "employee-value,employee-value-2,hobby-value,hobby-value-2", ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})
	})

	t.Run("Cache Control Propagation", func(t *testing.T) {
		t.Parallel()
		// Global test: All subgraphs' responses are considered and most restrictive cache directive wins
		t.Run("enable global cache control", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
				Subgraphs:          cacheOptions("max-age=120", "max-age=60"),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "max-age=60", cc) // Most restrictive wins
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)

				// Verify that it doesn't set Expires header
				val, present := res.Response.Header["Expires"]
				require.False(t, present)
				require.Equal(t, []string(nil), val)
			})
		})

		// Local test: Cache control rules are applied per subgraph (employees and hobbies)
		t.Run("only enable cache control for subgraphs", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				Subgraphs: cacheOptions("max-age=120", "max-age=60, private"),
				CacheControlPolicy: config.CacheControlPolicy{
					Subgraphs: []config.SubgraphCacheControlRule{
						{Name: "employees"},
						{Name: "hobbies"},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "max-age=60, private", cc) // Most restrictive wins
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		// Partial test: Only one subgraph's response is considered (e.g., employees)
		t.Run("only enable cache control for one subgraph", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{
					Subgraphs: []config.SubgraphCacheControlRule{
						{Name: "employees"},
					},
				},
				Subgraphs: cacheOptions("max-age=120, public", "max-age=60"),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "max-age=120, public", cc) // Only employee subgraph is considered
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		// Test case for no-store being the most restrictive
		t.Run("global default value of no-store wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
				Subgraphs:          cacheOptions("no-store", "max-age=300"),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "no-store", cc) // no-store wins
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		// Test case for no-cache being more restrictive than max-age
		t.Run("global default value of no-cache wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
				Subgraphs:          cacheOptions("no-cache", "max-age=300"),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "no-cache", cc) // no-cache wins over max-age
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("no-cache wins against no value", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
				Subgraphs:          cacheOptions("no-cache", ""),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "no-cache", cc) // no-cache wins over max-age
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		// Test case for max-age: shortest max-age wins
		t.Run("shortest max-age wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
				Subgraphs:          cacheOptions("max-age=600", "max-age=300"),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "max-age=300", cc) // Shorter max-age wins
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("selects shortest max-age and private vs private", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
				Subgraphs:          cacheOptions("max-age=600, private", "max-age=300, public"),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "max-age=300, private", cc) // Shorter max-age wins
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		// Test case for Expires header: earliest expiration wins
		t.Run("earliest Expires wins", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{Enabled: true},
				Subgraphs:          subgraphsWithExpiresHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				expires := res.Response.Header.Get("Expires")
				require.NotEmpty(t, expires)

				// Parse the Expires header and convert both times to UTC for comparison
				parsedExpires, err := http.ParseTime(expires)
				require.NoError(t, err)

				now := time.Now().Add(5 * time.Minute)                        // Example expiration
				require.WithinDuration(t, now, parsedExpires, 20*time.Second) // Ensure expiration is within expected range
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("default value adds max age", func(t *testing.T) {
			t.Parallel()

			t.Run("global default age sets for all requests", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Enabled: true,
						Value:   "max-age=300",
					},
					Subgraphs: cacheOptions("", "max-age=600"),
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "max-age=300", cc) // Shorter max-age wins
					require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
				})
			})

			t.Run("global no-cache sets for all requests", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Enabled: true,
						Value:   "no-cache",
					},
					Subgraphs: cacheOptions("", "max-age=600"),
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "no-cache", cc) // Shorter max-age wins
					require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
				})
			})

			t.Run("global default age sets for all requests", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Enabled: true,
						Value:   "no-cache",
					},
					Subgraphs: cacheOptions("max-age=60", "max-age=300"),
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "no-cache", cc) // Shorter max-age wins
					require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
				})
			})

			t.Run("allows subgraph to override default", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Enabled: true,
						Value:   "max-age=300",
					},
					Subgraphs: cacheOptions("max-age=60", "max-age=180"),
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "max-age=60", cc) // Shorter max-age wins
					require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
				})
			})

			t.Run("partial default age sets for requests with information", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Subgraphs: []config.SubgraphCacheControlRule{
							{Name: "employees"},
							{Name: "hobbies", Value: "max-age=300"},
						},
					},
					Subgraphs: cacheOptions("", ""),
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "max-age=300", cc) // Shorter max-age wins
					require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
				})
			})

			t.Run("partial default age doesn't set for unassociated requests", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Subgraphs: []config.SubgraphCacheControlRule{
							{Name: "employees"},
							{Name: "hobbies", Value: "max-age=300"},
						},
					},
					Subgraphs: cacheOptions("", ""),
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithNoHobby,
					})
					val, present := res.Response.Header["Cache-Control"]
					require.False(t, present)
					require.Equal(t, []string(nil), val)
					require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
				})
			})

			t.Run("no-cache is set for all mutations", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Enabled: true,
						Value:   "max-age=300",
					},
					Subgraphs: cacheOptions("", ""),
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "no-cache", cc)
					require.Equal(t, http.StatusOK, res.Response.StatusCode)
					require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)
				})
			})
		})

		t.Run("doesn't set cache control on unrelated requests", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{
					Subgraphs: []config.SubgraphCacheControlRule{
						{Name: "employees"},
						{Name: "hobbies"},
					},
				},
				Subgraphs: cacheOptions("", ""),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				val, present := res.Response.Header["Cache-Control"]
				require.False(t, present)
				require.Equal(t, []string(nil), val)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("set operation can override cache control policies", func(t *testing.T) {
			t.Parallel()
			t.Run("global set operation", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Enabled: true,
						Value:   "max-age=300",
					},
					Subgraphs: cacheOptions("max-age=180", "max-age=250"),
					RouterOptions: []core.Option{core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Response: []*config.ResponseHeaderRule{
								{
									Operation: config.HeaderRuleOperationSet,
									Name:      "Cache-Control",
									Value:     "my-fake-value",
								},
							},
						},
					})},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "my-fake-value", cc)
					require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
				})
			})

			t.Run("local subgraph set operation", func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					CacheControlPolicy: config.CacheControlPolicy{
						Enabled: true,
						Value:   "max-age=300",
					},
					Subgraphs: cacheOptions("max-age=180", "max-age=250"),
					RouterOptions: []core.Option{core.WithHeaderRules(config.HeaderRules{
						Subgraphs: map[string]*config.GlobalHeaderRule{
							"employees": {
								Response: []*config.ResponseHeaderRule{
									{
										Operation: config.HeaderRuleOperationSet,
										Name:      "Cache-Control",
										Value:     "my-fake-value",
									},
								},
							},
						},
					})},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					cc := res.Response.Header.Get("Cache-Control")
					require.Equal(t, "my-fake-value", cc)
					require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
				})
			})
		})

		t.Run("Successful query gets appropriate cache header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				// Configure a specific cache control policy
				CacheControlPolicy: config.CacheControlPolicy{
					Enabled: true,
					Value:   "max-age=300",
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				require.Equal(t, "max-age=300", res.Response.Header.Get("Cache-Control")) // no-cache because of the error
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})
	})

	t.Run("header name canonicalization", func(t *testing.T) {
		t.Parallel()
		nonCanonicalCustomHeader := "x-Custom-header"
		subgraphsNonCanonicalHeader := testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header()[nonCanonicalCustomHeader] = []string{employeeVal}
						handler.ServeHTTP(w, r)
					})
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: global(config.ResponseHeaderRuleAlgorithmAppend, nonCanonicalCustomHeader, ""),
			Subgraphs:     subgraphsNonCanonicalHeader,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: queryEmployeeWithHobby,
			})
			cch := strings.Join(res.Response.Header.Values(customHeader), ",")
			require.Equal(t, employeeVal, cch)
			ncch := strings.Join(res.Response.Header[nonCanonicalCustomHeader], ",")
			require.Equal(t, "", ncch)

			require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
		})
	})

	t.Run("test matching with regex for response headers", func(t *testing.T) {
		t.Parallel()

		header1, value1 := "header1", "value1"
		header2, value2 := "header2", "value2"
		header3, value3 := "header3", "value3"

		subgraphWithHeaders := testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set(header1, value1)
						w.Header().Set(header2, value2)
						w.Header().Set(header3, value3)
						handler.ServeHTTP(w, r)
					})
				},
			},
		}

		t.Run("for normal match", func(t *testing.T) {
			t.Parallel()

			rule := &config.GlobalHeaderRule{
				Response: []*config.ResponseHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Matching:  `^(` + header2 + `)$`,
						Algorithm: config.ResponseHeaderRuleAlgorithmFirstWrite,
					},
				},
			}

			t.Run("for all", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: subgraphWithHeaders,
					RouterOptions: []core.Option{
						core.WithHeaderRules(config.HeaderRules{
							All: rule,
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithNoHobby,
					})

					result1 := strings.Join(res.Response.Header.Values(header1), ",")
					require.Equal(t, "", result1)

					result2 := strings.Join(res.Response.Header.Values(header2), ",")
					require.Equal(t, value2, result2)

					result3 := strings.Join(res.Response.Header.Values(header3), ",")
					require.Equal(t, "", result3)
				})
			})

			t.Run("for subgraph", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: subgraphWithHeaders,
					RouterOptions: []core.Option{
						core.WithHeaderRules(config.HeaderRules{
							Subgraphs: map[string]*config.GlobalHeaderRule{
								"employees": rule,
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithNoHobby,
					})

					result1 := strings.Join(res.Response.Header.Values(header1), ",")
					require.Equal(t, "", result1)

					result2 := strings.Join(res.Response.Header.Values(header2), ",")
					require.Equal(t, value2, result2)

					result3 := strings.Join(res.Response.Header.Values(header3), ",")
					require.Equal(t, "", result3)
				})
			})
		})

		t.Run("negate match", func(t *testing.T) {
			t.Parallel()

			rules := &config.GlobalHeaderRule{
				Response: []*config.ResponseHeaderRule{
					{
						Operation:   config.HeaderRuleOperationPropagate,
						Matching:    `^(` + header1 + `|` + header2 + `)$`,
						NegateMatch: true,
						Algorithm:   config.ResponseHeaderRuleAlgorithmFirstWrite,
					},
				},
			}

			t.Run("for all", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: subgraphWithHeaders,
					RouterOptions: []core.Option{
						core.WithHeaderRules(config.HeaderRules{
							All: rules,
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithNoHobby,
					})

					result1 := strings.Join(res.Response.Header.Values(header1), ",")
					require.Equal(t, "", result1)

					result2 := strings.Join(res.Response.Header.Values(header2), ",")
					require.Equal(t, "", result2)

					result3 := strings.Join(res.Response.Header.Values(header3), ",")
					require.Equal(t, value3, result3)
				})
			})

			t.Run("for subgraph", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: subgraphWithHeaders,
					RouterOptions: []core.Option{
						core.WithHeaderRules(config.HeaderRules{
							Subgraphs: map[string]*config.GlobalHeaderRule{
								"employees": rules,
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithNoHobby,
					})

					result1 := strings.Join(res.Response.Header.Values(header1), ",")
					require.Equal(t, "", result1)

					result2 := strings.Join(res.Response.Header.Values(header2), ",")
					require.Equal(t, "", result2)

					result3 := strings.Join(res.Response.Header.Values(header3), ",")
					require.Equal(t, value3, result3)
				})
			})
		})
	})
}
