package integration

import (
	"cmp"
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/wundergraph/cosmo/router/core"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func compareErrors(t *testing.T, expectedErrors []testenv.GraphQLError, actualErrors []testenv.GraphQLError) {
	var matchedErrors int

	require.Lenf(t, actualErrors, len(expectedErrors), "Expected %d errors, got %d", len(expectedErrors), len(actualErrors))

	for _, expectedErr := range expectedErrors {
		for _, err := range actualErrors {
			if err.Message != expectedErr.Message {
				t.Logf("message did not match\n\t-%s\n\t+%s", expectedErr.Message, err.Message)
				continue
			}

			if slices.CompareFunc(err.Path, expectedErr.Path, func(s1 any, s2 any) int {
				if s1 == nil && s2 == nil {
					return 0
				}

				s1Str, s1StrOk := s1.(string)
				s2Str, s2StrOk := s2.(string)
				if s1StrOk && s2StrOk {
					return cmp.Compare(s1Str, s2Str)
				}

				s1Float, s1FloatOk := s1.(float64)
				s2Float, s2FloatOk := s2.(float64)
				if s1FloatOk && s2FloatOk {
					return cmp.Compare(s1Float, s2Float)
				}

				// in all the other cases, let's just return 1
				return 1
			}) != 0 {
				t.Logf("path did not match")
				continue
			}

			if err.Extensions.Code != expectedErr.Extensions.Code {
				t.Logf("extensions.code did not match, expected %s, got %s", expectedErr.Extensions.Code, err.Extensions.Code)
				continue
			}
			if err.Extensions.StatusCode != expectedErr.Extensions.StatusCode {
				t.Logf("extensions status code did not match, expected %d, got %d", expectedErr.Extensions.StatusCode, err.Extensions.StatusCode)
				continue
			}
			if len(err.Extensions.Errors) != len(expectedErr.Extensions.Errors) {
				t.Logf("extensions errors did not match, expected %d errors, got %d", len(expectedErr.Extensions.Errors), len(err.Extensions.Errors))
				continue
			}

			compareErrors(t, expectedErr.Extensions.Errors, err.Extensions.Errors)

			matchedErrors++
			break
		}
	}

	require.Lenf(t, actualErrors, matchedErrors, "not all expected errors were matched, matched %d/%d", matchedErrors, len(actualErrors))
}

func checkContentAndErrors(t *testing.T, expectedContent string, expectedErrors []testenv.GraphQLError, body string) {
	t.Helper()

	res := testenv.GraphQLResponse{}
	require.NoError(t, json.Unmarshal([]byte(body), &res))

	compareErrors(t, expectedErrors, res.Errors)
	content, contentErr := res.Data.MarshalJSON()
	require.NoError(t, contentErr)

	require.Equal(t, expectedContent, string(content))
}

func TestFallbackErrors(t *testing.T) {
	t.Parallel()

	t.Run("when subgraph returns malformed JSON with 418 status, should get fallback error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
					SuppressFetchErrors: config.ApolloCompatibilityFlag{
						Enabled: true,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(h http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(418)
							_, _ = w.Write([]byte(`{"error":"invalid appliance"}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id currentMood fieldThrowsError } }`,
			})

			checkContentAndErrors(t, `{"employee":{"id":1,"currentMood":"HAPPY","fieldThrowsError":null}}`, []testenv.GraphQLError{
				{
					Message: "418: I'm a teapot",
					Extensions: testenv.GraphQLErrorExtensions{
						StatusCode: 418,
					},
				},
			}, res.Body)
		})
	})

	t.Run("when subgraph returns malformed JSON with 200 status, should get invalid shape error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(h http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(200)
							_, _ = w.Write([]byte(`{"state":"nothing is wrong but I am not valid GraphQL response"}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id currentMood fieldThrowsError } }`,
			})

			checkContentAndErrors(t, `{"employee":{"id":1,"currentMood":"HAPPY","fieldThrowsError":null}}`, []testenv.GraphQLError{
				{
					Message: "Failed to fetch from Subgraph 'test1' at Path 'employee', Reason: no data or errors in response.",
					Extensions: testenv.GraphQLErrorExtensions{
						StatusCode: 200,
					},
				},
			}, res.Body)
		})
	})

	t.Run("when subgraph returns non JSON response with 418 status, should get fallback error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(h http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "text/html")
							w.WriteHeader(418)

							// the semantic correctness of this is irrelevant, it just matters that it's not valid JSON
							// HTML-ish text response is just used as a representative example of a non-JSON response
							_, _ = w.Write([]byte(`<html><body>418: I'm a teapot</body></html>`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id currentMood fieldThrowsError } }`,
			})

			checkContentAndErrors(t, `{"employee":{"id":1,"currentMood":"HAPPY","fieldThrowsError":null}}`, []testenv.GraphQLError{
				{
					Message: "418: I'm a teapot",
					Extensions: testenv.GraphQLErrorExtensions{
						StatusCode: 418,
					},
				},
			}, res.Body)
		})
	})

	t.Run("when subgraph returns non JSON response with 200 status, should get invalid JSON error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Test1: testenv.SubgraphConfig{
					Middleware: func(h http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "text/html")
							w.WriteHeader(200)

							// the semantic correctness of this is irrelevant, it just matters that it's not valid JSON
							// HTML-ish text response is just used as a representative example of a non-JSON response
							_, _ = w.Write([]byte(`<html><body>Everything is fine!</body></html>`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id currentMood fieldThrowsError } }`,
			})

			checkContentAndErrors(t, `{"employee":{"id":1,"currentMood":"HAPPY","fieldThrowsError":null}}`, []testenv.GraphQLError{
				{
					Message: "Failed to fetch from Subgraph 'test1' at Path 'employee', Reason: invalid JSON.",
					Extensions: testenv.GraphQLErrorExtensions{
						StatusCode: 200,
					},
				},
			}, res.Body)
		})
	})
}

func TestAllowedExtensions(t *testing.T) {
	t.Parallel()

	t.Run("in wrapped mode, only allowed extensions should be included in the propagated error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.AllowedExtensionFields = []string{"allowed"}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, wErr := w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed","notAllowed":"notAllowed"}}]}`))
							require.NoError(t, wErr)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed"}}],"statusCode":403}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("in wrapped mode, with AllowAllExtensionFields set, all extensions should be included in the propagated error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModeWrapped
				cfg.AllowedExtensionFields = []string{"allowed"}
				cfg.AllowAllExtensionFields = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, wErr := w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed","notAllowed":"notAllowed"}}]}`))
							require.NoError(t, wErr)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed","notAllowed":"notAllowed"}}],"statusCode":403}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("in passthrough mode, only allowed extensions should be included in the propagated error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AllowedExtensionFields = []string{"allowed"}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, wErr := w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed","notAllowed":"notAllowed"}}]}`))
							require.NoError(t, wErr)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed","statusCode":403}}],"data":{"employees":null}}`, res.Body)
		})
	})

	t.Run("in passthrough mode, with AllowAllExtensionFields set, all extensions should be included in the propagated error", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.AllowedExtensionFields = []string{"allowed"}
				cfg.AllowAllExtensionFields = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, wErr := w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed","notAllowed":"notAllowed"}}]}`))
							require.NoError(t, wErr)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Unauthorized","extensions":{"allowed":"allowed","notAllowed":"notAllowed","statusCode":403}}],"data":{"employees":null}}`, res.Body)
		})
	})

}

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
							_, wErr := w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
							require.NoError(t, wErr)
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
							// if this writes a non-2XX code it will get picked up by the fallback error handler
							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`unauthorized`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id details { forename surname } notes } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'products' at Path 'employees', Reason: invalid JSON.","extensions":{"statusCode":200}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
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
			checkContentAndErrors(t, "{\"employee\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"},\"rootFieldThrowsError\":null,\"fieldThrowsError\":null,\"rootFieldErrorWrapper\":{\"okField\":\"ok\",\"errorField\":null}}}", []testenv.GraphQLError{
				{
					Message: "error resolving RootFieldThrowsError for Employee 1",
					Path:    []any{"employee", "rootFieldThrowsError"},
					Extensions: testenv.GraphQLErrorExtensions{
						Code: "ERROR_CODE",
					},
				},
				{
					Message: "error resolving ErrorField",
					Path:    []any{"employee", "rootFieldErrorWrapper", "errorField"},
				},
				{
					Message: "resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1",
					Path:    []any{"employee"},
				},
			}, res.Body)
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
			checkContentAndErrors(t, "{\"employeeAsList\":[{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"},\"rootFieldThrowsError\":null,\"fieldThrowsError\":null,\"rootFieldErrorWrapper\":{\"okField\":\"ok\",\"errorField\":null}}]}", []testenv.GraphQLError{
				{
					Message:    "error resolving RootFieldThrowsError for Employee 1",
					Path:       []any{"employeeAsList", float64(0), "rootFieldThrowsError"},
					Extensions: testenv.GraphQLErrorExtensions{Code: "ERROR_CODE", StatusCode: 200},
				},
				{
					Message:    "error resolving ErrorField",
					Path:       []any{"employeeAsList", float64(0), "rootFieldErrorWrapper", "errorField"},
					Extensions: testenv.GraphQLErrorExtensions{StatusCode: 200},
				},
				{
					Message:    "resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1",
					Path:       []any{"employeeAsList"},
					Extensions: testenv.GraphQLErrorExtensions{StatusCode: 200},
				},
			}, res.Body)
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
			checkContentAndErrors(t, "{\"employee\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"},\"rootFieldThrowsError\":null,\"fieldThrowsError\":null,\"rootFieldErrorWrapper\":{\"okField\":\"ok\",\"errorField\":null}}}", []testenv.GraphQLError{
				{
					Message: "Failed to fetch from Subgraph 'employees'.",
					Extensions: testenv.GraphQLErrorExtensions{
						StatusCode: 200,
						Errors: []testenv.GraphQLError{
							{
								Message:    "error resolving RootFieldThrowsError for Employee 1",
								Path:       []any{"employee", "rootFieldThrowsError"},
								Extensions: testenv.GraphQLErrorExtensions{Code: "ERROR_CODE"}},
							{
								Message: "error resolving ErrorField",
								Path:    []any{"employee", "rootFieldErrorWrapper", "errorField"},
							},
						},
					},
				},
				{
					Message: "Failed to fetch from Subgraph 'test1' at Path 'employee'.",
					Extensions: testenv.GraphQLErrorExtensions{
						StatusCode: 200,
						Errors: []testenv.GraphQLError{
							{
								Message: "resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1",
								Path:    []any{"employee"},
							},
						},
					},
				},
			}, res.Body)
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
			checkContentAndErrors(t,
				"{\"employee\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"},\"rootFieldThrowsError\":null,\"fieldThrowsError\":null,\"rootFieldErrorWrapper\":{\"okField\":\"ok\",\"errorField\":null}}}",
				[]testenv.GraphQLError{
					{
						Message: "Failed to fetch from Subgraph 'employees'.",
						Extensions: testenv.GraphQLErrorExtensions{
							StatusCode: 200,
							Errors: []testenv.GraphQLError{
								{
									Message:    "error resolving RootFieldThrowsError for Employee 1",
									Path:       []any{"employee", "rootFieldThrowsError"},
									Extensions: testenv.GraphQLErrorExtensions{Code: "ERROR_CODE"},
								},
								{
									Message: "error resolving ErrorField",
									Path:    []any{"employee", "rootFieldErrorWrapper", "errorField"},
								},
							},
						},
					},
					{
						Message: "Failed to fetch from Subgraph 'test1' at Path 'employee'.",
						Extensions: testenv.GraphQLErrorExtensions{
							StatusCode:  200,
							ServiceName: "test1",
							Errors: []testenv.GraphQLError{
								{
									Message: "resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1",
									Path:    []any{"employee"},
								},
							},
						},
					},
				}, res.Body)
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

			checkContentAndErrors(t,
				"{\"employee\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"},\"rootFieldThrowsError\":null,\"fieldThrowsError\":null,\"rootFieldErrorWrapper\":{\"okField\":\"ok\",\"errorField\":null}}}",
				[]testenv.GraphQLError{
					{
						Message: "error resolving RootFieldThrowsError for Employee 1",
						Path:    []any{"employee", "rootFieldThrowsError"},
						Extensions: testenv.GraphQLErrorExtensions{
							Code:        "ERROR_CODE",
							ServiceName: "employees",
							StatusCode:  200,
						},
					},
					{
						Message: "error resolving ErrorField",
						Path:    []any{"employee", "rootFieldErrorWrapper", "errorField"},
						Extensions: testenv.GraphQLErrorExtensions{
							ServiceName: "employees",
							StatusCode:  200,
						},
					},
					{
						Message: "resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1",
						Path:    []any{"employee"},
						Extensions: testenv.GraphQLErrorExtensions{
							StatusCode:  200,
							ServiceName: "test1",
						},
					},
				}, res.Body)
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
			checkContentAndErrors(t,
				"{\"employee\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"},\"rootFieldThrowsError\":null,\"fieldThrowsError\":null,\"rootFieldErrorWrapper\":{\"okField\":\"ok\",\"errorField\":null}}}",
				[]testenv.GraphQLError{
					{
						Message: "Failed to fetch from Subgraph 'employees'.",
						Extensions: testenv.GraphQLErrorExtensions{
							StatusCode: 200,
							Errors: []testenv.GraphQLError{
								{
									Message:    "error resolving RootFieldThrowsError for Employee 1",
									Path:       []any{"employee", "rootFieldThrowsError"},
									Extensions: testenv.GraphQLErrorExtensions{Code: "ERROR_CODE"},
								},
								{
									Message:    "error resolving ErrorField",
									Path:       []any{"employee", "rootFieldErrorWrapper", "errorField"},
									Extensions: testenv.GraphQLErrorExtensions{Code: "DEFAULT_CODE"},
								},
							},
						},
					},
					{
						Message: "Failed to fetch from Subgraph 'test1' at Path 'employee'.",
						Extensions: testenv.GraphQLErrorExtensions{
							StatusCode: 200,
							Errors: []testenv.GraphQLError{
								{
									Message:    "resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1",
									Path:       []any{"employee"},
									Extensions: testenv.GraphQLErrorExtensions{Code: "DEFAULT_CODE"},
								},
							},
						},
					},
				},
				res.Body,
			)
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
			checkContentAndErrors(t,
				"{\"employee\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"},\"rootFieldThrowsError\":null,\"fieldThrowsError\":null,\"rootFieldErrorWrapper\":{\"okField\":\"ok\",\"errorField\":null}}}",
				[]testenv.GraphQLError{
					{
						Message: "error resolving RootFieldThrowsError for Employee 1",
						Path:    []any{"employee", "rootFieldThrowsError"},
						Extensions: testenv.GraphQLErrorExtensions{
							Code:       "ERROR_CODE",
							StatusCode: 200,
						},
					},
					{
						Message: "error resolving ErrorField",
						Path:    []any{"employee", "rootFieldErrorWrapper", "errorField"},
						Extensions: testenv.GraphQLErrorExtensions{
							Code:       "DEFAULT_CODE",
							StatusCode: 200,
						},
					},
					{
						Message: "resolving Entity \"Employee\": error resolving FindEmployeeByID for id 1",
						Path:    []any{"employee"},
						Extensions: testenv.GraphQLErrorExtensions{
							Code:       "DEFAULT_CODE",
							StatusCode: 200,
						},
					},
				},
				res.Body,
			)
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

	t.Run("validate error when a non subscription multipart is printed", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
					EnableSingleFlight:     true,
					MaxConcurrentResolvers: 1,
				}),
				core.WithSubgraphRetryOptions(false, 0, 0, 0),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Header: map[string][]string{
					"service-name": {"service-name"},
					"accept":       {"multipart/mixed;deferSpec=20220824"},
				},
				Query: `query employees { employees { ide } }`, // Missing closing bracket
			})

			expected := "--graphql\r\n" +
				"Content-Type: application/json\r\n" +
				"\r\n" +
				"{\"errors\":[{\"message\":\"Cannot query field \\\"ide\\\" on type \\\"Employee\\\".\",\"path\":[\"query\",\"employees\"]}]}\r\n" +
				"--graphql--"
			require.Equal(t, expected, resp.Body)
			require.NoError(t, err)
		})
	})

	t.Run("validate the error format when a subscription multipart is printed", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
					EnableSingleFlight:     true,
					MaxConcurrentResolvers: 1,
				}),
				core.WithSubgraphRetryOptions(false, 0, 0, 0),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Header: map[string][]string{
					"service-name": {"service-name"},
					"accept":       {"multipart/mixed;deferSpec=20220824"},
				},
				Query: `subscription employees { employees { ide } }`, // Missing closing bracket
			})

			expected := "--graphql\r\n" +
				"Content-Type: application/json\r\n" +
				"\r\n" +
				"{\"payload\":{\"errors\":[{\"message\":\"Cannot query field \\\"employees\\\" on type \\\"Subscription\\\".\",\"path\":[\"subscription\"]}]}}\r\n" +
				"--graphql--"
			require.Equal(t, expected, resp.Body)
			require.NoError(t, err)
		})
	})

	t.Run("skip prioritizing json as the preferred content type for errors on subscription operations", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
					EnableSingleFlight:     true,
					MaxConcurrentResolvers: 1,
				}),
				core.WithSubgraphRetryOptions(false, 0, 0, 0),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Header: map[string][]string{
					"service-name": {"service-name"},
					"accept":       {"multipart/mixed;deferSpec=20220824,application/json,application/graphql-response+json,text/plain"},
				},
				Query: `subscription employees { employees { ide } }`, // Missing closing bracket
			})
			require.NoError(t, err)

			expected := "--graphql\r\n" +
				"Content-Type: application/json\r\n" +
				"\r\n" +
				"{\"payload\":{\"errors\":[{\"message\":\"Cannot query field \\\"employees\\\" on type \\\"Subscription\\\".\",\"path\":[\"subscription\"]}]}}\r\n" +
				"--graphql--"
			require.Equal(t, expected, resp.Body)
		})
	})

	t.Run("prioritize json as the preferred content type for errors on non subscription operations", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
					EnableNetPoll:          true,
					EnableSingleFlight:     true,
					MaxConcurrentResolvers: 1,
				}),
				core.WithSubgraphRetryOptions(false, 0, 0, 0),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			resp, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Header: map[string][]string{
					"service-name": {"service-name"},
					"accept":       {"multipart/mixed;deferSpec=20220824,application/json,application/graphql-response+json,text/plain"},
				},
				Query: `query employees { employees { ide } }`, // Missing closing bracket
			})
			require.NoError(t, err)

			expected := `{"errors":[{"message":"Cannot query field \"ide\" on type \"Employee\".","path":["query","employees"]}]}`
			require.Equal(t, expected, resp.Body)
		})
	})
}
