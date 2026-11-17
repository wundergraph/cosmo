package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/buger/jsonparser"
	"github.com/stretchr/testify/assert"

	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestIntScalarRange(t *testing.T) {
	t.Parallel()

	const (
		maxSafeInteger = 1<<53 - 1
		employeeByID   = `query ($id: Int!) { employee(id: $id) { id } }`
	)

	t.Run("defaults to the 32-bit range", func(t *testing.T) {
		t.Parallel()

		subgraphs, subgraphVariables := recordEmployeesVariables()
		testenv.Run(t, &testenv.Config{Subgraphs: subgraphs}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("accepts max int32 variable", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":2147483647}`)})
				assert.Equal(t, `{"data":{"employee":null}}`, res.Body)
				assert.JSONEq(t, `{"a":2147483647}`, subgraphVariables())
			})

			t.Run("rejects variable above max int32", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":3000000000}`)})
				requireValidationError(t, res.Body, `Variable "$id" got invalid value 3000000000; Int cannot represent non 32-bit signed integer value: 3000000000`)
			})

			t.Run("rejects literal above max int32", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employee(id: 3000000000) { id } }`})
				requireValidationError(t, res.Body, `Int cannot represent non 32-bit signed integer value: 3000000000`)
			})

			t.Run("rejects variable default above max int32", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query ($id: Int! = 3000000000) { employee(id: $id) { id } }`})
				requireValidationError(t, res.Body, `Int cannot represent non 32-bit signed integer value: 3000000000`)
			})
		})
	})

	t.Run("configured to the JavaScript safe integer range", func(t *testing.T) {
		t.Parallel()

		subgraphs, subgraphVariables := recordEmployeesVariables()
		testenv.Run(t, &testenv.Config{
			Subgraphs: subgraphs,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.IntScalarRange = config.IntScalarRange{Min: -maxSafeInteger, Max: maxSafeInteger}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, id := range []string{"3000000000", "9007199254740991", "-9007199254740991"} {
				t.Run("forwards variable "+id+" to the subgraph", func(t *testing.T) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":` + id + `}`)})
					assert.Equal(t, `{"data":{"employee":null}}`, res.Body)
					assert.JSONEq(t, `{"a":`+id+`}`, subgraphVariables())
				})
			}

			for _, id := range []string{"9007199254740992", "-9007199254740992"} {
				t.Run("rejects variable "+id, func(t *testing.T) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: employeeByID, Variables: json.RawMessage(`{"id":` + id + `}`)})
					requireValidationError(t, res.Body, `Variable "$id" got invalid value `+id+`; Int cannot represent integer value outside [-9007199254740991, 9007199254740991]: `+id)
				})
			}

			t.Run("forwards literal 3000000000 to the subgraph", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employee(id: 3000000000) { id } }`})
				assert.Equal(t, `{"data":{"employee":null}}`, res.Body)
				assert.JSONEq(t, `{"a":3000000000}`, subgraphVariables())
			})

			t.Run("forwards variable default 3000000000 to the subgraph", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query ($id: Int! = 3000000000) { employee(id: $id) { id } }`})
				assert.Equal(t, `{"data":{"employee":null}}`, res.Body)
				assert.JSONEq(t, `{"a":3000000000}`, subgraphVariables())
			})

			t.Run("rejects literal outside the range", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employee(id: 9007199254740992) { id } }`})
				requireValidationError(t, res.Body, `Int cannot represent integer value outside [-9007199254740991, 9007199254740991]: 9007199254740992`)
			})
		})
	})
}

// recordEmployeesVariables answers every employees subgraph request with a null employee.
// The returned function reports the variables of the latest request.
func recordEmployeesVariables() (testenv.SubgraphsConfig, func() string) {
	var variables atomic.Value
	variables.Store("")
	subgraphs := testenv.SubgraphsConfig{
		Employees: testenv.SubgraphConfig{
			Middleware: func(http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					body, _ := io.ReadAll(r.Body)
					value, _, _, _ := jsonparser.Get(body, "variables")
					variables.Store(string(value))
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"data":{"employee":null}}`))
				})
			},
		},
	}
	return subgraphs, func() string { return variables.Load().(string) }
}
