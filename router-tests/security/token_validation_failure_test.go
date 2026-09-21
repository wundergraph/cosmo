package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestJWTOnErrorForwarding(t *testing.T) {
	t.Parallel()
	decoder, err := authentication.NewJwksTokenDecoder(t.Context(), zap.NewNop(), []authentication.JWKSConfig{{
		Secret: "jwt-on-error-test-secret-at-least-32-bytes", Algorithm: "HS256", KeyId: "test",
	}})
	require.NoError(t, err)
	headerAuth, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name: "jwks", TokenDecoder: decoder, IgnoreInvalidCredentials: true,
	})
	require.NoError(t, err)
	payloadAuth, err := authentication.NewWebsocketInitialPayloadAuthenticator(authentication.WebsocketInitialPayloadAuthenticatorOptions{
		TokenDecoder: decoder, Key: "Authorization", IgnoreInvalidCredentials: true,
	})
	require.NoError(t, err)
	controller, err := core.NewAccessController(core.AccessControllerOptions{Authenticators: []authentication.Authenticator{headerAuth, payloadAuth}})
	require.NoError(t, err)
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithAccessController(controller),
			core.WithHeaderRules(config.HeaderRules{All: &config.GlobalHeaderRule{Request: []*config.RequestHeaderRule{
				{Operation: config.HeaderRuleOperationPropagate, Named: "Authorization"},
				{Operation: config.HeaderRuleOperationSet, Name: "X-Test-Authenticated", Expression: "request.auth.isAuthenticated ? 'true' : 'false'"},
			}}}),
		},
		ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
			cfg.Authentication.FromInitialPayload.Enabled = true
			cfg.Authentication.FromInitialPayload.Key = "Authorization"
			cfg.Authentication.FromInitialPayload.ExportToken.Enabled = true
			cfg.Authentication.FromInitialPayload.ExportToken.HeaderKey = "Authorization"
		},
	}, func(t *testing.T, env *testenv.Environment) {
		const query = `{ credential: headerValue(name: "Authorization") authenticated: headerValue(name: "X-Test-Authenticated") }`
		const expected = `{"data":{"credential":"Bearer opaque","authenticated":"false"}}`

		t.Run("HTTP forwards invalid credentials without authenticating", func(t *testing.T) {
			res, err := env.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{Query: query}, map[string]string{"Authorization": "Bearer opaque"})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.JSONEq(t, expected, res.Body)
			require.Empty(t, res.Response.Header.Get(xAuthenticatedByHeader))
		})

		t.Run("WebSocket forwards invalid credentials without authenticating", func(t *testing.T) {
			conn, _, err := env.GraphQLWebsocketDialWithRetry(nil, nil)
			require.NoError(t, err)
			require.NotNil(t, conn)
			t.Cleanup(func() { _ = conn.Close() })
			require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				Type: "connection_init", Payload: json.RawMessage(`{"Authorization":"Bearer opaque"}`),
			}))
			var ack testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, conn, &ack))
			require.Equal(t, "connection_ack", ack.Type)

			operation, err := json.Marshal(map[string]string{"query": query})
			require.NoError(t, err)
			require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{ID: "1", Type: "subscribe", Payload: operation}))
			var message testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, conn, &message))
			require.Equal(t, "next", message.Type)
			require.JSONEq(t, expected, string(message.Payload))
			require.NoError(t, conn.Close())
		})
	})
}
