package integration_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router/authentication"
	"github.com/wundergraph/cosmo/router/core"
)

func TestAuthentication(t *testing.T) {
	authServer, err := jwks.NewServer()
	require.NoError(t, err)
	defer authServer.Close()
	authenticator, err := authentication.NewJWKSAuthenticator(authServer.JWKSURL())
	require.NoError(t, err)
	server := prepareServer(t, core.WithAuthenticators([]authentication.Authenticator{authenticator}))

	employeesQuery := []byte(`{"query":"{ employees { id } }"}`)
	employeesData := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`

	t.Run("no token", func(t *testing.T) {
		// Operations without token should work succeed
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(employeesQuery))
		server.Server.Handler.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code)
		assert.NotEqual(t, "true", rr.Header().Get("X-Authenticated"))
		assert.Equal(t, employeesData, rr.Body.String())
	})

	t.Run("invalid token", func(t *testing.T) {
		// Operations with an invalid token should fail
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(employeesQuery))
		req.Header.Set("Authorization", "Bearer invalid")
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusForbidden, rr.Code)
		assert.NotEqual(t, "true", rr.Header().Get("X-Authenticated"))
		assert.NotEqual(t, employeesData, rr.Body.String())
	})

	t.Run("valid token", func(t *testing.T) {
		// Operations with an token should succeed
		token, err := authServer.Token(nil)
		require.NoError(t, err)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(employeesQuery))
		req.Header.Set("Authorization", "Bearer "+token)
		server.Server.Handler.ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		assert.Equal(t, "true", rr.Header().Get("X-Authenticated"))
		assert.Equal(t, employeesData, rr.Body.String())
	})
}
