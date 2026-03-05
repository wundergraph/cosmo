package core

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

var (
	// ErrUnauthorized is returned when no authentication information is available
	// and authorization requires authentication
	// or when authentication information is available but invalid
	ErrUnauthorized = errors.New("unauthorized")
)

// AccessControllerOptions holds configuration options for creating a new AccessController
type AccessControllerOptions struct {
	Authenticators           []authentication.Authenticator
	AuthenticationRequired   bool
	SkipIntrospectionQueries bool
	IntrospectionSkipSecret  string
}

// AccessController handles both authentication and authorization for the Router
type AccessController struct {
	authenticationRequired   bool
	authenticators           []authentication.Authenticator
	skipIntrospectionQueries bool
	introspectionSkipSecret  string
}

// NewAccessController creates a new AccessController.
// It returns an error if the introspection auth mode is invalid.
func NewAccessController(opts AccessControllerOptions) (*AccessController, error) {
	return &AccessController{
		authenticationRequired:   opts.AuthenticationRequired,
		skipIntrospectionQueries: opts.SkipIntrospectionQueries,
		authenticators:           opts.Authenticators,
		introspectionSkipSecret:  opts.IntrospectionSkipSecret,
	}, nil
}

// Access performs authorization and authentication, returning an error if the request
// should not proceed. If it succeeds, a new http.Request with an updated context.Context
// is returned.
func (a *AccessController) Access(w http.ResponseWriter, r *http.Request) (*http.Request, error) {
	auth, err := authentication.AuthenticateHTTPRequest(r.Context(), a.authenticators, r)
	if err != nil {
		return nil, errors.Join(err, ErrUnauthorized)
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

func (a *AccessController) IntrospectionSecretConfigured() bool {
	return a.introspectionSkipSecret != ""
}

// IntrospectionAccess is a dedicated access method check specifically for
// introspection queries.
// It should only be used when introspection authentication skip is enabled.
func (a *AccessController) IntrospectionAccess(r *http.Request, body []byte) bool {
	if !a.skipIntrospectionQueries {
		return false
	}

	if a.introspectionSkipSecret == "" {
		return true
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return false
	}

	authHeader = strings.TrimSpace(authHeader)
	return subtle.ConstantTimeCompare([]byte(authHeader), []byte(a.introspectionSkipSecret)) == 1
}
