package module_test

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	setScopesModule "github.com/wundergraph/cosmo/router/cmd/custom-set-scopes/module"
	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

const (
	jwksName                      = "my-jwks-server"
	employeesQueryRequiringClaims = `{"query":"{ employees { id startDate } }"}`
	xAuthenticatedByHeader        = "X-Authenticated-By"
)

func configureAuth(t *testing.T) ([]authentication.Authenticator, *jwks.Server) {
	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	tokenDecoder, _ := authentication.NewJwksTokenDecoder(authServer.JWKSURL(), time.Second*5)
	authOptions := authentication.HttpHeaderAuthenticatorOptions{
		Name:         jwksName,
		URL:          authServer.JWKSURL(),
		TokenDecoder: tokenDecoder,
	}
	authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
	require.NoError(t, err)
	return []authentication.Authenticator{authenticator}, authServer
}

func TestCustomModuleSetScopes(t *testing.T) {
	t.Parallel()

	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
			"setScopesModule": setScopesModule.SetScopesModule{
				Value: 2,
			},
		},
	}
	authenticators, authServer := configureAuth(t)
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithAccessController(core.NewAccessController(authenticators, false)),
			core.WithModulesConfig(cfg.Modules),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		// Operations with a token should succeed
		token, err := authServer.Token(nil)
		require.NoError(t, err)
		header := http.Header{
			"Authorization": []string{"Bearer " + token},
		}
		res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
		require.NoError(t, err)
		defer res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
		require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
		data, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
	})
}
