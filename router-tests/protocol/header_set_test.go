package integration

import (
	"github.com/wundergraph/cosmo/router-tests/testutils"

	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestHeaderSet(t *testing.T) {
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

	t.Run("RequestSet", func(t *testing.T) {
		t.Parallel()

		getRule := func(name, val string) *config.RequestHeaderRule {
			rule := &config.RequestHeaderRule{
				Operation: config.HeaderRuleOperationSet,
				Name:      name,
				Value:     val,
			}
			return rule
		}

		global := func(name, defaultVal string) []core.Option {
			return []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							getRule(name, defaultVal),
						},
					},
				}),
			}
		}

		t.Run("global request rule sets header", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(customHeader, employeeVal),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Header: http.Header{},
					Query:  fmt.Sprintf(`query { headerValue(name:"%s") }`, customHeader),
				})
				require.Equal(t, fmt.Sprintf(`{"data":{"headerValue":"%s"}}`, employeeVal), res.Body)
			})
		})
	})

	t.Run("ResponseSet", func(t *testing.T) {
		t.Parallel()

		getRule := func(name, val string) *config.ResponseHeaderRule {
			rule := &config.ResponseHeaderRule{
				Operation: config.HeaderRuleOperationSet,
				Name:      name,
				Value:     val,
			}
			return rule
		}

		global := func(name, defaultVal string) []core.Option {
			return []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Response: []*config.ResponseHeaderRule{
							getRule(name, defaultVal),
						},
					},
				}),
			}
		}

		partial := func(name, defaultVal string) []core.Option {
			return []core.Option{
				core.WithHeaderRules(config.HeaderRules{
					Subgraphs: map[string]*config.GlobalHeaderRule{
						"employees": {
							Response: []*config.ResponseHeaderRule{
								getRule(name, defaultVal),
							},
						},
					},
				}),
			}
		}

		t.Run("no set", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "", ch)
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("global set is internal only", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: global(customHeader, hobbyVal),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "", ch, "set response headers should not be forwarded to the client")
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("subgraph set is internal only", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: partial(customHeader, employeeVal),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "", ch, "set response headers should not be forwarded to the client")
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("set followed by propagate forwards to client", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Response: []*config.ResponseHeaderRule{
								{
									Operation: config.HeaderRuleOperationSet,
									Name:      customHeader,
									Value:     "injected-value",
								},
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     customHeader,
									Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "injected-value", ch, "set + propagate should forward the header to the client")
				require.Equal(t, `{"data":{"employee":{"id":1,"hobbies":[{},{"name":"Counter Strike"},{},{},{}]}}}`, res.Body)
			})
		})

		t.Run("set Cache-Control feeds into restrictive algorithm via All rules", func(t *testing.T) {
			t.Parallel()
			// The set rule in All.Response runs before the cache control
			// algorithm (also in All.Response), injecting a Cache-Control
			// value that the algorithm then processes as if the subgraph
			// returned it.
			testenv.Run(t, &testenv.Config{
				CacheControlPolicy: config.CacheControlPolicy{
					Enabled: true,
					Value:   "max-age=300, public",
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Response: []*config.ResponseHeaderRule{
								{
									Operation: config.HeaderRuleOperationSet,
									Name:      "Cache-Control",
									Value:     "max-age=60, public",
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				cc := res.Response.Header.Get("Cache-Control")
				require.Equal(t, "max-age=60, public", cc, "set Cache-Control should feed into the restrictive algorithm")
			})
		})

		t.Run("set overwrites existing subgraph response header", func(t *testing.T) {
			t.Parallel()
			// The employees subgraph returns X-Custom-Header: original-value.
			// A set rule in All.Response overwrites it before the propagate
			// rule sees it, so the client receives the overwritten value.
			testenv.Run(t, &testenv.Config{
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set(customHeader, "original-value")
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Response: []*config.ResponseHeaderRule{
								{
									Operation: config.HeaderRuleOperationSet,
									Name:      customHeader,
									Value:     "overwritten-value",
								},
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     customHeader,
									Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite,
								},
							},
						},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: queryEmployeeWithHobby,
				})
				ch := strings.Join(res.Response.Header.Values(customHeader), ",")
				require.Equal(t, "overwritten-value", ch, "set should overwrite the subgraph's original header before propagate sees it")
			})
		})
	})
}

func TestHeaderSetWithExpression(t *testing.T) {
	t.Parallel()

	const customHeader = "X-Custom-Header"

	getRule := func(name, expr string) *config.RequestHeaderRule {
		rule := &config.RequestHeaderRule{
			Operation:  config.HeaderRuleOperationSet,
			Name:       name,
			Expression: expr,
		}
		return rule
	}

	global := func(name, expr string) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				All: &config.GlobalHeaderRule{
					Request: []*config.RequestHeaderRule{
						getRule(name, expr),
					},
				},
			}),
		}
	}

	subgraph := func(subgraphName, name, expr string) []core.Option {
		return []core.Option{
			core.WithHeaderRules(config.HeaderRules{
				Subgraphs: map[string]*config.GlobalHeaderRule{
					subgraphName: {
						Request: []*config.RequestHeaderRule{
							getRule(name, expr),
						},
					},
				},
			}),
		}
	}

	t.Run("global request rule sets header to static value", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(customHeader, `"static-value"`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{},
				Query:  fmt.Sprintf(`query { headerValue(name:"%s") }`, customHeader),
			})
			assert.Equal(t, `{"data":{"headerValue":"static-value"}}`, res.Body)
		})
	})

	t.Run("global request rule sets header based on another header value", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(customHeader, `request.header.Get("X-Source-Header")`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-Source-Header": []string{"source-value"},
				},
				Query: fmt.Sprintf(`query { headerValue(name:"%s") }`, customHeader),
			})
			assert.Equal(t, `{"data":{"headerValue":"source-value"}}`, res.Body)
		})
	})

	t.Run("subgraph request rule sets header based on another header value", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: subgraph("test1", customHeader, `request.header.Get("X-Source-Header")`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-Source-Header": []string{"source-value"},
				},
				Query: fmt.Sprintf(`query { headerValue(name:"%s") }`, customHeader),
			})
			assert.Equal(t, `{"data":{"headerValue":"source-value"}}`, res.Body)
		})
	})

	t.Run("subgraph request rule don't set header if another header value is not present", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: subgraph("test2", customHeader, `request.header.Get("X-Source-Header")`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-Source-Header": []string{"source-value"},
				},
				Query: fmt.Sprintf(`query { headerValue(name:"%s") }`, customHeader),
			})
			assert.Equal(t, `{"data":{"headerValue":""}}`, res.Body)
		})
	})

	t.Run("global request rule sets header based on auth claim name", func(t *testing.T) {
		t.Parallel()

		rsa1, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		authServer, err := jwks.NewServerWithCrypto(t, rsa1)
		require.NoError(t, err)

		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(testutils.NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         testutils.JwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:           []authentication.Authenticator{authenticator},
			AuthenticationRequired:   true,
			SkipIntrospectionQueries: false,
			IntrospectionSkipSecret:  "",
		})
		require.NoError(t, err)

		token, err := authServer.TokenForKID(rsa1.KID(), map[string]any{"user_id": "TestId"}, false)
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: append(
				global(customHeader, `request.auth.claims.user_id`),
				core.WithAccessController(accessController),
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"Authorization": []string{"Bearer " + token},
				},
				Query: fmt.Sprintf(`query OperationNameTest { headerValue(name:"%s") }`, customHeader),
			})
			assert.Equal(t, `{"data":{"headerValue":"TestId"}}`, res.Body)
		})
	})

	t.Run("router should not start with an invalid request rule", func(t *testing.T) {
		t.Parallel()

		err := testenv.RunWithError(t, &testenv.Config{
			RouterOptions: global(customHeader, `wrong_name`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "router should not start with an invalid request rule")
		})

		require.Error(t, err)
	})

	t.Run("subgraph request rule set header with operation name", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(customHeader, `request.operation.name`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-Source-Header": []string{"source-value"},
				},
				Query: fmt.Sprintf(`query TestOperationName { headerValue(name:"%s") }`, customHeader),
			})
			assert.Equal(t, `{"data":{"headerValue":"TestOperationName"}}`, res.Body)
		})
	})

	t.Run("subgraph request rule set header with operation type", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(customHeader, `request.operation.type`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-Source-Header": []string{"source-value"},
				},
				Query: fmt.Sprintf(`query TestOperationName { headerValue(name:"%s") }`, customHeader),
			})
			assert.Equal(t, `{"data":{"headerValue":"query"}}`, res.Body)
		})
	})

	t.Run("subgraph request rule set header with operation hash", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(customHeader, `request.operation.hash`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := fmt.Sprintf(`query TestOperationName { headerValue(name:"%s") }`, customHeader)
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"X-Source-Header": []string{"source-value"},
				},
				Query: query,
			})
			assert.Equal(t, `{"data":{"headerValue":"16682066937949733641"}}`, res.Body)
		})
	})

	t.Run("subgraph request rule set header with client name and version", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(customHeader, `request.client.name + " " + request.client.version`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := fmt.Sprintf(`query TestOperationName { headerValue(name:"%s") }`, customHeader)
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"graphql-client-name":    []string{"test-client"},
					"graphql-client-version": []string{"1.0.0"},
				},
				Query: query,
			})
			assert.Equal(t, `{"data":{"headerValue":"test-client 1.0.0"}}`, res.Body)
		})
	})

	t.Run("subgraph request rule set header with client name and version", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: global(customHeader, `request.client.name + " " + request.client.version`),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := fmt.Sprintf(`query TestOperationName { headerValue(name:"%s") }`, customHeader)
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Header: http.Header{
					"graphql-client-name":    []string{"test-client"},
					"graphql-client-version": []string{"1.0.0"},
				},
				Query: query,
			})
			assert.Equal(t, `{"data":{"headerValue":"test-client 1.0.0"}}`, res.Body)
		})
	})
}

func toJWKSConfig(url string, refresh time.Duration, allowedAlgorithms ...string) authentication.JWKSConfig {
	return authentication.JWKSConfig{
		URL:               url,
		RefreshInterval:   refresh,
		AllowedAlgorithms: allowedAlgorithms,
	}
}
