package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
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
		t.Run("max query depth of 0 doesn't block", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					if securityConfiguration.DepthLimit == nil {
						securityConfiguration.DepthLimit = &config.QueryDepthConfiguration{}
					}
					securityConfiguration.DepthLimit.Enabled = true
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
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, res.Body)
			})
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

				testSpan := RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepth.Int(3))
				require.Contains(t, testSpan.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()
				// wait to let cache get consistent
				time.Sleep(100 * time.Millisecond)

				failedRes2, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, failedRes2.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The query depth 3 exceeds the max query depth allowed (2)"}]}`, failedRes2.Body)

				testSpan2 := RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepth.Int(3))
				require.Contains(t, testSpan2.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
				exporter.Reset()
				// wait to let cache get consistent
				time.Sleep(100 * time.Millisecond)

				successRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes.Body)
				testSpan3 := RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryDepth.Int(2))
				require.Contains(t, testSpan3.Attributes(), otel.WgQueryDepthCacheHit.Bool(false))
				exporter.Reset()
				// wait to let cache get consistent
				time.Sleep(100 * time.Millisecond)

				successRes2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { employees { id } }`,
				})
				require.JSONEq(t, employeesIDData, successRes2.Body)
				testSpan4 := RequireSpanWithName(t, exporter, "Operation - Validate")
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryDepth.Int(2))
				require.Contains(t, testSpan4.Attributes(), otel.WgQueryDepthCacheHit.Bool(true))
			})
		})
	})

	t.Run("depth limit", func(t *testing.T) {
		t.Parallel()
		t.Run("depth limit blocks queries over the limit", func(t *testing.T) {
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
							Limit:                     2,
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
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						TotalFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   1,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The total number of fields 2 exceeds the limit allowed (1)"}]}`, res.Body)
			})
		})

		t.Run("total fields allows queries under the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						TotalFields: &config.ComplexityLimit{
							Enabled: true,
							Limit:   3,
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

	t.Run("root fields limit", func(t *testing.T) {
		t.Parallel()

		t.Run("root fields limit blocks queries over the limit", func(t *testing.T) {
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
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query { initialPayload employee(id:1) { id } employees { id } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The number of root fields 3 exceeds the root field limit allowed (2)"}]}`, res.Body)
			})
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
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						RootFieldAliases: &config.ComplexityLimit{
							Enabled: true,
							Limit:   1,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, _ := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query: `query { firstemployee: employee(id:1) { id } employee2: employee(id:2) { id } }`,
				})
				require.Equal(t, 400, res.Response.StatusCode)
				require.Equal(t, `{"errors":[{"message":"The number of root field aliases 2 exceeds the root field aliases limit allowed (1)"}]}`, res.Body)
			})
		})

		t.Run("root field aliases allows queries under the limit", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.ComplexityLimits = &config.ComplexityLimits{
						RootFieldAliases: &config.ComplexityLimit{
							Enabled: true,
							Limit:   2,
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
	})
}
