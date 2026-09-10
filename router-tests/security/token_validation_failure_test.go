package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	authdeny "github.com/wundergraph/cosmo/router-tests/modules/custom-auth-deny"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

const acceptedOpaqueCredential = "Bearer opaque-credential-accepted-by-module"

type opaqueTokenValidationModule struct{}

func (*opaqueTokenValidationModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:  "testOpaqueTokenValidation",
		New: func() core.Module { return &opaqueTokenValidationModule{} },
	}
}

func (*opaqueTokenValidationModule) Middleware(ctx core.RequestContext, next http.Handler) {
	ctx.ResponseWriter().Header().Set("X-Test-Module-Authenticated", strconv.FormatBool(ctx.Authentication() != nil))
	if ctx.Authentication() == nil && ctx.Request().Header.Get("Authorization") != acceptedOpaqueCredential {
		core.WriteResponseError(ctx, &authdeny.MockHttpError{
			MessageText: "Credential rejected by module", Code: http.StatusUnauthorized, ExtensionCodeValue: "UNAUTHORIZED",
		})
		return
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

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

func TestJWTOnErrorContinueModule(t *testing.T) {
	t.Parallel()
	for _, preFetch := range []bool{false, true} {
		t.Run(fmt.Sprintf("pre_fetch_authorization=%t", preFetch), func(t *testing.T) {
			t.Parallel()
			authenticators, authServer := testutils.ConfigureAuth(t)
			accessController, err := core.NewAccessController(core.AccessControllerOptions{
				Authenticators: authenticators, JWTOnError: config.JWTOnErrorContinue,
			})
			require.NoError(t, err)
			var fetches atomic.Int32
			forwardedHeaders := make(chan http.Header, 16)
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(accessController),
					core.WithCustomModules(&opaqueTokenValidationModule{}),
					core.WithModulesConfig(map[string]any{"testOpaqueTokenValidation": map[string]any{}}),
					core.WithHeaderRules(ignoredTokenHeaderRules()),
					core.WithAuthorizationConfig(&config.AuthorizationConfiguration{EnablePreFetchFieldAuthorization: preFetch}),
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
				query := testenv.GraphQLRequest{Query: `{ employees { id } }`}
				res, err := xEnv.MakeGraphQLRequestWithHeaders(query, map[string]string{"Authorization": acceptedOpaqueCredential})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.JSONEq(t, employeesExpectedData, res.Body)
				require.Equal(t, "false", res.Response.Header.Get("X-Test-Module-Authenticated"))
				require.Empty(t, res.Response.Header.Get(xAuthenticatedByHeader))
				select {
				case header := <-forwardedHeaders:
					require.Equal(t, acceptedOpaqueCredential, header.Get("Authorization"))
					require.Equal(t, "false", header.Get("X-Test-Authenticated"))
				default:
					t.Fatal("expected an executed subgraph request")
				}

				for _, credential := range []string{"Bearer opaque-rejected-by-module", ""} {
					before := fetches.Load()
					res, err := xEnv.MakeGraphQLRequestWithHeaders(query, map[string]string{"Authorization": credential})
					require.NoError(t, err)
					require.Equal(t, http.StatusUnauthorized, res.Response.StatusCode)
					require.Contains(t, res.Body, "Credential rejected by module")
					require.Equal(t, "false", res.Response.Header.Get("X-Test-Module-Authenticated"))
					require.Equal(t, before, fetches.Load(), "module rejection must happen before subgraph execution")
				}

				res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{Query: employeesQueryRequiringClaims}, map[string]string{"Authorization": acceptedOpaqueCredential})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Contains(t, res.Body, "Reason: not authenticated")
				require.Contains(t, res.Body, "UNAUTHORIZED_FIELD_OR_TYPE")

				token, err := authServer.Token(map[string]any{"scope": "read:all"})
				require.NoError(t, err)
				res, err = xEnv.MakeGraphQLRequestWithHeaders(query, map[string]string{"Authorization": "Bearer " + token})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, "true", res.Response.Header.Get("X-Test-Module-Authenticated"))
				require.NotEmpty(t, res.Response.Header.Get(xAuthenticatedByHeader))
			})
		})
	}
}

func TestJWTOnErrorContinueWebsocket(t *testing.T) {
	t.Parallel()
	for _, fromPayload := range []bool{false, true} {
		t.Run(fmt.Sprintf("initial_payload=%t", fromPayload), func(t *testing.T) {
			t.Parallel()
			authenticators, authServer := testutils.ConfigureAuth(t)
			if fromPayload {
				decoder, err := authentication.NewJwksTokenDecoder(t.Context(), zap.NewNop(), []authentication.JWKSConfig{{URL: authServer.JWKSURL()}})
				require.NoError(t, err)
				authenticator, err := authentication.NewWebsocketInitialPayloadAuthenticator(authentication.WebsocketInitialPayloadAuthenticatorOptions{
					TokenDecoder: decoder, Key: "Authorization",
				})
				require.NoError(t, err)
				authenticators = append(authenticators, authenticator)
			}
			accessController, err := core.NewAccessController(core.AccessControllerOptions{
				Authenticators: authenticators, JWTOnError: config.JWTOnErrorContinue,
			})
			require.NoError(t, err)
			forwardedHeaders := make(chan http.Header, 16)
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{core.WithAccessController(accessController), core.WithHeaderRules(ignoredTokenHeaderRules())},
				ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
					cfg.Authentication.FromInitialPayload.Enabled = fromPayload
					cfg.Authentication.FromInitialPayload.Key = "Authorization"
					cfg.Authentication.FromInitialPayload.ExportToken.Enabled = fromPayload
					cfg.Authentication.FromInitialPayload.ExportToken.HeaderKey = "Authorization"
				},
				Subgraphs: testenv.SubgraphsConfig{
					GlobalMiddleware: func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							select {
							case forwardedHeaders <- r.Header.Clone():
							default:
							}
							next.ServeHTTP(w, r)
						})
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := http.Header{"Authorization": []string{acceptedOpaqueCredential}}
				var payload json.RawMessage
				if fromPayload {
					header = nil
					payload = json.RawMessage(`{"Authorization":"` + acceptedOpaqueCredential + `"}`)
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
							require.Equal(t, acceptedOpaqueCredential, forwarded.Get("Authorization"))
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
			})
		})
	}
}
