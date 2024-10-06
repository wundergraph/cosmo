package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestHeaderPropagation(t *testing.T) {
	t.Parallel()

	const (
		customHeader = "X-Custom-Header"
		employeeVal  = "employee-value"
		hobbyVal     = "hobby-value"
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

	setSubgraphPropagateHeader := func(header, valA, valB string) testenv.SubgraphsConfig {
		return testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set(header, valA)
						handler.ServeHTTP(w, r)
					})
				},
			},
			Hobbies: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set(header, valB)
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
		return setSubgraphPropagateHeader("Cache-Control", cacheControlEmployees, cacheControlHobbies)
	}

	var (
		subgraphsPropagateCustomHeader = setSubgraphPropagateHeader(customHeader, employeeVal, hobbyVal)
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
	})

	// Test for the First Write Wins Algorithm
	t.Run("FirstWriteWins", func(t *testing.T) {
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
	})

	// Test for the Append Algorithm
	t.Run("AppendHeaders", func(t *testing.T) {
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
	})

	t.Run("Cache Control Propagation", func(t *testing.T) {
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
			})
		})

		// Local test: Cache control rules are applied per subgraph (employees and hobbies)
		t.Run("only enable cache control for subgraphs", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				Subgraphs: cacheOptions("max-age=120", "max-age=60"),
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
				require.Equal(t, "max-age=60", cc) // Most restrictive wins
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
				Subgraphs: cacheOptions("max-age=120", "max-age=60"),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "max-age=120", cc) // Only employee subgraph is considered
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
								&config.ResponseHeaderRule{
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
							"employees": &config.GlobalHeaderRule{
								Response: []*config.ResponseHeaderRule{
									&config.ResponseHeaderRule{
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
	})
}
