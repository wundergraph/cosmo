package module_jwt_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/routerconfig"
	"github.com/wundergraph/cosmo/router/authentication"
	"github.com/wundergraph/cosmo/router/cmd/custom-jwt/module"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func TestJWTModule(t *testing.T) {

	const (
		secretKey = "hunter2"
	)

	jwksServer, err := jwks.NewServer()
	require.NoError(t, err)
	defer jwksServer.Close()
	t.Cleanup(jwksServer.Close)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		const bearerPrefix = "Bearer "
		authorization := r.Header.Get("Authorization")
		if !strings.HasPrefix(authorization, bearerPrefix) {
			http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
			return
		}
		bearerToken := authorization[len("Bearer "):]
		token, err := jwt.Parse(bearerToken, func(token *jwt.Token) (interface{}, error) {
			return []byte(secretKey), nil
		})
		if err != nil {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		claims := token.Claims.(jwt.MapClaims)
		if claims["iss"] != "cosmo-router" {
			// Token was not signed by the router
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		response := []byte(fmt.Sprintf(`{"data":{"hello": "%s"}}`, claims["sub"]))
		w.Header().Set("Content-Type", "application/json")
		w.Write(response)
	}))
	defer srv.Close()

	ctx := context.Background()

	schemaPath, err := filepath.Abs(filepath.Join("testdata", "schema.graphqls"))
	require.NoError(t, err)
	subgraphs := []routerconfig.Subgraph{
		{
			Name:       "employees",
			RoutingURL: srv.URL,
			Schema: &routerconfig.SubgraphSchema{
				File: schemaPath,
			},
		},
	}

	configFile, err := routerconfig.SerializeSubgraphs(subgraphs)
	require.NoError(t, err)

	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
		Modules: map[string]interface{}{
			module.ModuleID: module.JWTModule{
				SecretKey: secretKey,
			},
		},
	}

	routerConfig, err := core.SerializeConfigFromFile(configFile)
	require.NoError(t, err)

	authenticator, err := authentication.NewJWKSAuthenticator(authentication.JWKSAuthenticatorOptions{
		Name: "jwks-test",
		URL:  jwksServer.JWKSURL(),
	})
	require.NoError(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithAccessController(core.NewAccessController([]authentication.Authenticator{authenticator}, false)),
		core.WithListenerAddr("localhost:3002"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(t, err)

	rr := httptest.NewRecorder()

	queryData := []byte(`{
		"query": "query { hello }",
	}`)
	const subject = "John Doe"
	token, err := jwksServer.Token(map[string]any{
		"iss": "test-server",
		"sub": subject,
		"aud": "World",
	})
	require.NoError(t, err)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(queryData))
	req.Header.Set("Authorization", "Bearer "+token)
	server.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"data":{"hello": "%s"}}`, subject), rr.Body.String())
}
