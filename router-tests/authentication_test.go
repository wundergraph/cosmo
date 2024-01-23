package integration_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

const (
	jwksName                 = "my-jwks-server"
	employeesQuery           = `{"query":"{ employees { id } }"}`
	employeesExpectedData    = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`
	unauthorizedExpectedData = `{"errors":[{"message":"unauthorized"}],"data":null}`
	xAuthenticatedByHeader   = "X-Authenticated-By"
)

func TestAuthentication(t *testing.T) {
	t.Parallel()

	authServer, err := jwks.NewServer()
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	authOptions := authentication.JWKSAuthenticatorOptions{
		Name: jwksName,
		URL:  authServer.JWKSURL(),
	}
	authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	t.Run("no token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations without token should work succeed
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an invalid token should fail
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("valid token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an token should succeed
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})
}

func TestAuthenticationWithCustomHeaders(t *testing.T) {
	t.Parallel()

	const (
		headerName        = "X-My-Header"
		headerValuePrefix = "Token"
	)

	authServer, err := jwks.NewServer()
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	authOptions := authentication.JWKSAuthenticatorOptions{
		Name:                jwksName,
		URL:                 authServer.JWKSURL(),
		HeaderNames:         []string{headerName},
		HeaderValuePrefixes: []string{headerValuePrefix},
	}
	authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	token, err := authServer.Token(nil)
	require.NoError(t, err)

	runTest := func(t *testing.T, headerValue string) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			header := http.Header{
				headerName: []string{headerValue},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	}

	t.Run("with space", func(t *testing.T) {
		runTest(t, headerValuePrefix+" "+token)
	})

	t.Run("without space", func(t *testing.T) {
		runTest(t, headerValuePrefix+token)
	})
}

func TestAuthorization(t *testing.T) {
	t.Parallel()

	authServer, err := jwks.NewServer()
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	authOptions := authentication.JWKSAuthenticatorOptions{
		Name: jwksName,
		URL:  authServer.JWKSURL(),
	}
	authenticator, err := authentication.NewJWKSAuthenticator(authOptions)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	token, err := authServer.Token(nil)
	require.NoError(t, err)

	t.Run("no token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations without token should fail
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an invalid token should fail
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("valid token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, jwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})
}

func TestAuthenticationMultipleProviders(t *testing.T) {
	t.Parallel()
	authServer1, err := jwks.NewServer()
	require.NoError(t, err)
	t.Cleanup(authServer1.Close)

	authServer2, err := jwks.NewServer()
	require.NoError(t, err)
	t.Cleanup(authServer2.Close)

	authenticator1HeaderValuePrefixes := []string{"Bearer"}
	authenticator1, err := authentication.NewJWKSAuthenticator(authentication.JWKSAuthenticatorOptions{
		Name:                "1",
		HeaderValuePrefixes: authenticator1HeaderValuePrefixes,
		URL:                 authServer1.JWKSURL(),
	})
	require.NoError(t, err)

	authenticator2HeaderValuePrefixes := []string{"", "Bearer", "Token"}
	authenticator2, err := authentication.NewJWKSAuthenticator(authentication.JWKSAuthenticatorOptions{
		Name:                "2",
		HeaderValuePrefixes: authenticator2HeaderValuePrefixes,
		URL:                 authServer2.JWKSURL(),
	})
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator1, authenticator2}
	accessController := core.NewAccessController(authenticators, false)

	t.Run("authenticate with first provider", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, prefix := range authenticator1HeaderValuePrefixes {
				prefix := prefix
				t.Run("prefix "+prefix, func(t *testing.T) {
					token, err := authServer1.Token(nil)
					require.NoError(t, err)
					header := http.Header{
						"Authorization": []string{prefix + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, "1", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			}
		})
	})

	t.Run("authenticate with second provider", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, prefix := range authenticator2HeaderValuePrefixes {
				prefix := prefix
				t.Run("prefix "+prefix, func(t *testing.T) {
					token, err := authServer2.Token(nil)
					require.NoError(t, err)
					header := http.Header{
						"Authorization": []string{prefix + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, "2", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			}
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})
}

func TestAuthenticationOverWebsocket(t *testing.T) {
	authServer, err := jwks.NewServer()
	require.NoError(t, err)
	defer authServer.Close()

	jwksOpts := authentication.JWKSAuthenticatorOptions{
		Name: jwksName,
		URL:  authServer.JWKSURL(),
	}

	authenticator, err := authentication.NewJWKSAuthenticator(jwksOpts)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithAccessController(core.NewAccessController(authenticators, true)),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {

		conn, res, err := xEnv.GraphQLWebsocketDialWithRetry(nil)
		require.Nil(t, conn)
		require.Error(t, err)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode)

		token, err := authServer.Token(nil)
		require.NoError(t, err)

		headers := http.Header{
			"Authorization": []string{"Bearer " + token},
		}
		conn, res, err = xEnv.GraphQLWebsocketDialWithRetry(headers)
		defer func() {
			require.NoError(t, conn.Close())
		}()

		require.NoError(t, err)
		require.Equal(t, http.StatusSwitchingProtocols, res.StatusCode)
	})
}
