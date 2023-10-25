package integration_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

func setupServerWithJWKS(tb testing.TB, jwksOpts *authentication.JWKSAuthenticatorOptions, opts ...core.Option) (*core.Server, *jwks.Server) {
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
	serverOpts := []core.Option{
		core.WithAuthenticators([]authentication.Authenticator{authenticator}),
	}
	serverOpts = append(serverOpts, opts...)
	return prepareServer(tb, serverOpts...), authServer
}

func TestAuthentication(t *testing.T) {
	server, jwksServer := setupServerWithJWKS(t, nil)

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

		assert.Equal(t, http.StatusForbidden, rr.Code)
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
		HeaderName:        headerName,
		HeaderValuePrefix: headerValuePrefix,
	}
	server, jwksServer := setupServerWithJWKS(t, jwksOpts)
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
	server, jwksServer := setupServerWithJWKS(t, nil, core.WithAuthenticationRequired(true))

	t.Run("no token", func(t *testing.T) {
		// Operations without token should work succeed
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		server.Server.Handler.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusUnauthorized, rr.Code)
		assert.Equal(t, "", rr.Header().Get(xAuthenticatedByHeader))
		assert.NotEqual(t, employeesExpectedData, rr.Body.String())
	})

	t.Run("invalid token", func(t *testing.T) {
		// Operations with an invalid token should fail
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", strings.NewReader(employeesQuery))
		req.Header.Set("Authorization", "Bearer invalid")
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusForbidden, rr.Code)
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
