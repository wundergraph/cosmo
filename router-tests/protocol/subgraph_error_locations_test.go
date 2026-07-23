package integration

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// Reproduces the second facet of Pylon issue #3253:
// "Federation Gateway strips error locations ... in validation error
// propagation from subgraph."
//
// When subgraph error-location propagation is enabled (omit_locations: false),
// the router forwards the subgraph error's `locations` VERBATIM. Those
// line/column numbers are computed by the subgraph against the operation the
// ROUTER sent it — a normalized, single-line, variable-remapped query — not
// against the client's original (super-graph) document. The router never
// translates the coordinates back into the client document's coordinate space,
// so a subgraph-reported "line 1, column 24" lands on the wrong place (or
// nowhere meaningful) when read against the multi-line client query.
//
// This test pins that behavior: it captures the operation the subgraph
// actually received, has the subgraph report the eBay-reported location
// (line 1, column 24), and asserts the client sees that exact location even
// though the relevant field sits on a different line in the client document.
func TestSubgraphErrorLocationsAreSubgraphRelative(t *testing.T) {
	t.Parallel()

	// A deliberately multi-line client query. The `employee` field — the one
	// the error is about — sits well below line 1 here.
	const clientQuery = `query Find(
    $input: Int!
) {
    employee(id: $input) {
        id
    }
}`
	const clientVars = `{"input":1}`

	// The line (1-based) where `employee` appears in the CLIENT document.
	clientEmployeeLine := 0
	for i, line := range strings.Split(clientQuery, "\n") {
		if strings.Contains(line, "employee") {
			clientEmployeeLine = i + 1
			break
		}
	}
	require.Greater(t, clientEmployeeLine, 1,
		"sanity: in the client document the employee field must not be on line 1")

	// The subgraph reports the exact location from the ticket. In the
	// single-line operation the subgraph actually receives, line 1 is the only
	// line that exists, so this is correct *for the subgraph* — but wrong when
	// read against the client document.
	const subgraphLocation = `"locations":[{"line":1,"column":24}]`

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

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = io.WriteString(w,
					`{"errors":[{"message":"Variable 'a' has an invalid value: Invalid URL value",`+subgraphLocation+
						`,"extensions":{"code":"BAD_REQUEST"}}],"data":{"employee":null}}`)
			})
		}
	}

	t.Run("with omit_locations=false the subgraph's own line/column is propagated verbatim (BUG)", func(t *testing.T) {
		t.Parallel()

		var received string
		var mu sync.Mutex

		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.OmitLocations = false // propagate locations
				cfg.AllowedExtensionFields = []string{"code"}
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

			t.Logf("client document employee line:        %d", clientEmployeeLine)
			t.Logf("operation as received by the subgraph: %q", subgraphReceived)
			t.Logf("client-facing response body:          %s", res.Body)

			// The subgraph received a single-line operation, so its "line 1" is
			// only meaningful in that (subgraph) coordinate space.
			require.NotContains(t, subgraphReceived, "\n",
				"subgraph receives a single-line normalized operation")
			require.Contains(t, subgraphReceived, "employee")

			// The router forwards the subgraph's location verbatim...
			require.Contains(t, res.Body, subgraphLocation)

			// ...even though, in the client document, the relevant field is on a
			// line other than 1. The propagated location therefore does NOT point
			// at the right place in the client (super-graph) query.
			require.NotEqual(t, 1, clientEmployeeLine)
		})
	})

	t.Run("with default omit_locations=true the locations are stripped entirely", func(t *testing.T) {
		t.Parallel()

		var received string
		var mu sync.Mutex

		testenv.Run(t, &testenv.Config{
			ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
				cfg.Enabled = true
				cfg.Mode = config.SubgraphErrorPropagationModePassthrough
				cfg.OmitLocations = true // default behavior
				cfg.AllowedExtensionFields = []string{"code"}
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

			t.Logf("client-facing response body: %s", res.Body)

			// This mirrors what eBay currently sees ("we didn't configure it"):
			// no locations at all, rather than wrong ones.
			require.NotContains(t, res.Body, `"locations"`)
		})
	})
}
