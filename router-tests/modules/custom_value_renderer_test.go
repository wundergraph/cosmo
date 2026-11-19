package module_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	customvaluerenderer "github.com/wundergraph/cosmo/router-tests/modules/custom-value-renderer"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCustomValueRenderer(t *testing.T) {
	t.Parallel()

	t.Run("module is called", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"routerCustomValueRenderer": customvaluerenderer.RouterCustomValueRendererModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&customvaluerenderer.RouterCustomValueRendererModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id details { forename } } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			}, map[string]string{
				"X-Custom-Value-Renderer": "true",
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":123,"details":{"forename":"xxx"}}}}`, res.Body)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id currentMood } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			}, map[string]string{
				"X-Custom-Value-Renderer": "true",
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)
			assert.Equal(t, `{"data":{"employee":{"id":123,"currentMood":"Mood-HAPPY"}}}`, res.Body)
		})
	})
}

func TestWebSocketCustomValueRenderer(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{core.WithCustomModules(&customvaluerenderer.RouterCustomValueRendererModule{})},
	}, func(t *testing.T, env *testenv.Environment) {
		render := http.Header{"X-Custom-Value-Renderer": {"true"}}
		failOnce := http.Header{"X-Custom-Value-Renderer": {"fail-once"}}
		const query = "{ employee(id: 1) { id } }"
		const subscription = "subscription { currentTime { unixTime timeStamp } }"

		type frame struct{ kind, payload string }
		renderError := frame{"next", `{"errors":[{"message":"Internal server error"}],"data":null}`}
		timeUpdate := frame{"next", `{"data":{"currentTime":{"unixTime":123,"timeStamp":"xxx"}}}`}
		for _, tc := range []struct {
			name      string
			header    http.Header
			operation string
			want      []frame
		}{
			{"query with renderer", render, query, []frame{{"next", `{"data":{"employee":{"id":123}}}`}}},
			{"query on another connection", nil, query, []frame{{"next", `{"data":{"employee":{"id":1}}}`}}},
			{"subscription with renderer", render, subscription, []frame{timeUpdate}},
			{"query reports renderer error before completion", failOnce, query, []frame{renderError, {"complete", ""}}},
			{"subscription recovers after renderer error", failOnce, subscription, []frame{renderError, timeUpdate}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				conn := env.InitGraphQLWebSocketConnection(tc.header, nil, nil)
				t.Cleanup(func() { _ = conn.Close() })
				payload, err := json.Marshal(testenv.GraphQLRequest{Query: tc.operation})
				require.NoError(t, err)
				require.NoError(t, testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "subscribe", Payload: payload}))
				for _, want := range tc.want {
					var msg testenv.WebSocketMessage
					require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
					require.Equal(t, "1", msg.ID)
					require.Equal(t, want.kind, msg.Type)
					if want.payload != "" {
						require.JSONEq(t, want.payload, string(msg.Payload))
					}
				}
			})
		}
	})
}
