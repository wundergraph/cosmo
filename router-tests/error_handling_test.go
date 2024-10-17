package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http"
	"testing"
)

func TestErrorPropagation(t *testing.T) {

	t.Parallel()

	t.Run("StatusCode extensions field is not set on origin connection issues / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
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
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Report origin response status through statusCode on the root error extensions field / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusInternalServerError)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees', Reason: empty response.","extensions":{"statusCode":500}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Partial Origin errors with no http response status code propagation / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusInternalServerError)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees', Reason: empty response."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Partial Origin errors with nested errors / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Partial Origin errors without error propagation enabled / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED","statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Partial Origin errors without error propagation enabled / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.Enabled = false
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Origin connections errors without error propagation enabled / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = false
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
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
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Partial Origin errors with nested errors and no content type header set / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Partial Origin errors with nested errors with 200 response status code / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":200}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("Partial Origin errors with nested errors with invalid JSON / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusUnauthorized)
							_, _ = w.Write([]byte(`unauthorized`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees', Reason: invalid JSON.","extensions":{"statusCode":401}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
		})
	})

	t.Run("No statusCode is propagated on connection issues / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					CloseOnStart: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Attach statusCode when origin responds with 500 status code / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusInternalServerError)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees', Reason: empty response.","extensions":{"statusCode":500}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors are propagated without leaking any information / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.OmitLocations = true
				cfg.OmitExtensions = true
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors are propagated without leaking any information except message / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.OmitLocations = true
				cfg.OmitExtensions = true
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors are propagated with locations information / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.OmitLocations = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}],"statusCode":200}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors are propagated without extensions information / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.OmitExtensions = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors are propagated with only locations information / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.OmitLocations = false
				cfg.OmitExtensions = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}]}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors without error propagation enabled / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED","statusCode":200}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors without error propagation enabled / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = false
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"statusCode":200}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("No extensions fields are propagated / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.PropagateStatusCodes = false
				cfg.AttachServiceName = false
				cfg.AllowedExtensionFields = []string{}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"Unauthorized"}]}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("No extensions fields are propagated / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.PropagateStatusCodes = false
				cfg.AttachServiceName = false
				cfg.AllowedExtensionFields = []string{}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Only code extensions field is propagated to the client / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AllowedExtensionFields = []string{"code"}
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED","foo":"bar"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Only code extensions field is propagated to the client / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.AllowedExtensionFields = []string{"code"}
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED","foo":"bar"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Origin errors with nested errors / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.PropagateStatusCodes = false
				cfg.DefaultExtensionCode = ""
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employee","rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE"}},{"message":"error resolving ErrorField","path":["employee","rootFieldErrorWrapper","errorField"]},{"message":"resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1","path":["employee"]}],"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"rootFieldThrowsError":null,"fieldThrowsError":null,"rootFieldErrorWrapper":{"okField":"ok","errorField":null}}}}`, res.Body)
		})
	})

	t.Run("Origin errors with nested errors in list field / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employeeAsList(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employeeAsList",0,"rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE","statusCode":200}},{"message":"error resolving ErrorField","path":["employeeAsList",0,"rootFieldErrorWrapper","errorField"],"extensions":{"statusCode":200}},{"message":"resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1","path":["employeeAsList"],"extensions":{"statusCode":200}}],"data":{"employeeAsList":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"rootFieldThrowsError":null,"fieldThrowsError":null,"rootFieldErrorWrapper":{"okField":"ok","errorField":null}}]}}`, res.Body)
		})
	})

	t.Run("Origin errors with nested errors / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employee","rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE"}},{"message":"error resolving ErrorField","path":["employee","rootFieldErrorWrapper","errorField"]}],"statusCode":200}},{"message":"Failed to fetch from Subgraph 'test1' at Path 'employee'.","extensions":{"errors":[{"message":"resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1","path":["employee"]}],"statusCode":200}}],"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"rootFieldThrowsError":null,"fieldThrowsError":null,"rootFieldErrorWrapper":{"okField":"ok","errorField":null}}}}`, res.Body)
		})
	})

	t.Run("ServiceName field is attached to the extensions field / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.AttachServiceName = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employee","rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE"}},{"message":"error resolving ErrorField","path":["employee","rootFieldErrorWrapper","errorField"]}],"serviceName":"employees","statusCode":200}},{"message":"Failed to fetch from Subgraph 'test1' at Path 'employee'.","extensions":{"errors":[{"message":"resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1","path":["employee"]}],"serviceName":"test1","statusCode":200}}],"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"rootFieldThrowsError":null,"fieldThrowsError":null,"rootFieldErrorWrapper":{"okField":"ok","errorField":null}}}}`, res.Body)
		})
	})

	t.Run("ServiceName field is attached to the extensions field / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AttachServiceName = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employee","rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE","serviceName":"employees","statusCode":200}},{"message":"error resolving ErrorField","path":["employee","rootFieldErrorWrapper","errorField"],"extensions":{"serviceName":"employees","statusCode":200}},{"message":"resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1","path":["employee"],"extensions":{"serviceName":"test1","statusCode":200}}],"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"rootFieldThrowsError":null,"fieldThrowsError":null,"rootFieldErrorWrapper":{"okField":"ok","errorField":null}}}}`, res.Body)
		})
	})

	t.Run("ServiceName field is attached to the extensions field also when extensions is null or empty object / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AttachServiceName = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":null}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id rootFieldThrowsError } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"serviceName":"employees","statusCode":200}}],"data":{"employee":null}}`, res.Body)
		})

		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AttachServiceName = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id rootFieldThrowsError } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"serviceName":"employees","statusCode":200}}],"data":{"employee":null}}`, res.Body)
		})
	})

	t.Run("Default extension code is ensured when origin did not provide it / wrapped mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.DefaultExtensionCode = "DEFAULT_CODE"
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employee","rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE"}},{"message":"error resolving ErrorField","path":["employee","rootFieldErrorWrapper","errorField"],"extensions":{"code":"DEFAULT_CODE"}}],"statusCode":200}},{"message":"Failed to fetch from Subgraph 'test1' at Path 'employee'.","extensions":{"errors":[{"message":"resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1","path":["employee"],"extensions":{"code":"DEFAULT_CODE"}}],"statusCode":200}}],"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"rootFieldThrowsError":null,"fieldThrowsError":null,"rootFieldErrorWrapper":{"okField":"ok","errorField":null}}}}`, res.Body)
		})
	})

	t.Run("Default extension code is ensured also when extensions is null or empty object / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.DefaultExtensionCode = "DEFAULT_CODE"
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":null}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id rootFieldThrowsError } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"code":"DEFAULT_CODE","statusCode":200}}],"data":{"employee":null}}`, res.Body)
		})

		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.DefaultExtensionCode = "DEFAULT_CODE"
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id rootFieldThrowsError } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"code":"DEFAULT_CODE","statusCode":200}}],"data":{"employee":null}}`, res.Body)
		})
	})

	t.Run("Default extension code is ensured when origin did not provide it / passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.DefaultExtensionCode = "DEFAULT_CODE"
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"error resolving RootFieldThrowsError for Employee 1","path":["employee","rootFieldThrowsError"],"extensions":{"code":"ERROR_CODE","statusCode":200}},{"message":"error resolving ErrorField","path":["employee","rootFieldErrorWrapper","errorField"],"extensions":{"code":"DEFAULT_CODE","statusCode":200}},{"message":"resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1","path":["employee"],"extensions":{"code":"DEFAULT_CODE","statusCode":200}}],"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"rootFieldThrowsError":null,"fieldThrowsError":null,"rootFieldErrorWrapper":{"okField":"ok","errorField":null}}}}`, res.Body)
		})
	})

	t.Run("Only specified fields are propagated in passthrough mode", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AllowedExtensionFields = []string{"code"}
				cfg.PropagateStatusCodes = false
				cfg.AllowedFields = []string{"user"}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","longMessage":"This is a long message","user":"1","extensions":{"code":"UNAUTHORIZED","foo":"bar"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","user":"1","extensions":{"code":"UNAUTHORIZED"}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("Location is propagated if set to not be omitted in passthrough mode and not specified in allowed fields", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.OmitLocations = false
				cfg.PropagateStatusCodes = false
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}]}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":1}],"extensions":{"code":"UNAUTHORIZED"}}],"data":{"employees":null}}`, res.Body)
		})
	})
}
