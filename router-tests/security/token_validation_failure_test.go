package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	authdeny "github.com/wundergraph/cosmo/router-tests/modules/custom-auth-deny"
	"github.com/wundergraph/cosmo/router-tests/testenv"
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

func configureJWTOnErrorContinue(t *testing.T, fromPayload bool) ([]authentication.Authenticator, *jwks.Server) {
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
	return authenticators, authServer
}

func TestJWTOnErrorHeaderForwarding(t *testing.T) {
	t.Parallel()

	for _, tt := range []struct {
		name     string
		onError  config.JWTOnError
		required bool
		forward  bool
	}{
		{name: "default rejects", forward: true},
		{name: "reject", onError: config.JWTOnErrorReject, forward: true},
		{name: "continue forwards", onError: config.JWTOnErrorContinue, forward: true},
		{name: "continue without forwarding rules", onError: config.JWTOnErrorContinue},
		{name: "continue with required authentication", onError: config.JWTOnErrorContinue, required: true, forward: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			authServer, err := jwks.NewServer(t)
			require.NoError(t, err)
			t.Cleanup(authServer.Close)
			valid, err := authServer.Token(map[string]any{"sub": "test-user", "scope": "read:all"})
			require.NoError(t, err)
			expired, err := authServer.Token(map[string]any{"sub": "test-user", "scope": "read:all", "exp": time.Now().Add(-time.Hour).Unix()})
			require.NoError(t, err)

			var forwarded atomic.Pointer[http.Header]
			subgraph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				headers := r.Header.Clone()
				forwarded.Store(&headers)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(employeesExpectedData))
			}))
			t.Cleanup(subgraph.Close)

			dir := t.TempDir()
			routerConfig := strings.ReplaceAll(testenv.ConfigJSONTemplate, subgraphs.EmployeesDefaultDemoURL, subgraph.URL)
			require.NoError(t, os.WriteFile(filepath.Join(dir, "config.json"), []byte(routerConfig), 0o600))
			yamlConfig := fmt.Sprintf(`
version: "1"
router_config_path: config.json
authentication:
  jwt:
    jwks:
      - url: %q
    header_sources:
      - type: header
        name: X-Token
        value_prefixes: [Token]
`, authServer.JWKSURL())
			if tt.onError != "" {
				yamlConfig += fmt.Sprintf("    on_error: %s\n", tt.onError)
			}
			yamlConfig += fmt.Sprintf(`
authorization:
  require_authentication: %t
headers:
  all:
    request:
      - op: set
        name: X-Test-Authenticated
        expression: "request.auth.isAuthenticated ? 'true' : 'false'"
      - op: set
        name: X-Test-Subject
        expression: "request.auth.isAuthenticated ? request.auth.claims.sub : 'anonymous'"
`, tt.required)
			if tt.forward {
				yamlConfig += `
      - op: propagate
        named: Authorization
  subgraphs:
    employees:
      request:
        - op: propagate
          named: X-Token
          rename: X-Forwarded-Token
`
			}
			require.NoError(t, os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(yamlConfig), 0o600))

			// Start from YAML to exercise configuration loading and access-controller wiring.
			err = testenv.RunRouterBinary(t, &testenv.Config{}, testenv.RunRouterBinConfigOptions{
				OverrideDirectory: dir,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, source := range []struct{ header, prefix, target string }{
					{"Authorization", "Bearer", "Authorization"},
					{"X-Token", "Token", "X-Forwarded-Token"},
				} {
					for _, credential := range []struct {
						name, value string
						valid       bool
					}{
						{name: "missing"},
						{name: "opaque", value: source.prefix + " opaque-private-token"},
						{name: "malformed JWT", value: source.prefix + " private.invalid.jwt"},
						{name: "unsupported prefix", value: "Basic opaque-private-token"},
						{name: "empty token", value: source.prefix},
						{name: "expired JWT", value: source.prefix + " " + expired},
						{name: "valid JWT", value: source.prefix + " " + valid, valid: true},
					} {
						t.Run(source.header+"/"+credential.name, func(t *testing.T) {
							forwarded.Store(nil)
							headers := map[string]string{}
							if credential.value != "" {
								headers[source.header] = credential.value
							}
							res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{Query: `{ employees { id } }`}, headers)
							require.NoError(t, err)
							allowed := credential.valid || !tt.required && (credential.value == "" || tt.onError == config.JWTOnErrorContinue)
							if !allowed {
								require.Equal(t, http.StatusUnauthorized, res.Response.StatusCode)
								require.JSONEq(t, unauthorizedExpectedData, res.Body)
								require.Nil(t, forwarded.Load(), "rejected requests must not reach the subgraph")
								return
							}
							require.Equal(t, http.StatusOK, res.Response.StatusCode)
							require.JSONEq(t, employeesExpectedData, res.Body)
							received := forwarded.Load()
							require.NotNil(t, received, "expected an executed subgraph request")
							if tt.forward {
								require.Equal(t, credential.value, received.Get(source.target))
							} else {
								require.Empty(t, received.Get(source.target))
							}
							require.Empty(t, received.Get("X-Token"), "custom credential is only forwarded under its configured name")
							require.Equal(t, strconv.FormatBool(credential.valid), received.Get("X-Test-Authenticated"))
							if credential.valid {
								require.Equal(t, "test-user", received.Get("X-Test-Subject"))
								require.Equal(t, "jwks", res.Response.Header.Get(xAuthenticatedByHeader))
							} else {
								require.Equal(t, "anonymous", received.Get("X-Test-Subject"))
								require.Empty(t, res.Response.Header.Get(xAuthenticatedByHeader))
							}
						})
					}
				}
			})
			require.NoError(t, err)
		})
	}
}

func TestJWTOnErrorContinueModule(t *testing.T) {
	t.Parallel()
	for _, preFetch := range []bool{false, true} {
		t.Run(fmt.Sprintf("pre_fetch_authorization=%t", preFetch), func(t *testing.T) {
			t.Parallel()
			authenticators, authServer := configureJWTOnErrorContinue(t, false)
			accessController, err := core.NewAccessController(core.AccessControllerOptions{
				Authenticators: authenticators,
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
			authenticators, _ := configureJWTOnErrorContinue(t, fromPayload)
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

				if fromPayload {
					for _, payload := range []json.RawMessage{json.RawMessage(`[]`), json.RawMessage(`{"Authorization":42}`)} {
						before := fetches.Load()
						conn := xEnv.InitGraphQLWebSocketConnection(http.Header{"Authorization": []string{acceptedOpaqueCredential}}, nil, payload)
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
	authenticators, _ := configureJWTOnErrorContinue(t, false)
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
		for _, credential := range []string{"", acceptedOpaqueCredential} {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{Query: `{ employees { id } }`}, map[string]string{"Authorization": credential})
			require.NoError(t, err)
			require.Equal(t, http.StatusUnauthorized, res.Response.StatusCode)
			require.JSONEq(t, unauthorizedExpectedData, res.Body)
			require.Zero(t, fetches.Load(), "custom authenticator errors must reject before subgraph execution")
		}
	})
}
