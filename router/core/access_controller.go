package core

import (
	"errors"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"net/http"
)

var (
	// ErrUnauthorized is returned when no authentication information is available
	// and authorization requires authentication
	// or when authentication information is available but invalid
	ErrUnauthorized = errors.New("unauthorized")
)

// AccessController handles both authentication and authorization for the Router
type AccessController struct {
	authenticationRequired bool
	authenticators         []authentication.Authenticator
}

func NewAccessController(authenticators []authentication.Authenticator, authenticationRequired bool) *AccessController {
	return &AccessController{
		authenticationRequired: authenticationRequired,
		authenticators:         authenticators,
	}
}

// DefaultAccessController returns an AccessController without authenticators that
// requires no authentication for authorization
func DefaultAccessController() *AccessController {
	return NewAccessController(nil, false)
}

// Access performs authorization and authentication, returning an error if the request
// should not proceed. If it succeeds, a new http.Request with an updated context.Context
// is returned.
func (a *AccessController) Access(w http.ResponseWriter, r *http.Request) (*http.Request, error) {
	auth, err := authentication.AuthenticateHTTPRequest(r.Context(), a.authenticators, r)
	if err != nil {
		return nil, ErrUnauthorized
	}
	if auth != nil {
		w.Header().Set("X-Authenticated-By", auth.Authenticator())
		return r.WithContext(authentication.NewContext(r.Context(), auth)), nil
	}
	if a.authenticationRequired {
		return nil, ErrUnauthorized
	}
	return r, nil
}
