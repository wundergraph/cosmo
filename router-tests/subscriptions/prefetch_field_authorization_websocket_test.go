package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestPreFetchFieldAuthorizationWebSocket exercises pre-fetch field authorization over the websocket
// query path, which wires the batch authorizer in websocket.go. Behavior must match the default
// post-fetch authorization over the same path.
func TestPreFetchFieldAuthorizationWebSocket(t *testing.T) {
	t.Parallel()

	newAccessController := func(t *testing.T) (*core.AccessController, *jwks.Server) {
		t.Helper()
		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(testutils.NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
			Name:         testutils.JwksName,
			TokenDecoder: tokenDecoder,
		})
		require.NoError(t, err)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators: []authentication.Authenticator{authenticator},
		})
		require.NoError(t, err)
		return accessController, authServer
	}

	t.Run("no-reject nulls the unauthorized field", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
					RejectOperationIfUnauthorized:    false,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
			err = testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id startDate } }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",0,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",1,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",2,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",3,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",4,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",5,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",6,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",7,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",8,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",9,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]}}`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})

	t.Run("nullable field is nulled while the rest of the data is returned", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Query.secret is nullable and protected, so it is nulled while the sibling floatField still
			// resolves, giving a partial response. Over the websocket query path the field authorizer does
			// not see the request as authenticated (same as the default-mode websocket tests), so the deny
			// reason is "not authenticated" regardless of the token's scopes.
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
			err = testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ secret { value } floatField(arg: 1.5) }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.secret', Reason: not authenticated.","path":["secret"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"secret":null,"floatField":1.5}}`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})

	t.Run("reject fails the whole operation", func(t *testing.T) {
		t.Parallel()

		accessController, authServer := newAccessController(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					EnablePreFetchFieldAuthorization: true,
					RejectOperationIfUnauthorized:    true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
			err = testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id startDate } }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, `[{"message":"Unauthorized"}]`, string(res.Payload))
			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)
			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
}
