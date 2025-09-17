package core

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

// IntrospectionAuthMode defines how introspection queries are authenticated.
type IntrospectionAuthMode string

// IsValid checks if the introspection authentication mode is valid.
func (m IntrospectionAuthMode) IsValid() bool {
	return m == IntrospectionAuthModeFull || m == IntrospectionAuthModeToken || m == IntrospectionAuthModeSkip
}

const (
	// IntrospectionAuthModeInvalid is an invalid introspection authentication mode.
	IntrospectionAuthModeInvalid IntrospectionAuthMode = ""

	// IntrospectionAuthModeFull requires normal authentication for introspection queries.
	IntrospectionAuthModeFull IntrospectionAuthMode = "full"

	// IntrospectionAuthModeToken requires a specific introspection token for introspection queries.
	IntrospectionAuthModeToken IntrospectionAuthMode = "token"

	// IntrospectionAuthModeSkip bypasses authentication for introspection queries.
	IntrospectionAuthModeSkip IntrospectionAuthMode = "skip"
)

var (
	// ErrUnauthorized is returned when no authentication information is available
	// and authorization requires authentication
	// or when authentication information is available but invalid
	ErrUnauthorized = errors.New("unauthorized")
)

// AccessControllerOptions holds configuration options for creating a new AccessController
type AccessControllerOptions struct {
	Authenticators             []authentication.Authenticator
	AuthenticationRequired     bool
	IntrospectionAuthMode      IntrospectionAuthMode
	IntrospectionAuthSkipToken string
}

// AccessController handles both authentication and authorization for the Router
type AccessController struct {
	authenticationRequired     bool
	authenticators             []authentication.Authenticator
	introspectionAuthMode      IntrospectionAuthMode
	introspectionAuthSkipToken string
}

// NewAccessController creates a new AccessController.
// It returns an error if the introspection auth mode is invalid.
func NewAccessController(opts AccessControllerOptions) (*AccessController, error) {
	if !opts.IntrospectionAuthMode.IsValid() {
		return nil, fmt.Errorf("invalid introspection auth mode: %s", opts.IntrospectionAuthMode)
	}

	return &AccessController{
		authenticationRequired:     opts.AuthenticationRequired,
		authenticators:             opts.Authenticators,
		introspectionAuthMode:      opts.IntrospectionAuthMode,
		introspectionAuthSkipToken: opts.IntrospectionAuthSkipToken,
	}, nil
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

func (a *AccessController) IntrospectionTokenAccess(r *http.Request, body []byte) bool {
	if a.introspectionAuthMode == IntrospectionAuthModeToken {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			return false
		}

		authHeader = strings.TrimSpace(authHeader)

		// guard to prevent bypass when token is unset
		if a.introspectionAuthSkipToken == "" {
			return false
		}

		return subtle.ConstantTimeCompare([]byte(authHeader), []byte(a.introspectionAuthSkipToken)) == 1
	}

	return false
}
