package core

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

type claimsAuthentication struct {
	authentication.Authentication
	claims authentication.Claims
}

func (a claimsAuthentication) Authenticator() string         { return "jwt" }
func (a claimsAuthentication) Claims() authentication.Claims { return a.claims }

// A string claim "123" and a number claim 123 must not produce the same identity.
// Otherwise two clients that differ only in the type of their identity claim get the
// same ClientBinding.
func TestCursorClientIdentityKeepsClaimTypes(t *testing.T) {
	t.Parallel()

	identity := func(t *testing.T, subject any) string {
		t.Helper()
		id, err := cursorClientIdentity(claimsAuthentication{claims: authentication.Claims{
			"iss":     "https://issuer.example",
			"aud":     "api",
			"user_id": subject,
		}}, "user_id")
		require.NoError(t, err)
		return id.Subject
	}

	require.NotEqual(t, identity(t, "123"), identity(t, float64(123)))
	require.NotEqual(t, identity(t, "true"), identity(t, true))
	require.Equal(t, identity(t, "123"), identity(t, "123"))
}
