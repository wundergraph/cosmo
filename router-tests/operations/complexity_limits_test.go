package integration

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/sdk/metric"
)

func TestComplexityLimits(t *testing.T) {
	t.Parallel()
	t.Run("old max query depth configuration still works", func(t *testing.T) {
		t.Parallel()
		t.Run("disabled max query depth does not block", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					if securityConfiguration.DepthLimit == nil {
						securityConfiguration.DepthLimit = &config.QueryDepthConfiguration{}
					}
					securityConfiguration.DepthLimit.Enabled = false
					securityConfiguration.DepthLimit.Limit = 0
					securityConfiguration.DepthLimit.CacheSize = 1024
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			})
		})

		t.Run("allows queries up to the max depth", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					if securityConfiguration.DepthLimit == nil {
						securityConfiguration.DepthLimit = &config.QueryDepthConfiguration{}
					}
					securityConfiguration.DepthLimit.Enabled = true
					securityConfiguration.DepthLimit.Limit = 3
					securityConfiguration.DepthLimit.CacheSize = 1024
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			})
		})

		t.Run("limits are checked for introspection queries by default", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithIntrospection(true, config.IntrospectionConfiguration{
						Enabled: true,
					}),
				},
				ModifySecurityConfiguration: func(c *config.SecurityConfiguration) {
					if c.ComplexityLimits == nil {
						c.ComplexityLimits = &config.ComplexityLimits{
							Depth: &config.ComplexityLimit{
								Enabled: true,
								Limit:   1,
							},
						}
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `
						query IntrospectionQuery {
						  __schema {
							types { ...FullType }
						  }
						}
						fragment FullType on __Type {
						  kind
						  name
						  description
						  fields(includeDeprecated: true) {
							name
							description
							type {
							  ...TypeRef
							}
							isDeprecated
							deprecationReason
						  }
						  possibleTypes {
							...TypeRef
						  }
						}
						fragment TypeRef on __Type {
						  kind
						  name
						  ofType {
							kind
							name
							ofType {
							  kind
							  name
							  ofType {
								kind
								name
								ofType {
								  kind
								  name
								}
							  }
							}
						  }
						}`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 9 exceeds the max query depth allowed (1)"}]}`, res.Body)
			})
		})

		t.Run("skipped limits for introspection queries", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithIntrospection(true, config.IntrospectionConfiguration{
						Enabled: true,
					}),
				},
				ModifySecurityConfiguration: func(c *config.SecurityConfiguration) {
					if c.ComplexityLimits == nil {
						c.ComplexityLimits = &config.ComplexityLimits{
							IgnoreIntrospection: true,
							Depth: &config.ComplexityLimit{
								Enabled: true,
								Limit:   1,
							},
						}
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `
						query IntrospectionQuery {
						  __schema {
							types { ...FullType }
						  }
						}
						fragment FullType on __Type {
						  kind
						  name
						  description
						  fields(includeDeprecated: true) {
							name
							description
							type {
							  ...TypeRef
							}
							isDeprecated
							deprecationReason
						  }
						  possibleTypes {
							...TypeRef
						  }
						}
						fragment TypeRef on __Type {
						  kind
						  name
						  ofType {
							kind
							name
							ofType {
							  kind
							  name
							  ofType {
								kind
								name
								ofType {
								  kind
								  name
								}
							  }
							}
						  }
						}`,
				})
				require.Contains(t, res.Body, `"types":[{"kind":"OBJECT","name":"Query","description":"","fields":[{"name":"employee","description":"","type":{"kind":"OBJECT","name":"Employee","ofType":null}`)
			})
		})

		t.Run("max query depth blocks queries over the limit", func(t *testing.T) {
			t.Parallel()
			for _, limit := range []int{0, 2} {
				t.Run(fmt.Sprintf("limit %d", limit), func(t *testing.T) {
					t.Parallel()
					testenv.Run(t, &testenv.Config{
						ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
							if securityConfiguration.DepthLimit == nil {
								securityConfiguration.DepthLimit = &config.QueryDepthConfiguration{}
							}
							securityConfiguration.DepthLimit.Enabled = true
							securityConfiguration.DepthLimit.Limit = limit
							securityConfiguration.DepthLimit.CacheSize = 1024
						},
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
							Query: `{ employee(id:1) { id details { forename surname } } }`,
						})
						require.Equal(t, 400, res.Response.StatusCode)
						require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (%d)"}]}`, limit), res.Body)
					})
				})
			}
		})

		t.Run("max query depth blocks persisted queries over the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					if securityConfiguration.DepthLimit == nil {
						securityConfiguration.DepthLimit = &config.QueryDepthConfiguration{}
					}
					securityConfiguration.DepthLimit.Enabled = true
					securityConfiguration.DepthLimit.Limit = 2
					securityConfiguration.DepthLimit.CacheSize = 1024
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, _ := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(`Find`),
					Variables:     []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
					Header:        header,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, res.Body)
			})
		})

		t.Run("max query depth doesn't block persisted queries if DisableDepthLimitPersistedOperations set", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					if securityConfiguration.DepthLimit == nil {
						securityConfiguration.DepthLimit = &config.QueryDepthConfiguration{}
					}
					securityConfiguration.DepthLimit.Enabled = true
					securityConfiguration.DepthLimit.Limit = 2
					securityConfiguration.DepthLimit.CacheSize = 1024
					securityConfiguration.DepthLimit.IgnorePersistedOperations = true
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, _ := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(`Find`),
					Variables:     []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
					Header:        header,
				})
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)
			})
		})

		t.Run("query depth validation caches success and failure runs", func(t *testing.T) {
			t.Parallel()

			metricReader := metric.NewManualReader()
			exporter := tracetest.NewInMemoryExporter(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				MetricReader:  metricReader,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					if securityConfiguration.DepthLimit == nil {
						securityConfiguration.DepthLimit = &config.QueryDepthConfiguration{}
					}
					securityConfiguration.DepthLimit.Enabled = true
					securityConfiguration.DepthLimit.Limit = 2
					securityConfiguration.DepthLimit.CacheSize = 1024
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				failedRes, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, failedRes.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, failedRes.Body)

				testSpan := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepth.Int(3))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryTotalFields.Int(5))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()
				// wait to let cache get consistent
				time.Sleep(100 * time.Millisecond)

				failedRes2, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, failedRes2.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, failedRes2.Body)

				testSpan2 := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepth.Int(3))
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryTotalFields.Int(5))
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
				exporter.Reset()
				// wait to let cache get consistent
				time.Sleep(100 * time.Millisecond)

				successRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, testutils.EmployeesIDData, successRes.Body)
				testSpan3 := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryDepth.Int(2))
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()
				// wait to let cache get consistent
				time.Sleep(100 * time.Millisecond)

				successRes2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, testutils.EmployeesIDData, successRes2.Body)
				testSpan4 := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryDepth.Int(2))
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
			})
		})
	})

	t.Run("depth limit", func(t *testing.T) {
		t.Parallel()
		t.Run("depth limit blocks queries over the limit", func(t *testing.T) {
			t.Parallel()
			for _, limit := range []int{0, 2} {
				t.Run(fmt.Sprintf("limit %d", limit), func(t *testing.T) {
					t.Parallel()
					testenv.Run(t, &testenv.Config{
						ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
							securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
								Depth: &config.ComplexityLimit{
									Enabled: true,
									Limit:   limit,
								},
							}
						},
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
							Query: `{ employee(id:1) { id details { forename surname } } }`,
						})
						require.Equal(t, 400, res.Response.StatusCode)
						require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (%d)"}]}`, limit), res.Body)
					})
				})
			}
		})

		t.Run("depth limit blocks persisted queries over the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Depth: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, _ := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(`Find`),
					Variables:     []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
					Header:        header,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, res.Body)
			})
		})

		t.Run("depth limit doesn't block persisted queries if IgnorePersistedOperations set", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Depth: &config.ComplexityLimit{
							Enabled:                   true,
							Limit:                     0,
							IgnorePersistedOperations: true,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res, _ := xEnv.MakeGraphQLRequestOverGET(testenv.GraphQLRequest{
					OperationName: []byte(`Find`),
					Variables:     []byte(`{"criteria":  {"nationality":  "GERMAN"   }}`),
					Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "e33580cf6276de9a75fb3b1c4b7580fec2a1c8facd13f3487bf6c7c3f854f7e3"}}`),
					Header:        header,
				})
				require.Equal(t, 200, res.Response.StatusCode)
				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)
			})
		})
	})

	t.Run("total fields limit", func(t *testing.T) {
		t.Parallel()

		t.Run("total fields limit blocks queries over the limit", func(t *testing.T) {
			t.Parallel()
			for _, limit := range []int{0, 1, 4} {
				t.Run(fmt.Sprintf("limit %d", limit), func(t *testing.T) {
					t.Parallel()
					testenv.Run(t, &testenv.Config{
						ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
							securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
								TotalFields: &config.ComplexityLimit{
									Enabled: true,
									Limit:   limit,
								},
							}
						},
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
							Query: `{ employee(id:1) { id details { forename surname } } }`,
						})
						require.Equal(t, 400, res.Response.StatusCode)
						require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"The total number of fields 5 exceeds the limit allowed (%d)"}]}`, limit), res.Body)
					})
				})
			}
		})

		t.Run("total fields allows queries at the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						TotalFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   5,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			})
		})
	})

	t.Run("total fields counts leaf fields without increasing depth", func(t *testing.T) {
		t.Parallel()

		for _, leaves := range []int{1, 4, 8, 20, 50, 200} {
			t.Run(fmt.Sprintf("%d leaves", leaves), func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					ModifySecurityConfiguration: func(c *config.SecurityConfiguration) {
						c.ComplexityLimits = &config.ComplexityLimits{
							TotalFields: &config.ComplexityLimit{Enabled: true, Limit: 3},
						}
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					var query strings.Builder
					query.WriteString(`{ employee(id: 1) { details {`)
					for i := range leaves {
						fmt.Fprintf(&query, "field%d: forename ", i)
					}
					query.WriteString(`} } }`)

					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: query.String()})
					require.NoError(t, err)
					if leaves == 1 {
						require.Equal(t, http.StatusOK, res.Response.StatusCode)
						require.JSONEq(t, `{"data":{"employee":{"details":{"field0":"Jens"}}}}`, res.Body)
						return
					}
					require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
					require.JSONEq(t, fmt.Sprintf(`{"errors":[{"message":"The total number of fields %d exceeds the limit allowed (3)"}]}`, leaves+2), res.Body)
				})
			})
		}
	})

	t.Run("total fields counts scalar root fields", func(t *testing.T) {
		t.Parallel()

		for _, field := range []string{"initialPayload", "__typename"} {
			t.Run(field, func(t *testing.T) {
				t.Parallel()
				testenv.Run(t, &testenv.Config{
					ModifySecurityConfiguration: func(c *config.SecurityConfiguration) {
						c.ComplexityLimits = &config.ComplexityLimits{
							TotalFields: &config.ComplexityLimit{Enabled: true, Limit: 2},
						}
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: fmt.Sprintf(`{ first: %[1]s second: %[1]s third: %[1]s }`, field),
					})
					require.NoError(t, err)
					require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
					require.JSONEq(t, `{"errors":[{"message":"The total number of fields 3 exceeds the limit allowed (2)"}]}`, res.Body)
				})
			})
		}
	})

	t.Run("root fields limit", func(t *testing.T) {
		t.Parallel()

		t.Run("root fields limit blocks queries over the limit", func(t *testing.T) {
			t.Parallel()
			for _, limit := range []int{0, 2} {
				t.Run(fmt.Sprintf("limit %d", limit), func(t *testing.T) {
					t.Parallel()
					testenv.Run(t, &testenv.Config{
						ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
							securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
								RootFields: &config.ComplexityLimit{
									Enabled: true,
									Limit:   limit,
								},
							}
						},
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
							Query: `query { initialPayload employee(id:1) { id } employees { id } }`,
						})
						require.Equal(t, 400, res.Response.StatusCode)
						require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"The number of root fields 3 exceeds the root field limit allowed (%d)"}]}`, limit), res.Body)
					})
				})
			}
		})

		t.Run("root fields allows queries under the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						RootFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employee(id:1) { id } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			})
		})
	})

	t.Run("root field aliases limit", func(t *testing.T) {
		t.Parallel()

		t.Run("root field aliases limit blocks queries over the limit", func(t *testing.T) {
			t.Parallel()
			for _, limit := range []int{0, 1} {
				t.Run(fmt.Sprintf("limit %d", limit), func(t *testing.T) {
					t.Parallel()
					testenv.Run(t, &testenv.Config{
						ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
							securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
								RootFieldAliases: &config.ComplexityLimit{
									Enabled: true,
									Limit:   limit,
								},
							}
						},
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
							Query: `query { firstemployee: employee(id:1) { id } employee2: employee(id:2) { id } }`,
						})
						require.Equal(t, 400, res.Response.StatusCode)
						require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"The number of root field aliases 2 exceeds the root field aliases limit allowed (%d)"}]}`, limit), res.Body)
					})
				})
			}
		})

		t.Run("root field aliases allows queries under the limit", func(t *testing.T) {
			t.Parallel()
			testCases := []struct {
				limit int
				query string
				body  string
			}{
				{
					limit: 2,
					query: `query { firstemployee: employee(id:1) { id } employee2: employee(id:2) { id } }`,
					body:  `{"data":{"firstemployee":{"id":1},"employee2":{"id":2}}}`,
				},
				{
					limit: 0,
					query: `query { employee(id:1) { employeeId: id } }`,
					body:  `{"data":{"employee":{"employeeId":1}}}`,
				},
			}

			for _, tc := range testCases {
				t.Run(fmt.Sprintf("limit %d", tc.limit), func(t *testing.T) {
					t.Parallel()
					testenv.Run(t, &testenv.Config{
						ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
							securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
								RootFieldAliases: &config.ComplexityLimit{
									Enabled: true,
									Limit:   tc.limit,
								},
							}
						},
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: tc.query})
						require.JSONEq(t, tc.body, res.Body)
					})
				})
			}
		})
	})

	t.Run("measure mode", func(t *testing.T) {
		t.Parallel()

		t.Run("measure mode does not block queries exceeding depth limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Mode: config.ComplexityLimitsModeMeasure,
						Depth: &config.ComplexityLimit{
							Enabled: true,
							Limit:   0,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			})
		})

		t.Run("measure mode does not block queries exceeding total fields limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Mode: config.ComplexityLimitsModeMeasure,
						TotalFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   0,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			})
		})

		t.Run("measure mode does not block queries exceeding root fields limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Mode: config.ComplexityLimitsModeMeasure,
						RootFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   0,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { initialPayload employee(id:1) { id } employees { id } }`,
				})
				require.Contains(t, res.Body, `"initialPayload"`)
			})
		})

		t.Run("measure mode does not block queries exceeding root field aliases limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Mode: config.ComplexityLimitsModeMeasure,
						RootFieldAliases: &config.ComplexityLimit{
							Enabled: true,
							Limit:   0,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { firstemployee: employee(id:1) { id } employee2: employee(id:2) { id } }`,
				})
				require.Equal(t, `{"data":{"firstemployee":{"id":1},"employee2":{"id":2}}}`, res.Body)
			})
		})

		t.Run("measure mode still reports complexity in OTel spans", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Mode: config.ComplexityLimitsModeMeasure,
						Depth: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Query exceeds depth limit of 2 (actual depth is 3) but should succeed in measure mode
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)

				testSpan := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepth.Int(3))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryTotalFields.Int(5))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
			})
		})

		t.Run("measure mode caches complexity and reports cache hit", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Mode: config.ComplexityLimitsModeMeasure,
						Depth: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
						},
					}
					securityConfiguration.ComplexityCalculationCache = &config.ComplexityCalculationCache{
						Enabled:   true,
						CacheSize: 1024,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// First request - should compute and cache
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)

				testSpan := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepth.Int(3))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryTotalFields.Int(5))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()

				// Wait for cache consistency
				time.Sleep(100 * time.Millisecond)

				// Second request - should use cache and still succeed in measure mode
				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res2.Body)

				testSpan2 := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepth.Int(3))
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryTotalFields.Int(5))
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
			})
		})

		t.Run("enforce mode still blocks queries (default behavior)", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Mode: config.ComplexityLimitsModeEnforce,
						Depth: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, res.Body)
			})
		})

		t.Run("default mode is enforce and blocks queries", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						Depth: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, res.Body)
			})
		})
	})

	t.Run("fragments", func(t *testing.T) {
		t.Parallel()

		depthLimit := func(limit int) *config.ComplexityLimits {
			return &config.ComplexityLimits{Depth: &config.ComplexityLimit{Enabled: true, Limit: limit}}
		}
		totalFieldsLimit := func(limit int) *config.ComplexityLimits {
			return &config.ComplexityLimits{TotalFields: &config.ComplexityLimit{Enabled: true, Limit: limit}}
		}
		rootFieldsLimit := func(limit int) *config.ComplexityLimits {
			return &config.ComplexityLimits{RootFields: &config.ComplexityLimit{Enabled: true, Limit: limit}}
		}
		rootFieldAliasesLimit := func(limit int) *config.ComplexityLimits {
			return &config.ComplexityLimits{RootFieldAliases: &config.ComplexityLimit{Enabled: true, Limit: limit}}
		}

		// Each operation selects its fields through fragments and must be measured exactly like its
		// hand-inlined equivalent: blocked with the exact value one below the limit, allowed at the limit.
		testCases := []struct {
			name         string
			limits       func(limit int) *config.ComplexityLimits
			errorMessage string // formatted with the computed value and the limit
			value        int
			query        string
			inlinedQuery string
			data         string
		}{
			{
				name:         "depth follows nested named fragments",
				limits:       depthLimit,
				errorMessage: "The query depth %d exceeds the max query depth allowed (%d)",
				value:        5,
				query: `
					query {
					  employee(id: 1) { ...EmployeeLocation }
					}
					fragment EmployeeLocation on Employee { details { ...DetailsLocation } }
					fragment DetailsLocation on Details { location { ...CountryKey } }
					fragment CountryKey on Country { key { name } }`,
				inlinedQuery: `{ employee(id: 1) { details { location { key { name } } } } }`,
				data:         `{"data":{"employee":{"details":{"location":{"key":{"name":"Germany"}}}}}}`,
			},
			{
				name:         "total fields counts leaf fields and __typename inside fragments",
				limits:       totalFieldsLimit,
				errorMessage: "The total number of fields %d exceeds the limit allowed (%d)",
				value:        7,
				query: `
					query {
					  employee(id: 1) { ...EmployeeFields }
					}
					fragment EmployeeFields on Employee { __typename id details { ...DetailsNames } }
					fragment DetailsNames on Details { __typename forename surname }`,
				inlinedQuery: `{ employee(id: 1) { __typename id details { __typename forename surname } } }`,
				data:         `{"data":{"employee":{"__typename":"Employee","id":1,"details":{"__typename":"Details","forename":"Jens","surname":"Neuse"}}}}`,
			},
			{
				name:         "root fields counts fields of root level fragment spreads",
				limits:       rootFieldsLimit,
				errorMessage: "The number of root fields %d exceeds the root field limit allowed (%d)",
				value:        3,
				query: `
					query { ...RootFields }
					fragment RootFields on Query { employee(id: 1) { id } ...MoreRootFields }
					fragment MoreRootFields on Query { employeeAsList(id: 2) { id } firstEmployee { id } }`,
				inlinedQuery: `{ employee(id: 1) { id } employeeAsList(id: 2) { id } firstEmployee { id } }`,
				data:         `{"data":{"employee":{"id":1},"employeeAsList":[{"id":2}],"firstEmployee":{"id":1}}}`,
			},
			{
				name:         "root field aliases counts aliases inside root level fragment spreads",
				limits:       rootFieldAliasesLimit,
				errorMessage: "The number of root field aliases %d exceeds the root field aliases limit allowed (%d)",
				value:        2,
				query: `
					query { ...AliasedRootFields }
					fragment AliasedRootFields on Query { first: employee(id: 1) { id } ...MoreAliasedRootFields }
					fragment MoreAliasedRootFields on Query { second: employee(id: 2) { id } employee(id: 3) { id } }`,
				inlinedQuery: `{ first: employee(id: 1) { id } second: employee(id: 2) { id } employee(id: 3) { id } }`,
				data:         `{"data":{"first":{"id":1},"second":{"id":2},"employee":{"id":3}}}`,
			},
			{
				name:         "total fields counts named and inline fragments on interfaces",
				limits:       totalFieldsLimit,
				errorMessage: "The total number of fields %d exceeds the limit allowed (%d)",
				value:        7,
				query: `
					query {
					  employee(id: 1) { ...IdentifiableFields role { ...RoleFields } }
					}
					fragment IdentifiableFields on Identifiable { id }
					fragment RoleFields on RoleType {
					  title
					  ... on Engineer { ...EngineerFields }
					  ... on Operator { operatorType }
					}
					fragment EngineerFields on Engineer { __typename engineerType }`,
				inlinedQuery: `{ employee(id: 1) { id role { title ... on Engineer { __typename engineerType } ... on Operator { operatorType } } } }`,
				data:         `{"data":{"employee":{"id":1,"role":{"title":["Founder","CEO"],"__typename":"Engineer","engineerType":"BACKEND"}}}}`,
			},
			{
				name:         "depth follows named and inline fragments on unions",
				limits:       depthLimit,
				errorMessage: "The query depth %d exceeds the max query depth allowed (%d)",
				value:        4,
				query: `
					query {
					  products { ...ProductFields }
					}
					fragment ProductFields on Products {
					  __typename
					  ... on Consultancy { upc lead { ...LeadFields } }
					  ...CosmoFields
					}
					fragment CosmoFields on Cosmo { upc lead { id } }
					fragment LeadFields on Employee { id details { forename } }`,
				inlinedQuery: `{ products { __typename ... on Consultancy { upc lead { id details { forename } } } ... on Cosmo { upc lead { id } } } }`,
				data:         `{"data":{"products":[{"__typename":"Consultancy","upc":"consultancy","lead":{"id":1,"details":{"forename":"Jens"}}},{"__typename":"Cosmo","upc":"cosmo","lead":{"id":2}},{"__typename":"SDK"}]}}`,
			},
			{
				// Only the spreads repeat (no field is also selected outside its fragment), so the value
				// is the same whether or not normalization merged the repeated selections first.
				name:         "repeated fragment spreads in one selection set are counted once",
				limits:       totalFieldsLimit,
				errorMessage: "The total number of fields %d exceeds the limit allowed (%d)",
				value:        5,
				query: `
					query {
					  employee(id: 1) { ...EmployeeFields ...EmployeeFields }
					}
					fragment EmployeeFields on Employee { id details { ...DetailsNames ...DetailsNames } }
					fragment DetailsNames on Details { forename surname }`,
				inlinedQuery: `{ employee(id: 1) { id details { forename surname } } }`,
				data:         `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`,
			},
			{
				name:         "repeated root level fragment spreads are counted once",
				limits:       rootFieldsLimit,
				errorMessage: "The number of root fields %d exceeds the root field limit allowed (%d)",
				value:        2,
				query: `
					query { ...RootFields ...RootFields ...RootFields }
					fragment RootFields on Query { employee(id: 1) { id } employeeAsList(id: 2) { id } }`,
				inlinedQuery: `{ employee(id: 1) { id } employeeAsList(id: 2) { id } }`,
				data:         `{"data":{"employee":{"id":1},"employeeAsList":[{"id":2}]}}`,
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				for _, limit := range []int{tc.value - 1, tc.value} {
					t.Run(fmt.Sprintf("limit %d", limit), func(t *testing.T) {
						t.Parallel()
						testenv.Run(t, &testenv.Config{
							ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
								securityConfiguration.ComplexityLimits = tc.limits(limit)
							},
						}, func(t *testing.T, xEnv *testenv.Environment) {
							res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: tc.query})
							require.NoError(t, err)
							if limit < tc.value {
								require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
								require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"%s"}]}`, fmt.Sprintf(tc.errorMessage, tc.value, limit)), res.Body)
							} else {
								require.Equal(t, http.StatusOK, res.Response.StatusCode)
								require.JSONEq(t, tc.data, res.Body)
							}

							inlinedRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: tc.inlinedQuery})
							require.NoError(t, err)
							require.Equal(t, res.Response.StatusCode, inlinedRes.Response.StatusCode)
							require.Equal(t, res.Body, inlinedRes.Body)
						})
					})
				}
			})
		}

		t.Run("persisted operation with fragments", func(t *testing.T) {
			t.Parallel()

			exporter := tracetest.NewInMemoryExporter(t)
			testenv.Run(t, &testenv.Config{
				TraceExporter: exporter,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = depthLimit(5)
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// The persisted "Employees" operation selects its deepest fields and all pet fields
				// through fragments. The second request is served from the persisted operation cache.
				for _, cacheHit := range []bool{false, true} {
					exporter.Reset()
					header := make(http.Header)
					header.Add("graphql-client-name", "my-client")
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						OperationName: []byte(`"Employees"`),
						Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "1167510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"}}`),
						Header:        header,
					})
					require.NoError(t, err)
					require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
					require.Equal(t, `{"errors":[{"message":"The query depth 6 exceeds the max query depth allowed (5)"}]}`, res.Body)

					normalizeSpan := testutils.RequireSpanWithName(t, exporter, "Operation - Normalize")
					require.Contains(t, normalizeSpan.Attributes(), otel.WgEnginePersistedOperationCacheHit.Bool(cacheHit))
					testSpan := testutils.RequireSpanWithName(t, exporter, "Operation - Validate")
					require.Contains(t, testSpan.Attributes(), otel.WgQueryDepth.Int(6))
					require.Contains(t, testSpan.Attributes(), otel.WgQueryTotalFields.Int(44))
					require.Contains(t, testSpan.Attributes(), otel.WgQueryRootFields.Int(1))
					require.Contains(t, testSpan.Attributes(), otel.WgQueryRootFieldAliases.Int(0))
					if !cacheHit {
						// wait to let cache get consistent
						time.Sleep(100 * time.Millisecond)
					}
				}
			})
		})
	})
}
