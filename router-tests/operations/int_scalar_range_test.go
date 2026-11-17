package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestIntScalarRange(t *testing.T) {
	t.Parallel()

	const (
		maxSafeInteger = 1<<53 - 1
		employeeByID   = `query ($id: Int!) { employee(id: $id) { id } }`
	)

	run := func(t *testing.T, intRange *config.IntScalarRange, test func(t *testing.T, request func(testenv.GraphQLRequest) (string, json.RawMessage))) {
		// Reset before each request, so nil means the request never reached the subgraph.
		var subgraphVariables atomic.Pointer[json.RawMessage]
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				if intRange != nil {
					cfg.IntScalarRange = *intRange
				}
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(_ http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							var req struct {
								Variables json.RawMessage `json:"variables"`
							}
							require.NoError(t, json.Unmarshal(body, &req))
							subgraphVariables.Store(&req.Variables)
							w.Header().Set("Content-Type", "application/json")
							_, _ = w.Write([]byte(`{"data":{"employee":null}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			test(t, func(req testenv.GraphQLRequest) (string, json.RawMessage) {
				subgraphVariables.Store(nil)
				res := xEnv.MakeGraphQLRequestOK(req)
				if v := subgraphVariables.Load(); v != nil {
					return res.Body, *v
				}
				return res.Body, nil
			})
		})
	}

	t.Run("defaults to the 32-bit range", func(t *testing.T) {
		t.Parallel()

		run(t, nil, func(t *testing.T, request func(testenv.GraphQLRequest) (string, json.RawMessage)) {
			t.Run("accepts max int32 variable", func(t *testing.T) {
				body, variables := request(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":2147483647}`)})
				assert.Equal(t, `{"data":{"employee":null}}`, body)
				assert.JSONEq(t, `{"a":2147483647}`, string(variables))
			})

			t.Run("rejects variable above max int32", func(t *testing.T) {
				body, variables := request(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":3000000000}`)})
				requireValidationError(t, body, `Variable "$id" got invalid value 3000000000; Int cannot represent non 32-bit signed integer value: 3000000000`)
				assert.Nil(t, variables)
			})

			t.Run("rejects literal above max int32", func(t *testing.T) {
				body, variables := request(testenv.GraphQLRequest{Query: `{ employee(id: 3000000000) { id } }`})
				requireValidationError(t, body, `Int cannot represent non 32-bit signed integer value: 3000000000`)
				assert.Nil(t, variables)
			})

			t.Run("rejects variable default above max int32", func(t *testing.T) {
				body, variables := request(testenv.GraphQLRequest{Query: `query ($id: Int! = 3000000000) { employee(id: $id) { id } }`})
				requireValidationError(t, body, `Int cannot represent non 32-bit signed integer value: 3000000000`)
				assert.Nil(t, variables)
			})
		})
	})

	t.Run("configured to the JavaScript safe integer range", func(t *testing.T) {
		t.Parallel()

		run(t, &config.IntScalarRange{Min: -maxSafeInteger, Max: maxSafeInteger}, func(t *testing.T, request func(testenv.GraphQLRequest) (string, json.RawMessage)) {
			for _, id := range []string{"3000000000", "9007199254740991", "-9007199254740991"} {
				t.Run("forwards variable "+id+" to the subgraph", func(t *testing.T) {
					body, variables := request(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":` + id + `}`)})
					assert.Equal(t, `{"data":{"employee":null}}`, body)
					assert.JSONEq(t, `{"a":`+id+`}`, string(variables))
				})
			}

			for _, id := range []string{"9007199254740992", "-9007199254740992"} {
				t.Run("rejects variable "+id, func(t *testing.T) {
					body, variables := request(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":` + id + `}`)})
					requireValidationError(t, body, `Variable "$id" got invalid value `+id+`; Int cannot represent integer value outside [-9007199254740991, 9007199254740991]: `+id)
					assert.Nil(t, variables)
				})
			}

			t.Run("forwards literal 3000000000 to the subgraph", func(t *testing.T) {
				body, variables := request(testenv.GraphQLRequest{Query: `{ employee(id: 3000000000) { id } }`})
				assert.Equal(t, `{"data":{"employee":null}}`, body)
				assert.JSONEq(t, `{"a":3000000000}`, string(variables))
			})

			t.Run("forwards variable default 3000000000 to the subgraph", func(t *testing.T) {
				body, variables := request(testenv.GraphQLRequest{Query: `query ($id: Int! = 3000000000) { employee(id: $id) { id } }`})
				assert.Equal(t, `{"data":{"employee":null}}`, body)
				assert.JSONEq(t, `{"a":3000000000}`, string(variables))
			})

			t.Run("rejects literal outside the range", func(t *testing.T) {
				body, variables := request(testenv.GraphQLRequest{Query: `{ employee(id: 9007199254740992) { id } }`})
				requireValidationError(t, body, `Int cannot represent integer value outside [-9007199254740991, 9007199254740991]: 9007199254740992`)
				assert.Nil(t, variables)
			})
		})
	})
}
