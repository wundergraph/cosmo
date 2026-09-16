package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

const opaqueCredential = "Bearer opaque-credential"

func ignoredTokenHeaderRules() config.HeaderRules {
	return config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: config.HeaderRuleOperationPropagate, Named: "Authorization"},
				{Operation: config.HeaderRuleOperationSet, Name: "X-Test-Authenticated", Expression: "request.auth.isAuthenticated ? 'true' : 'false'"},
			},
		},
	}
}

func configureJWTOnErrorContinue(t *testing.T, fromPayload bool) []authentication.Authenticator {
	t.Helper()
	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	decoder, err := authentication.NewJwksTokenDecoder(t.Context(), zap.NewNop(), []authentication.JWKSConfig{{URL: authServer.JWKSURL()}})
	require.NoError(t, err)
	authenticator, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name: "jwks", TokenDecoder: decoder, IgnoreInvalidCredentials: true,
	})
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}
	if fromPayload {
		authenticator, err = authentication.NewWebsocketInitialPayloadAuthenticator(authentication.WebsocketInitialPayloadAuthenticatorOptions{
			TokenDecoder: decoder, Key: "Authorization", IgnoreInvalidCredentials: true,
		})
		require.NoError(t, err)
		authenticators = append(authenticators, authenticator)
	}
	return authenticators
}

func TestJWTOnErrorHeaderForwarding(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name, target string
		forward      bool
	}{
		{name: "propagate", target: "Authorization", forward: true},
		{name: "rename", target: "X-Forwarded-Token", forward: true},
		{name: "no forwarding rule", target: "Authorization"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			authenticators := configureJWTOnErrorContinue(t, false)
			accessController, err := core.NewAccessController(core.AccessControllerOptions{Authenticators: authenticators})
			require.NoError(t, err)
			var rules config.HeaderRules
			if tt.forward {
				rule := &config.RequestHeaderRule{Operation: config.HeaderRuleOperationPropagate, Named: "Authorization"}
				if tt.target != "Authorization" {
					rule.Rename = tt.target
				}
				rules.Subgraphs = map[string]*config.GlobalHeaderRule{
					"test1": {Request: []*config.RequestHeaderRule{rule}},
				}
			}
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{core.WithAccessController(accessController), core.WithHeaderRules(rules)},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query: fmt.Sprintf(`{ headerValue(name: %q) }`, tt.target),
				}, map[string]string{"Authorization": opaqueCredential})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				want := ""
				if tt.forward {
					want = opaqueCredential
				}
				require.JSONEq(t, fmt.Sprintf(`{"data":{"headerValue":%q}}`, want), res.Body)
				require.Empty(t, res.Response.Header.Get(xAuthenticatedByHeader))
			})
		})
	}
}

func TestJWTOnErrorContinueWebsocket(t *testing.T) {
	t.Parallel()
	for _, fromPayload := range []bool{false, true} {
		t.Run(fmt.Sprintf("initial_payload=%t", fromPayload), func(t *testing.T) {
			t.Parallel()
			authenticators := configureJWTOnErrorContinue(t, fromPayload)
			accessController, err := core.NewAccessController(core.AccessControllerOptions{
				Authenticators: authenticators,
			})
			require.NoError(t, err)
			var fetches atomic.Int32
			forwardedHeaders := make(chan http.Header, 16)
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{core.WithAccessController(accessController), core.WithHeaderRules(ignoredTokenHeaderRules())},
				ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
					// Let authentication validate the payload before other payload consumers.
					cfg.ClientInfoFromInitialPayload.Enabled = false
					cfg.Authentication.FromInitialPayload.Enabled = fromPayload
					cfg.Authentication.FromInitialPayload.Key = "Authorization"
					cfg.Authentication.FromInitialPayload.ExportToken.Enabled = fromPayload
					cfg.Authentication.FromInitialPayload.ExportToken.HeaderKey = "Authorization"
				},
				Subgraphs: testenv.SubgraphsConfig{
					GlobalMiddleware: func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							fetches.Add(1)
							select {
							case forwardedHeaders <- r.Header.Clone():
							default:
							}
							next.ServeHTTP(w, r)
						})
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := http.Header{"Authorization": []string{opaqueCredential}}
				var payload json.RawMessage
				if fromPayload {
					header = nil
					payload = json.RawMessage(`{"Authorization":"` + opaqueCredential + `"}`)
				}
				conn := xEnv.InitGraphQLWebSocketConnection(header, nil, payload)
				for i, operation := range []string{employeesQuery, employeesQueryBodyRequiringClaims} {
					id := strconv.Itoa(i + 1)
					require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{ID: id, Type: "subscribe", Payload: json.RawMessage(operation)}))
					var res testenv.WebSocketMessage
					require.NoError(t, testenv.WSReadJSON(t, conn, &res))
					require.Equal(t, "next", res.Type)
					require.Equal(t, id, res.ID)
					if i == 0 {
						require.JSONEq(t, employeesExpectedData, string(res.Payload))
						select {
						case forwarded := <-forwardedHeaders:
							require.Equal(t, opaqueCredential, forwarded.Get("Authorization"))
							require.Equal(t, "false", forwarded.Get("X-Test-Authenticated"))
						default:
							t.Fatal("expected an executed subgraph request")
						}
					} else {
						require.Contains(t, string(res.Payload), "Reason: not authenticated")
					}
					var complete testenv.WebSocketMessage
					require.NoError(t, testenv.WSReadJSON(t, conn, &complete))
					require.Equal(t, "complete", complete.Type)
					require.Equal(t, id, complete.ID)
				}
				require.NoError(t, conn.Close())

				if fromPayload {
					for _, payload := range []json.RawMessage{json.RawMessage(`[]`), json.RawMessage(`{"Authorization":42}`)} {
						before := fetches.Load()
						conn := xEnv.InitGraphQLWebSocketConnection(http.Header{"Authorization": []string{opaqueCredential}}, nil, payload)
						var res testenv.WebSocketMessage
						require.NoError(t, testenv.WSReadJSON(t, conn, &res))
						require.Equal(t, "error", res.Type)
						require.JSONEq(t, `[{"message":"unauthorized"}]`, string(res.Payload))
						require.Equal(t, before, fetches.Load(), "malformed payloads must reject before subgraph execution")
						require.NoError(t, conn.Close())
					}
				}
			})
		})
	}
}

type failingTokenValidationAuthenticator struct{}

func (*failingTokenValidationAuthenticator) Name() string { return "custom" }
func (*failingTokenValidationAuthenticator) Authenticate(context.Context, authentication.Provider) (authentication.Claims, error) {
	return nil, errors.New("custom authentication service unavailable")
}

func TestJWTOnErrorContinueRejectsCustomAuthenticator(t *testing.T) {
	t.Parallel()
	authenticators := configureJWTOnErrorContinue(t, false)
	authenticators = append(authenticators, &failingTokenValidationAuthenticator{})
	accessController, err := core.NewAccessController(core.AccessControllerOptions{Authenticators: authenticators})
	require.NoError(t, err)
	var fetches atomic.Int32
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{core.WithAccessController(accessController)},
		Subgraphs: testenv.SubgraphsConfig{
			GlobalMiddleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					fetches.Add(1)
					next.ServeHTTP(w, r)
				})
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		for _, credential := range []string{"", opaqueCredential} {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{Query: `{ employees { id } }`}, map[string]string{"Authorization": credential})
			require.NoError(t, err)
			require.Equal(t, http.StatusUnauthorized, res.Response.StatusCode)
			require.JSONEq(t, unauthorizedExpectedData, res.Body)
			require.Zero(t, fetches.Load(), "custom authenticator errors must reject before subgraph execution")
		}
	})
}
