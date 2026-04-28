package module_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	entity_splitter "github.com/wundergraph/cosmo/router-tests/modules/entity-splitter"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const employeesQuery = `{ employees { id hobbies { ... on Other { name } } } }`

func TestEntitySplitterModule(t *testing.T) {
	t.Run("splits a 100-representation _entities fetch into 10 parallel sub-fetches and preserves order", func(t *testing.T) {
		t.Parallel()

		const (
			employeeCount = 100
			batchSize     = 10
		)

		var hobbiesCalls atomic.Int64
		splitter := &entity_splitter.EntitySplitterModule{}

		cfg := config.Config{
			Modules: map[string]any{
				"entitySplitter": map[string]any{
					"batch_size":      batchSize,
					"split_threshold": 2048,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: employeesMockMiddleware(t, buildEmployeesResponse(employeeCount)),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: hobbiesEntitiesMockMiddleware(t, &hobbiesCalls, nil),
				},
			},
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(splitter),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: employeesQuery,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, buildExpectedClientResponse(employeeCount, nil), res.Body)

			assert.Equal(t, int64(employeeCount/batchSize), hobbiesCalls.Load())
			assert.Equal(t, int64(employeeCount/batchSize), splitter.SubFetchCount.Load())
			assert.Equal(t, int64(1), splitter.SplitRequestCount.Load())
		})
	})

	t.Run("small _entities fetch passes through unsplit", func(t *testing.T) {
		t.Parallel()

		const (
			employeeCount = 3
			batchSize     = 10
		)

		var hobbiesCalls atomic.Int64
		splitter := &entity_splitter.EntitySplitterModule{}

		cfg := config.Config{
			Modules: map[string]any{
				"entitySplitter": map[string]any{
					"batch_size":      batchSize,
					"split_threshold": 8192,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: employeesMockMiddleware(t, buildEmployeesResponse(employeeCount)),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: hobbiesEntitiesMockMiddleware(t, &hobbiesCalls, nil),
				},
			},
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(splitter),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: employeesQuery,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, buildExpectedClientResponse(employeeCount, nil), res.Body)

			assert.Equal(t, int64(1), hobbiesCalls.Load())
			assert.Equal(t, int64(0), splitter.SubFetchCount.Load())
			assert.Equal(t, int64(0), splitter.SplitRequestCount.Load())
		})
	})

	t.Run("fails one chunk and reconstructs ordered response with nulls and error paths", func(t *testing.T) {
		t.Parallel()

		const (
			employeeCount = 100
			batchSize     = 10
		)

		// Fail any sub-fetch whose representations contain an id in the range
		// [41, 50]. With 100 employees batched into 10-chunk windows, this is
		// exactly chunk index 4 (covering absolute positions 40..49, ids 41..50).
		failedIDs := map[int]struct{}{}
		for id := 41; id <= 50; id++ {
			failedIDs[id] = struct{}{}
		}

		var hobbiesCalls atomic.Int64
		splitter := &entity_splitter.EntitySplitterModule{}

		cfg := config.Config{
			Modules: map[string]any{
				"entitySplitter": map[string]any{
					"batch_size":      batchSize,
					"split_threshold": 2048,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: employeesMockMiddleware(t, buildEmployeesResponse(employeeCount)),
				},
				Hobbies: testenv.SubgraphConfig{
					Middleware: hobbiesEntitiesMockMiddleware(t, &hobbiesCalls, failedIDs),
				},
			},
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(splitter),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: employeesQuery,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, int64(employeeCount/batchSize), hobbiesCalls.Load())
			assert.Equal(t, int64(employeeCount/batchSize), splitter.SubFetchCount.Load())
			assert.Equal(t, int64(1), splitter.SplitRequestCount.Load())

			// 1) data.employees has all 100 ids in order, with employees 41..50
			//    resolved as hobbies=null and every other employee carrying the
			//    distinct `employee-<id>` name — proving the module reconstructed
			//    the response with the correct order and null-fill positions.
			nullIDs := map[int]struct{}{}
			for id := 41; id <= 50; id++ {
				nullIDs[id] = struct{}{}
			}
			var resp struct {
				Data   json.RawMessage `json:"data"`
				Errors []struct {
					Message    string `json:"message"`
					Extensions struct {
						Errors []struct {
							Message string `json:"message"`
							Path    []any  `json:"path"`
						} `json:"errors"`
						StatusCode int `json:"statusCode"`
					} `json:"extensions"`
				} `json:"errors"`
			}
			require.NoError(t, json.Unmarshal([]byte(res.Body), &resp))
			assert.Equal(t, buildDataEmployeesJSON(employeeCount, nullIDs), string(resp.Data))

			// 2) The engine surfaces exactly one top-level subgraph-fetch error
			//    for hobbies, and nests the per-chunk errors the module emitted
			//    under `extensions.errors` — one per failed representation.
			require.Len(t, resp.Errors, 1)
			assert.Equal(t, "Failed to fetch from Subgraph 'hobbies' at Path 'employees'.", resp.Errors[0].Message)
			assert.Equal(t, 10, len(resp.Errors[0].Extensions.Errors))
			for _, e := range resp.Errors[0].Extensions.Errors {
				assert.Equal(t, "sub-fetch returned status 500", e.Message)
				assert.Equal(t, []any{"employees"}, e.Path)
			}
		})
	})
}

func buildEmployeesResponse(count int) string {
	var b strings.Builder
	b.WriteString(`{"data":{"employees":[`)
	for i := 1; i <= count; i++ {
		if i > 1 {
			b.WriteString(",")
		}
		fmt.Fprintf(&b, `{"__typename":"Employee","id":%d}`, i)
	}
	b.WriteString(`]}}`)
	return b.String()
}

// buildDataEmployeesJSON returns the `data` subtree payload — just
// `{"employees":[...]}` — for the current employee-fetch test scenarios.
// Positions whose id is in nullIDs carry `hobbies:null`, proving null-fill
// from a failed sub-fetch chunk. All other positions carry a distinct
// `name:"employee-<id>"` hobby so the assertion also proves order preservation.
func buildDataEmployeesJSON(count int, nullIDs map[int]struct{}) string {
	var b strings.Builder
	b.WriteString(`{"employees":[`)
	for i := 1; i <= count; i++ {
		if i > 1 {
			b.WriteString(",")
		}
		if _, isNull := nullIDs[i]; isNull {
			fmt.Fprintf(&b, `{"id":%d,"hobbies":null}`, i)
		} else {
			fmt.Fprintf(&b, `{"id":%d,"hobbies":[{"name":"employee-%d"}]}`, i, i)
		}
	}
	b.WriteString(`]}`)
	return b.String()
}

func buildExpectedClientResponse(count int, nullIDs map[int]struct{}) string {
	return `{"data":` + buildDataEmployeesJSON(count, nullIDs) + `}`
}

func employeesMockMiddleware(t *testing.T, body string) func(http.Handler) http.Handler {
	t.Helper()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqBody, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read employees request body: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(reqBody))
			if !bytes.Contains(reqBody, []byte("employees")) || bytes.Contains(reqBody, []byte("_entities")) {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(body))
		})
	}
}

// hobbiesEntitiesMockMiddleware returns one `Other` hobby per representation,
// with `name = "employee-<id>"` so tests can assert ordering by index. If
// failOnIDs is non-nil and any representation's id is in the set, the
// middleware responds 500 to simulate a failed sub-fetch.
func hobbiesEntitiesMockMiddleware(t *testing.T, calls *atomic.Int64, failOnIDs map[int]struct{}) func(http.Handler) http.Handler {
	t.Helper()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqBody, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read hobbies request body: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(reqBody))
			if !bytes.Contains(reqBody, []byte("_entities")) {
				next.ServeHTTP(w, r)
				return
			}
			calls.Add(1)

			var parsed struct {
				Variables struct {
					Representations []struct {
						Typename string `json:"__typename"`
						ID       int    `json:"id"`
					} `json:"representations"`
				} `json:"variables"`
			}
			if err := json.Unmarshal(reqBody, &parsed); err != nil {
				t.Errorf("parse hobbies request body: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			if failOnIDs != nil {
				for _, rep := range parsed.Variables.Representations {
					if _, fail := failOnIDs[rep.ID]; fail {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusInternalServerError)
						_, _ = w.Write([]byte(`{"errors":[{"message":"simulated hobbies failure"}]}`))
						return
					}
				}
			}

			var out bytes.Buffer
			out.WriteString(`{"data":{"_entities":[`)
			for i, rep := range parsed.Variables.Representations {
				if i > 0 {
					out.WriteString(",")
				}
				fmt.Fprintf(&out, `{"__typename":"Employee","hobbies":[{"__typename":"Other","name":"employee-%d"}]}`, rep.ID)
			}
			out.WriteString(`]}}`)

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(out.Bytes())
		})
	}
}
