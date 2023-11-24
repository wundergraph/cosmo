package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router/authentication"
	"github.com/wundergraph/cosmo/router/core"
)

const (
	jwksName               = "my-jwks-server"
	employeesQuery         = `{"query":"{ employees { id } }"}`
	employeesExpectedData  = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`
	xAuthenticatedByHeader = "X-Authenticated-By"
)

func setupServerWithJWKS(tb testing.TB, jwksOpts *authentication.JWKSAuthenticatorOptions, authRequired bool, opts ...core.Option) (*core.Server, *jwks.Server) {
	authServer, err := jwks.NewServer()
	require.NoError(tb, err)
	tb.Cleanup(authServer.Close)
	if jwksOpts == nil {
		jwksOpts = new(authentication.JWKSAuthenticatorOptions)
	}
	jwksOpts.Name = jwksName
	jwksOpts.URL = authServer.JWKSURL()
	authenticator, err := authentication.NewJWKSAuthenticator(*jwksOpts)
	require.NoError(tb, err)
	authenticators := []authentication.Authenticator{authenticator}
	serverOpts := []core.Option{
		core.WithAccessController(core.NewAccessController(authenticators, authRequired)),
	}
	serverOpts = append(serverOpts, opts...)
	return setupServer(tb, serverOpts...), authServer
}

func assertHasGraphQLErrors(t *testing.T, rr *httptest.ResponseRecorder) {
	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &m))
	assert.NotNil(t, m["errors"])
}

func TestAuthentication(t *testing.T) {
	server, jwksServer := setupServerWithJWKS(t, nil, false)

	t.Run("no token", func(t *testing.T) {
		// Operations without token should work succeed
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		server.Server.Handler.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code)
		assert.Equal(t, "", rr.Header().Get(xAuthenticatedByHeader))
		assert.Equal(t, employeesExpectedData, rr.Body.String())
	})

	t.Run("invalid token", func(t *testing.T) {
		// Operations with an invalid token should fail
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		req.Header.Set("Authorization", "Bearer invalid")
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
		assert.Equal(t, "", rr.Header().Get(xAuthenticatedByHeader))
		assert.NotEqual(t, employeesExpectedData, rr.Body.String())
	})

	t.Run("valid token", func(t *testing.T) {
		// Operations with an token should succeed
		token, err := jwksServer.Token(nil)
		require.NoError(t, err)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		req.Header.Set("Authorization", "Bearer "+token)
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		assert.Equal(t, jwksName, rr.Header().Get(xAuthenticatedByHeader))
		assert.Equal(t, employeesExpectedData, rr.Body.String())
	})
}

func TestAuthenticationWithCustomHeaders(t *testing.T) {
	const (
		headerName        = "X-My-Header"
		headerValuePrefix = "Token"
	)
	jwksOpts := &authentication.JWKSAuthenticatorOptions{
		HeaderNames:         []string{headerName},
		HeaderValuePrefixes: []string{headerValuePrefix},
	}
	server, jwksServer := setupServerWithJWKS(t, jwksOpts, false)
	token, err := jwksServer.Token(nil)
	require.NoError(t, err)

	runTest := func(t *testing.T, headerValue string) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		req.Header.Set(headerName, headerValue)
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		assert.Equal(t, jwksName, rr.Header().Get(xAuthenticatedByHeader))
		assert.Equal(t, employeesExpectedData, rr.Body.String())
	}

	t.Run("with space", func(t *testing.T) {
		runTest(t, headerValuePrefix+" "+token)
	})

	t.Run("without space", func(t *testing.T) {
		runTest(t, headerValuePrefix+token)
	})
}

func TestAuthorization(t *testing.T) {
	server, jwksServer := setupServerWithJWKS(t, nil, true)

	t.Run("no token", func(t *testing.T) {
		// Operations without token should fail
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		server.Server.Handler.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusUnauthorized, rr.Code)
		assert.Equal(t, "", rr.Header().Get(xAuthenticatedByHeader))
		assert.JSONEq(t, `{"errors":[{"message":"unauthorized"}],"data":null}`, rr.Body.String())
	})

	t.Run("invalid token", func(t *testing.T) {
		// Operations with an invalid token should fail
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		req.Header.Set("Authorization", "Bearer invalid")
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
		assert.Equal(t, "", rr.Header().Get(xAuthenticatedByHeader))
		assertHasGraphQLErrors(t, rr)
	})

	t.Run("valid token", func(t *testing.T) {
		// Operations with an token should succeed
		token, err := jwksServer.Token(nil)
		require.NoError(t, err)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		req.Header.Set("Authorization", "Bearer "+token)
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		assert.Equal(t, jwksName, rr.Header().Get(xAuthenticatedByHeader))
		assert.Equal(t, employeesExpectedData, rr.Body.String())
	})
}

func TestAuthenticationMultipleProviders(t *testing.T) {
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
	server := setupServer(t, core.WithAccessController(accessController))

	t.Run("authenticate with first provider", func(t *testing.T) {
		for _, prefix := range authenticator1HeaderValuePrefixes {
			prefix := prefix
			t.Run("prefix "+prefix, func(t *testing.T) {
				token, err := authServer1.Token(nil)
				require.NoError(t, err)
				rr := httptest.NewRecorder()
				req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
				req.Header.Add("Authorization", prefix+token)
				server.Server.Handler.ServeHTTP(rr, req)
				assert.Equal(t, http.StatusOK, rr.Code)
				assert.Equal(t, "1", rr.Header().Get(xAuthenticatedByHeader))
				assert.Equal(t, employeesExpectedData, rr.Body.String())
			})
		}
	})

	t.Run("authenticate with second provider", func(t *testing.T) {
		for _, prefix := range authenticator2HeaderValuePrefixes {
			prefix := prefix
			t.Run("prefix "+prefix, func(t *testing.T) {
				token, err := authServer2.Token(nil)
				require.NoError(t, err)
				rr := httptest.NewRecorder()
				req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
				req.Header.Add("Authorization", prefix+token)
				server.Server.Handler.ServeHTTP(rr, req)
				assert.Equal(t, http.StatusOK, rr.Code)
				assert.Equal(t, "2", rr.Header().Get(xAuthenticatedByHeader))
				assert.Equal(t, employeesExpectedData, rr.Body.String())
			})
		}
	})

	t.Run("invalid token", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		req.Header.Set("Authorization", "Bearer invalid")
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
		assert.Equal(t, "", rr.Header().Get(xAuthenticatedByHeader))
		assertHasGraphQLErrors(t, rr)
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
	serverOpts := []core.Option{
		core.WithAccessController(core.NewAccessController(authenticators, true)),
	}
	_, serverPort := setupListeningServer(t, serverOpts...)

	dialer := websocket.Dialer{
		Subprotocols: []string{"graphql-transport-ws"},
	}
	_, _, err = dialer.Dial(fmt.Sprintf("ws://localhost:%d/graphql", serverPort), nil)
	require.Error(t, err)

	token, err := authServer.Token(nil)
	require.NoError(t, err)
	headers := http.Header{
		"Authorization": []string{"Bearer " + token},
	}
	_, _, err = dialer.Dial(fmt.Sprintf("ws://localhost:%d/graphql", serverPort), headers)
	require.NoError(t, err)

}
