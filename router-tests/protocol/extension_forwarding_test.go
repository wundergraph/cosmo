package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestGraphqlExtensionsForwarding(t *testing.T) {
	t.Parallel()

	type graphqlResponseWithExtensions struct {
		Errors     []testenv.GraphQLError `json:"errors"`
		Data       json.RawMessage        `json:"data"`
		Extensions json.RawMessage        `json:"extensions,omitempty"`
	}

	t.Run("should forward extensions to the client for simple request", func(t *testing.T) {
		t.Parallel()

		// Subgraph fetch: a single hit on Employees (only subgraph involved
		// in `employee(id: 1) { id }`). Because only one subgraph contributes
		// extensions, the first_write / last_write distinction is irrelevant
		// here; this test only verifies the allow-list filter (keeping
		// `myExtension` and `myOtherExtension`, dropping `notAllowedExtension`).
		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                true,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
					AllowedExtensionFields: []string{"myExtension", "myOtherExtension"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"myExtension":"myValue","myOtherExtension":{"nested":[{"value":"nestedValue"},{"value":"nestedValue2"}]},"notAllowedExtension":"notAllowedValue"}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})

			var resp testenv.GraphQLResponse
			require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

			require.Equal(t, `{"employee":{"id":1}}`, string(resp.Data))
			require.JSONEq(t, `{"myExtension":"myValue","myOtherExtension":{"nested":[{"value":"nestedValue"},{"value":"nestedValue2"}]}}`, string(resp.Extensions))

		})
	})

	t.Run("should forward extensions to client on multiple subgraph calls", func(t *testing.T) {
		t.Parallel()

		// Subgraph fetch order for `employee(id: 1) { id notes }`:
		//   1. Employees — fetches first (it owns the `employee` entity and
		//      its `id` field).
		//   2. Products — fetches last to resolve `notes` via @override.
		// With first_write, `myExtension` is written by Employees first and
		// Products' value for the same key is ignored — the response keeps
		// Employees' `"myValue"`. `myOtherExtension` is unique to Employees,
		// `myOtherExtensionFromProducts` is filtered out by the allow list,
		// and `notAllowedExtension*` are also filtered out.
		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                true,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
					AllowedExtensionFields: []string{"myExtension", "myOtherExtension"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"myExtension":"myValueFromProducts","myOtherExtensionFromProducts":{"nested":[{"value":"nestedValueFromProducts"},{"value":"nestedValue2FromProducts"}]},"notAllowedExtensionFromProducts":"notAllowedValueFromProducts"}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"myExtension":"myValue","myOtherExtension":{"nested":[{"value":"nestedValue"},{"value":"nestedValue2"}]},"notAllowedExtension":"notAllowedValue"}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id notes } }`,
			})

			var resp testenv.GraphQLResponse
			require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

			require.Equal(t, `{"employee":{"id":1,"notes":"Jens notes resolved by products"}}`, string(resp.Data))
			require.JSONEq(t, `{"myExtension":"myValue","myOtherExtension":{"nested":[{"value":"nestedValue"},{"value":"nestedValue2"}]}}`, string(resp.Extensions))

		})
	})

	t.Run("should propagate latest extension value when using last_write algorithm", func(t *testing.T) {
		t.Parallel()

		// Subgraph fetch order is the same as the multi-subgraph first_write
		// test above:
		//   1. Employees — fetches first.
		//   2. Products — fetches last to resolve `notes` via @override.
		// With last_write, the order reverses the winner for any conflicting
		// key: `myExtension` ends up as Products' `"myValueFromProducts"`
		// because Products is the last writer. `myOtherExtension` is only set
		// by Employees, so it flows through regardless of algorithm.
		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                true,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmLastWrite,
					AllowedExtensionFields: []string{"myExtension", "myOtherExtension"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Products: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"myExtension":"myValueFromProducts"}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"myExtension":"myValueFromEmployees","myOtherExtension":"onlyFromEmployees"}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id notes } }`,
			})

			var resp testenv.GraphQLResponse
			require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

			require.Equal(t, `{"employee":{"id":1,"notes":"Jens notes resolved by products"}}`, string(resp.Data))
			require.JSONEq(t, `{"myExtension":"myValueFromProducts","myOtherExtension":"onlyFromEmployees"}`, string(resp.Extensions))

		})
	})

	t.Run("should not forward extensions when forwarding is disabled", func(t *testing.T) {
		t.Parallel()

		// Single subgraph fetch (Employees only). Even though Employees
		// returns an extension value, propagation is disabled at the config
		// layer, so the order of calls is irrelevant — nothing propagates.
		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                false,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
					AllowedExtensionFields: []string{"myExtension"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"myExtension":"shouldNotAppear"}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})

			var resp testenv.GraphQLResponse
			require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

			require.Equal(t, `{"employee":{"id":1}}`, string(resp.Data))
			requireEmptyExtensions(t, resp.Extensions)

		})
	})

	t.Run("should merge unique extensions from multiple subgraphs in complex query", func(t *testing.T) {
		t.Parallel()

		// All four subgraphs fire for this query — the query plan visits
		// Employees (entity + id + details), Family (details.hasChildren),
		// Hobbies (hobbies), and Products (notes override). The exact call
		// order is plan-dependent, but it does not matter here because every
		// subgraph contributes a unique extension root key — there are no
		// conflicts to resolve, so the first_write / last_write distinction
		// has no observable effect. The order-sensitive case is covered by
		// the multi-subgraph first_write / last_write tests above; this test
		// focuses on the "merge across many subgraphs" axis.
		injectExtension := func(t *testing.T, raw string) func(http.Handler) http.Handler {
			return func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					recorder := httptest.NewRecorder()
					handler.ServeHTTP(recorder, r)

					responseBody := recorder.Body.Bytes()
					var response graphqlResponseWithExtensions
					require.NoError(t, json.Unmarshal(responseBody, &response))

					response.Extensions = json.RawMessage(raw)

					responseBytes, err := json.Marshal(response)
					require.NoError(t, err)

					w.WriteHeader(recorder.Code)
					_, _ = w.Write(responseBytes)
				})
			}
		}

		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                true,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
					AllowedExtensionFields: []string{"employeesExt", "familyExt", "hobbiesExt", "productsExt"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: injectExtension(t, `{"employeesExt":{"source":"employees","value":42}}`),
				},
				Family: testenv.SubgraphConfig{
					Middleware: injectExtension(t, `{"familyExt":["a","b","c"]}`),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: injectExtension(t, `{"hobbiesExt":"hobbies-value","ignoredFromHobbies":"nope"}`),
				},
				Products: testenv.SubgraphConfig{
					Middleware: injectExtension(t, `{"productsExt":{"nested":{"deep":true}}}`),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id notes details { forename hasChildren location { language } } hobbies { __typename } } }`,
			})

			var resp testenv.GraphQLResponse
			require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

			require.JSONEq(t, `{
				"employee": {
					"id": 1,
					"notes": "Jens notes resolved by products",
					"details": {
						"forename": "Jens",
						"hasChildren": true,
						"location": {"language": "German"}
					},
					"hobbies": [
						{"__typename":"Exercise"},
						{"__typename":"Gaming"},
						{"__typename":"Other"},
						{"__typename":"Programming"},
						{"__typename":"Travelling"}
					]
				}
			}`, string(resp.Data))
			require.JSONEq(t, `{
				"employeesExt": {"source":"employees","value":42},
				"familyExt": ["a","b","c"],
				"hobbiesExt": "hobbies-value",
				"productsExt": {"nested":{"deep":true}}
			}`, string(resp.Extensions))

		})
	})

	t.Run("should forward extensions when only a subset of subgraphs return them", func(t *testing.T) {
		t.Parallel()

		// `employee(id: 1) { id hobbies { __typename } }` fetches from
		// Employees (first, for the entity + id) and then Hobbies (last, for
		// the `hobbies` field). Only Hobbies has middleware that injects an
		// extension; Employees does not. Order is irrelevant because there is
		// only one writer for the extension key.
		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                true,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
					AllowedExtensionFields: []string{"hobbiesExt"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Hobbies: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"hobbiesExt":"only-from-hobbies"}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id hobbies { __typename } } }`,
			})

			var resp testenv.GraphQLResponse
			require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

			require.JSONEq(t, `{"employee":{"id":1,"hobbies":[{"__typename":"Exercise"},{"__typename":"Gaming"},{"__typename":"Other"},{"__typename":"Programming"},{"__typename":"Travelling"}]}}`, string(resp.Data))
			require.JSONEq(t, `{"hobbiesExt":"only-from-hobbies"}`, string(resp.Extensions))

		})
	})

	t.Run("should not include extensions in response when no allowed field is returned by subgraphs", func(t *testing.T) {
		t.Parallel()

		// Single subgraph fetch (Employees). Employees returns extension keys
		// that are not in the allow list, so they are all dropped before the
		// response is sent. Order is irrelevant because there is only one
		// writer and no winner to pick.
		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                true,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
					AllowedExtensionFields: []string{"allowedButNeverReturned"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(`{"notAllowed":"value","alsoNotAllowed":{"nested":true}}`)

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employee(id: 1) { id } }`,
			})

			var resp testenv.GraphQLResponse
			require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

			require.Equal(t, `{"employee":{"id":1}}`, string(resp.Data))
			requireEmptyExtensions(t, resp.Extensions)

		})
	})

	t.Run("should isolate extensions across multiple calls with the same query", func(t *testing.T) {
		t.Parallel()

		// "First" and "last" here refer to *client requests*, not subgraph
		// fetches within one query plan. A single subgraph (Employees) is
		// involved per request, and the middleware uses an atomic counter to
		// hand back a different extension payload to each subsequent call:
		//   - 1st client request → middleware writes `extensionsByCall[0]`.
		//   - 2nd client request → middleware writes `extensionsByCall[1]`.
		//   - 3rd client request → middleware writes `extensionsByCall[2]`.
		// The test asserts each client response contains *only* the
		// extensions from that specific call — proving the router resets its
		// per-request extension state between requests and does not bleed
		// keys from an earlier request into a later one.
		extensionsByCall := []string{
			`{"callExt":"first","onlyFirst":"a"}`,
			`{"callExt":"second","onlySecond":"b"}`,
			`{"callExt":"third","onlyThird":"c"}`,
		}
		var callCount atomic.Int32

		testenv.Run(t, &testenv.Config{
			ModifySubgraphExtensionPropagation: func(cfg *config.SubgraphExtensionPropagationConfiguration) {
				*cfg = config.SubgraphExtensionPropagationConfiguration{
					Enabled:                true,
					Algorithm:              config.SubgraphExtensionPropagationAlgorithmFirstWrite,
					AllowedExtensionFields: []string{"callExt", "onlyFirst", "onlySecond", "onlyThird"},
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							recorder := httptest.NewRecorder()
							handler.ServeHTTP(recorder, r)

							idx := int(callCount.Add(1)) - 1
							require.Less(t, idx, len(extensionsByCall))

							responseBody := recorder.Body.Bytes()
							var response graphqlResponseWithExtensions
							require.NoError(t, json.Unmarshal(responseBody, &response))

							response.Extensions = json.RawMessage(extensionsByCall[idx])

							responseBytes, err := json.Marshal(response)
							require.NoError(t, err)

							w.WriteHeader(recorder.Code)
							_, _ = w.Write(responseBytes)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			query := testenv.GraphQLRequest{Query: `query { employee(id: 1) { id } }`}

			expectedExtensionsByCall := []string{
				`{"callExt":"first","onlyFirst":"a"}`,
				`{"callExt":"second","onlySecond":"b"}`,
				`{"callExt":"third","onlyThird":"c"}`,
			}

			for i, expectedExtensions := range expectedExtensionsByCall {
				res := xEnv.MakeGraphQLRequestOK(query)

				var resp testenv.GraphQLResponse
				require.NoError(t, json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp))

				require.Equal(t, `{"employee":{"id":1}}`, string(resp.Data), "call %d data mismatch", i+1)
				require.JSONEq(t, expectedExtensions, string(resp.Extensions), "call %d extensions mismatch", i+1)
			}

			require.Equal(t, int32(len(expectedExtensionsByCall)), callCount.Load())
		})
	})

}

func requireEmptyExtensions(t *testing.T, raw json.RawMessage) {
	t.Helper()
	if len(raw) == 0 {
		return
	}
	var m map[string]any
	require.NoError(t, json.Unmarshal(raw, &m))
	require.Empty(t, m)
}
