package integration

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	failing_writer "github.com/wundergraph/cosmo/router-tests/modules/failing-writer"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
)

// mockSelfRegister implements selfregister.SelfRegister for testing parseRequestOptions error path
type mockSelfRegister struct {
	registrationInfo *nodev1.RegistrationInfo
}

func (m *mockSelfRegister) Register(_ context.Context) (*nodev1.RegistrationInfo, error) {
	return m.registrationInfo, nil
}

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
				Extensions: json.RawMessage(`{"persistedQuery": {"version": 1, "sha256Hash": "` + cacheHashNotStored + `"}}`),
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

	t.Run("Ignored response headers from subgraphs are never propagated", func(t *testing.T) {
		t.Parallel()

		// Test that subgraph response headers in the ignoredHeaders list are never propagated to client,
		// even when propagation rules are configured. The router manages these headers itself.
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "Content-Type",
								Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
							},
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "Content-Encoding",
								Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
							},
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "Connection",
								Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
							},
							{
								Operation: config.HeaderRuleOperationPropagate,
								Named:     "X-Custom-Header",
								Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
							},
						},
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							// Attempt to set ignored headers - these should NOT be propagated
							w.Header().Set("Content-Type", "application/custom-from-subgraph")
							w.Header().Set("Content-Encoding", "gzip-from-subgraph")
							w.Header().Set("Connection", "keep-alive-from-subgraph")
							// This should be propagated
							w.Header().Set("X-Custom-Header", "custom-value")
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})

			// Verify subgraph's ignored headers are NOT propagated to client
			contentType := res.Response.Header.Get("Content-Type")
			require.NotEqual(t, "application/custom-from-subgraph", contentType, "Subgraph Content-Type should not be propagated")

			contentEncoding := res.Response.Header.Get("Content-Encoding")
			require.NotEqual(t, "gzip-from-subgraph", contentEncoding, "Subgraph Content-Encoding should not be propagated")

			connection := res.Response.Header.Get("Connection")
			require.NotEqual(t, "keep-alive-from-subgraph", connection, "Subgraph Connection should not be propagated")

			// Verify custom header IS propagated (not in ignored list)
			require.Equal(t, "custom-value", res.Response.Header.Get("X-Custom-Header"))
		})
	})

	t.Run("Ignored response headers with regex matching are never propagated from subgraphs", func(t *testing.T) {
		t.Parallel()

		// Test that subgraph response headers in the ignoredHeaders list are not propagated
		// even with regex matching rules
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Response: []*config.ResponseHeaderRule{
							{
								Operation: config.HeaderRuleOperationPropagate,
								Matching:  "^Content-.*", // Should match Content-Type, Content-Encoding, Content-Length
								Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
							},
							{
								Operation: config.HeaderRuleOperationPropagate,
								Matching:  ".*", // Match all headers
								Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
							},
						},
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/custom-from-subgraph")
							w.Header().Set("Content-Encoding", "gzip-from-subgraph")
							w.Header().Set("X-Custom-Header", "should-be-propagated")
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})

			// Content-* headers from subgraph should NOT be propagated to client (router manages these)
			contentType := res.Response.Header.Get("Content-Type")
			require.NotEqual(t, "application/custom-from-subgraph", contentType, "Subgraph Content-Type should not be propagated")

			contentEncoding := res.Response.Header.Get("Content-Encoding")
			require.NotEqual(t, "gzip-from-subgraph", contentEncoding, "Subgraph Content-Encoding should not be propagated")

			// X-Custom-Header SHOULD be propagated (not in ignored list)
			require.Equal(t, "should-be-propagated", res.Response.Header.Get("X-Custom-Header"))
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

		// Tests that verify the append algorithm produces a SINGLE header with
		// comma-separated values, not multiple separate headers (issue #2531).
		t.Run("global append produces single comma-separated header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmAppend, customHeader, ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				values := res.Response.Header.Values(customHeader)
				require.Equal(t, 1, len(values),
					"append algorithm should produce a single header with comma-separated values, got %d entries: %v", len(values), values)
				require.Equal(t, "employee-value,hobby-value", values[0])
			})
		})

		t.Run("local append produces single comma-separated header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: local(config.ResponseHeaderRuleAlgorithmAppend, customHeader, "", ""),
				Subgraphs:     subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				values := res.Response.Header.Values(customHeader)
				require.Equal(t, 1, len(values),
					"append algorithm should produce a single header with comma-separated values, got %d entries: %v", len(values), values)
				require.Equal(t, "employee-value,hobby-value", values[0])
			})
		})

		t.Run("repeated header names append produces single comma-separated header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmAppend, customHeader, ""),
				Subgraphs:     subgraphsPropagateRepeatedCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				values := res.Response.Header.Values(customHeader)
				require.Equal(t, 1, len(values),
					"append algorithm should produce a single header with comma-separated values, got %d entries: %v", len(values), values)
				require.Equal(t, "employee-value,employee-value-2,hobby-value,hobby-value-2", values[0])
			})
		})

		t.Run("append with default value produces single header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmAppend, customHeader, "default-val"),
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header()[customHeader] = []string{employeeVal}
								handler.ServeHTTP(w, r)
							})
						},
					},
					// Hobbies does NOT set the header — the default should be used
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				values := res.Response.Header.Values(customHeader)
				require.Equal(t, 1, len(values),
					"append algorithm should produce a single header with comma-separated values, got %d entries: %v", len(values), values)
				require.Equal(t, "employee-value,default-val", values[0])
			})
		})

		t.Run("append with regex matching produces single comma-separated header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Response: []*config.ResponseHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Matching:  "^X-Custom-Header$",
									Algorithm: config.ResponseHeaderRuleAlgorithmAppend,
								},
							},
						},
					}),
				},
				Subgraphs: subgraphsPropagateCustomHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				values := res.Response.Header.Values(customHeader)
				require.Equal(t, 1, len(values),
					"append algorithm should produce a single header with comma-separated values, got %d entries: %v", len(values), values)
				require.Equal(t, "employee-value,hobby-value", values[0])
			})
		})
	})

	// Tests for default value fallback when a subgraph does not return the header
	t.Run("DefaultValue", func(t *testing.T) {
		t.Parallel()

		subgraphsOnlyEmployeeSetsHeader := testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header()[customHeader] = []string{employeeVal}
						handler.ServeHTTP(w, r)
					})
				},
			},
			// Hobbies does NOT set the header
		}

		t.Run("last write with default uses default from non-responding subgraph", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmLastWrite, customHeader, "default-val"),
				Subgraphs:     subgraphsOnlyEmployeeSetsHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := res.Response.Header.Get(customHeader)
				// Hobbies responds last and uses the default value
				require.Equal(t, "default-val", ch)
			})
		})

		t.Run("first write with default keeps first value", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(config.ResponseHeaderRuleAlgorithmFirstWrite, customHeader, "default-val"),
				Subgraphs:     subgraphsOnlyEmployeeSetsHeader,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := res.Response.Header.Get(customHeader)
				// Employees responds first with its actual value
				require.Equal(t, employeeVal, ch)
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

	t.Run("Router Response Header Rules", func(t *testing.T) {
		t.Parallel()

		t.Run("should set router response headers from static expressions", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						Router: config.RouterHeaderRules{
							Response: []*config.RouterResponseHeaderRule{
								{
									Name:       "X-Static-Header",
									Expression: `"static-value"`,
								},
								{
									Name:       "X-Another-Header",
									Expression: `"another-value"`,
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithNoHobby,
				})
				require.Equal(t, "static-value", res.Response.Header.Get("X-Static-Header"))
				require.Equal(t, "another-value", res.Response.Header.Get("X-Another-Header"))
			})
		})

		t.Run("should set router response headers from request headers", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						Router: config.RouterHeaderRules{
							Response: []*config.RouterResponseHeaderRule{
								{
									Name:       "X-Echo-Header",
									Expression: `request.header.Get("X-Custom-Input")`,
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: queryEmployeeWithNoHobby,
					Header: map[string][]string{
						"X-Custom-Input": {"input-value"},
					},
				})
				require.NoError(t, err)
				require.Equal(t, "input-value", res.Response.Header.Get("X-Echo-Header"))
			})
		})

		t.Run("should work alongside response header propagation", func(t *testing.T) {
			t.Parallel()

			t.Run("when there is a separate header", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithHeaderRules(config.HeaderRules{
							All: &config.GlobalHeaderRule{
								Response: []*config.ResponseHeaderRule{
									{
										Operation: config.HeaderRuleOperationPropagate,
										Named:     "X-Custom-Header",
										Algorithm: config.ResponseHeaderRuleAlgorithmFirstWrite,
									},
								},
							},
							Router: config.RouterHeaderRules{
								Response: []*config.RouterResponseHeaderRule{
									{
										Name:       "X-Client-Header",
										Expression: `"client-value"`,
									},
								},
							},
						}),
					},
					Subgraphs: subgraphsPropagateCustomHeader,
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithHobby,
					})
					// Check that both router response header and propagated response header are present
					require.Equal(t, "client-value", res.Response.Header.Get("X-Client-Header"))
					require.Equal(t, employeeVal, res.Response.Header.Get("X-Custom-Header"))
				})
			})

			t.Run("when the same header is in use", func(t *testing.T) {
				t.Parallel()

				t.Run("ensure router response header overrides", func(t *testing.T) {
					t.Parallel()

					testenv.Run(t, &testenv.Config{
						RouterOptions: []core.Option{
							core.WithHeaderRules(config.HeaderRules{
								All: &config.GlobalHeaderRule{
									Response: []*config.ResponseHeaderRule{
										{
											Operation: config.HeaderRuleOperationPropagate,
											Named:     "X-Custom-Header",
											Algorithm: config.ResponseHeaderRuleAlgorithmFirstWrite,
										},
									},
								},
								Router: config.RouterHeaderRules{
									Response: []*config.RouterResponseHeaderRule{
										{
											Name:       "X-Custom-Header",
											Expression: `"client-value"`,
										},
									},
								},
							}),
						},
						Subgraphs: subgraphsPropagateCustomHeader,
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
							Query: queryEmployeeWithHobby,
						})
						require.Equal(t, "client-value", res.Response.Header.Get("X-Custom-Header"))
					})
				})
			})
		})

		t.Run("should work alongside request header propagation", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "X-Request-Header",
								},
							},
						},
						Router: config.RouterHeaderRules{
							Response: []*config.RouterResponseHeaderRule{
								{
									Name:       "X-Router-Header",
									Expression: `request.header.Get("X-Request-Header")`,
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify the request header was propagated to the subgraph
								require.Equal(t, "request-value", r.Header.Get("X-Request-Header"))
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: queryEmployeeWithNoHobby,
					Header: map[string][]string{
						"X-Request-Header": {"request-value"},
					},
				})
				require.NoError(t, err)
				require.Equal(t, "request-value", res.Response.Header.Get("X-Router-Header"))
			})
		})

		t.Run("should work alongside both request and response header propagation", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "X-Request-Header",
								},
							},
							Response: []*config.ResponseHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "X-Verification",
									Algorithm: config.ResponseHeaderRuleAlgorithmFirstWrite,
								},
							},
						},
						Router: config.RouterHeaderRules{
							Response: []*config.RouterResponseHeaderRule{
								{
									Name:       "X-Router-Header",
									Expression: `request.header.Get("X-Request-Header")`,
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify the request header was propagated to the subgraph
								if r.Header.Get("X-Request-Header") == "request-value" {
									w.Header().Set("X-Verification", "passed")
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: queryEmployeeWithNoHobby,
					Header: map[string][]string{
						"X-Request-Header": {"request-value"},
					},
				})
				require.NoError(t, err)
				require.Equal(t, "passed", res.Response.Header.Get("X-Verification"))
				require.Equal(t, "request-value", res.Response.Header.Get("X-Router-Header"))
			})
		})

		t.Run("should ignore rules that resolve to empty string", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						Router: config.RouterHeaderRules{
							Response: []*config.RouterResponseHeaderRule{
								{
									Name:       "X-Empty-Header",
									Expression: `""`,
								},
								{
									Name:       "X-Missing-Header",
									Expression: `request.header.Get("X-Does-Not-Exist")`,
								},
								{
									Name:       "X-Valid-Header",
									Expression: `"valid-value"`,
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithNoHobby,
				})
				// Empty headers should not be set
				require.Equal(t, "", res.Response.Header.Get("X-Empty-Header"))
				require.Equal(t, "", res.Response.Header.Get("X-Missing-Header"))
				// Valid header should be set
				require.Equal(t, "valid-value", res.Response.Header.Get("X-Valid-Header"))
			})
		})

		t.Run("should work with errors in response", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						Router: config.RouterHeaderRules{
							Response: []*config.RouterResponseHeaderRule{
								{
									Name:       "X-Router-Header",
									Expression: `"router-value"`,
								},
								{
									Name:       "X-Error-Header",
									Expression: `request.error != nil ? "error" : "success"`,
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id: 1) { id rootFieldThrowsError } }`,
				})
				// Router response header should still be set even with errors
				require.Equal(t, "router-value", res.Response.Header.Get("X-Router-Header"))
				require.Equal(t, "error", res.Response.Header.Get("X-Error-Header"))
			})
		})

		t.Run("should log errors (but not error out)", func(t *testing.T) {
			t.Parallel()

			t.Run("when request is successful", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.ErrorLevel,
					},
					RouterOptions: []core.Option{
						core.WithHeaderRules(config.HeaderRules{
							Router: config.RouterHeaderRules{
								Response: []*config.RouterResponseHeaderRule{
									{
										Name:       "X-Valid-Header",
										Expression: `"valid-value"`,
									},
									{
										Name:       "X-Invalid-Header",
										Expression: `string(int("a"))`,
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: queryEmployeeWithNoHobby,
					})

					require.Equal(t, "valid-value", res.Response.Header.Get("X-Valid-Header"))

					_, headerExists := res.Response.Header["X-Invalid-Header"]
					require.False(t, headerExists)

					require.Equal(t, http.StatusOK, res.Response.StatusCode)
					require.Contains(t, res.Body, `"data"`)

					logs := xEnv.Observer()
					require.NotNil(t, logs)

					errorLogs := logs.FilterMessage("Failed to apply router response header rules").All()
					require.Len(t, errorLogs, 1)

					errorLog := errorLogs[0]
					require.Equal(t, zapcore.ErrorLevel, errorLog.Level)
					require.Equal(t, "Failed to apply router response header rules", errorLog.Message)
					require.NotEmpty(t, errorLog.Context)
				})
			})

			t.Run("when request is not successful", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					LogObservation: testenv.LogObservationConfig{
						Enabled:  true,
						LogLevel: zapcore.ErrorLevel,
					},
					RouterOptions: []core.Option{
						core.WithHeaderRules(config.HeaderRules{
							Router: config.RouterHeaderRules{
								Response: []*config.RouterResponseHeaderRule{
									{
										Name:       "X-Invalid-Header",
										Expression: `string(int("a"))`,
									},
								},
							},
						}),
						core.WithModulesConfig(map[string]interface{}{
							"failingWriterModule": failing_writer.FailingWriterModule{
								ErrorType: failing_writer.ErrorTypeGeneric,
							},
						}),
						core.WithCustomModules(&failing_writer.FailingWriterModule{
							ErrorType: failing_writer.ErrorTypeGeneric,
						}),
					},
					Subgraphs: testenv.SubgraphsConfig{
						Products: testenv.SubgraphConfig{
							CloseOnStart: true,
						},
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: "",
					})
					require.NoError(t, err)
					require.NotNil(t, res)

					logs := xEnv.Observer()
					require.NotNil(t, logs)

					errorLogs := logs.FilterMessage("Failed to apply router response header rules on error cases").All()
					require.Len(t, errorLogs, 1)

					errorLog := errorLogs[0]
					require.Equal(t, zapcore.ErrorLevel, errorLog.Level)
					require.NotEmpty(t, errorLog.Context)
				})
			})
		})
	})
}

func TestHeaderPropagationOnErrorResponses(t *testing.T) {
	t.Parallel()

	t.Run("router response headers should be propagated on GraphQL validation errors", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					Router: config.RouterHeaderRules{
						Response: []*config.RouterResponseHeaderRule{
							{
								Name:       "X-Error-Message",
								Expression: `string(request.error)`,
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send an invalid query that will cause a validation error
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ nonExistentField }`,
			})
			require.NoError(t, err)

			require.Contains(t, res.Body, "errors")
			require.Equal(t, "Cannot query field \"nonExistentField\" on type \"Query\".", res.Response.Header.Get("X-Error-Message"))
		})
	})

	t.Run("router response headers should be propagated on bad request errors", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					Router: config.RouterHeaderRules{
						Response: []*config.RouterResponseHeaderRule{

							{
								Name:       "X-Error-Message",
								Expression: `string(request.error)`,
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send a request with missing query
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: "", // Empty query should trigger a bad request error
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)

			require.Contains(t, res.Body, "errors")
			require.Equal(t, "empty request body", res.Response.Header.Get("X-Error-Message"))
		})
	})

	t.Run("router response headers should be propagated on persisted query not found errors", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					Router: config.RouterHeaderRules{
						Response: []*config.RouterResponseHeaderRule{
							{
								Name:       "X-Error-Message",
								Expression: `string(request.error)`,
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send a persisted query request with a hash that doesn't exist
			nonExistentHash := "22222db46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b39"
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Extensions: json.RawMessage(`{"persistedQuery": {"version": 1, "sha256Hash": "` + nonExistentHash + `"}}`),
			})
			require.NoError(t, err)

			require.Contains(t, res.Body, "errors")
			require.Equal(t, "operation '"+nonExistentHash+"' for client 'unknown' not found", res.Response.Header.Get("X-Error-Message"))
		})
	})

	t.Run("router response headers should be propagated when subgraph is unreachable", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					Router: config.RouterHeaderRules{
						Response: []*config.RouterResponseHeaderRule{
							{
								Name:       "X-Error-Message",
								Expression: `string(request.error)`,
							},
						},
					},
				}),
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

			require.Contains(t, res.Body, "Failed to fetch from Subgraph")

			require.Contains(t, res.Response.Header.Get("X-Error-Message"), "connect: connection refused Failed to fetch from Subgraph 'products' at Path: 'employees'.")
		})
	})

	t.Run("router response headers should be propagated on file upload failure", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithFileUploadConfig(&config.FileUpload{
					Enabled: false,
				}),
				core.WithHeaderRules(config.HeaderRules{
					Router: config.RouterHeaderRules{
						Response: []*config.RouterResponseHeaderRule{
							{
								Name:       "X-Error-Message",
								Expression: `string(request.error)`,
							},
						},
					},
				})},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			files := []testenv.FileUpload{
				{VariablesPath: "variables.files.0", FileContent: []byte("File1 content as text")},
			}
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     "mutation($files: [Upload!]!) { multipleUpload(files: $files)}",
				Variables: []byte(`{"files":[null]}`),
				Files:     files,
			})
			require.JSONEq(t, `{"errors":[{"message":"file upload disabled"}]}`, res.Body)

			require.Equal(t, "file upload disabled", res.Response.Header.Get("X-Error-Message"))
		})
	})

	t.Run("router response headers should NOT be propagated on subscription errors", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					Router: config.RouterHeaderRules{
						Response: []*config.RouterResponseHeaderRule{
							{
								Name:       "X-Custom-Header",
								Expression: `"should-not-appear"`,
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), strings.NewReader(`{"query":"subscription { nonExistentSubscription }"}`))
			require.NoError(t, err)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")

			client := http.Client{}
			resp, err := client.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			// Read the response body
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			// Response should contain an error
			require.Contains(t, string(body), "errors")

			// Router response headers should NOT be propagated for subscriptions
			require.Empty(t, resp.Header.Get("X-Custom-Header"))
		})
	})

	t.Run("router response headers should be propagated when failure due to invalid JWT token", func(t *testing.T) {
		t.Parallel()

		privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		require.NoError(t, err)
		publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
		require.NoError(t, err)
		publicKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicKeyBytes})

		mockSR := &mockSelfRegister{
			registrationInfo: &nodev1.RegistrationInfo{
				GraphPublicKey: string(publicKeyPEM),
				AccountLimits:  &nodev1.AccountLimits{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithDevelopmentMode(false), // Disable dev mode so JWT validation is required
				core.WithSelfRegistration(mockSR),
				core.WithHeaderRules(config.HeaderRules{
					Router: config.RouterHeaderRules{
						Response: []*config.RouterResponseHeaderRule{
							{
								Name:       "X-Error-Message",
								Expression: `string(request.error)`,
							},
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
				Header: map[string][]string{
					"X-WG-Token": {"invalid-jwt-token"},
				},
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)

			require.Contains(t, res.Body, "errors")
			require.Equal(t, "token is malformed: token contains an invalid number of segments", res.Response.Header.Get("X-Error-Message"))
		})
	})
}
