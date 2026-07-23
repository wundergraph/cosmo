package integration

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// Reproduces Pylon issue #3253:
// "Federation Gateway: Validation Error Handling and Variable Renaming"
//
// A subgraph performs its own validation and returns an error message that
// references the GraphQL variable by name (e.g. "Variable 'input' has an
// invalid value: ..."). The router remaps client variable names to a
// canonical, predictable form ($input -> $a) to improve plan-cache hit rate,
// and sends the REMAPPED operation to the subgraph. The subgraph therefore
// only ever sees "$a", and its error message — propagated verbatim to the
// client — references "a" instead of the client's original "input".
//
// This test captures what the subgraph actually receives and asserts the
// variable name that surfaces in the client-facing error, both with remapping
// enabled (default, buggy) and disabled (mitigation).
func TestVariableRemappingInSubgraphError(t *testing.T) {
	t.Parallel()

	// The client uses a variable named "input" (mirrors the eBay payload).
	const clientQuery = `query Find($input: Int!) { employee(id: $input) { id } }`
	const clientVars = `{"input":1}`

	// firstVarRegex extracts the first "$name" token from the operation that
	// the subgraph received, so we can echo it back in a validation error the
	// way a real subgraph would.
	firstVarRegex := regexp.MustCompile(`\$([A-Za-z_][A-Za-z0-9_]*)`)

	// makeSubgraphMiddleware returns a middleware that records the raw
	// operation the subgraph received and answers with an eBay-style
	// validation error referencing the variable name as the subgraph saw it.
	makeSubgraphMiddleware := func(received *string, mu *sync.Mutex) func(http.Handler) http.Handler {
		return func(http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)

				var req struct {
					Query string `json:"query"`
				}
				_ = json.Unmarshal(body, &req)

				mu.Lock()
				*received = req.Query
				mu.Unlock()

				varName := ""
				if m := firstVarRegex.FindStringSubmatch(req.Query); len(m) > 1 {
					varName = m[1]
				}

				msg := fmt.Sprintf("Variable '%s' has an invalid value: Invalid URL value", varName)

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = fmt.Fprintf(w, `{"errors":[{"message":%q}],"data":{"employee":null}}`, msg)
			})
		}
	}

	t.Run("remapping ENABLED (default) - subgraph sees $a, client error says 'a' (BUG)", func(t *testing.T) {
		t.Parallel()

		var received string
		var mu sync.Mutex

		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: makeSubgraphMiddleware(&received, &mu),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     clientQuery,
				Variables: json.RawMessage(clientVars),
			})
			require.NoError(t, err)

			mu.Lock()
			subgraphReceived := received
			mu.Unlock()

			t.Logf("operation as received by the subgraph: %s", subgraphReceived)
			t.Logf("client-facing response body:          %s", res.Body)

			// The subgraph received the REMAPPED variable name, not the original.
			require.Contains(t, subgraphReceived, "$a", "subgraph should have received the remapped variable $a")
			require.NotContains(t, subgraphReceived, "$input", "subgraph should NOT have received the original $input")

			// This is the bug: the client asked about $input but sees 'a'.
			require.Contains(t, res.Body, "Variable 'a' has an invalid value")
			require.NotContains(t, res.Body, "Variable 'input' has an invalid value")
		})
	})

	t.Run("remapping DISABLED - subgraph sees $input, client error says 'input' (MITIGATED)", func(t *testing.T) {
		t.Parallel()

		var received string
		var mu sync.Mutex

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.DisableVariablesRemapping = true
			},
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			},
			Subgraphs: testenv.SubgraphsConfig{
				GlobalMiddleware: makeSubgraphMiddleware(&received, &mu),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     clientQuery,
				Variables: json.RawMessage(clientVars),
			})
			require.NoError(t, err)

			mu.Lock()
			subgraphReceived := received
			mu.Unlock()

			t.Logf("operation as received by the subgraph: %s", subgraphReceived)
			t.Logf("client-facing response body:          %s", res.Body)

			// With remapping disabled, the subgraph receives the original name.
			require.Contains(t, subgraphReceived, "$input", "subgraph should have received the original variable $input")

			// Mitigation: the client sees its own variable name.
			require.Contains(t, res.Body, "Variable 'input' has an invalid value")
			require.NotContains(t, res.Body, "Variable 'a' has an invalid value")
		})
	})
}
