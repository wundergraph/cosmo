package core

import (
	"crypto/subtle"
	"errors"
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

var (
	// ErrUnauthorized is returned when no authentication information is available
	// and authorization requires authentication
	// or when authentication information is available but invalid
	ErrUnauthorized = errors.New("unauthorized")
)

// AccessController handles both authentication and authorization for the Router
type AccessController struct {
	authenticationRequired     bool
	authenticators             []authentication.Authenticator
	skipIntrospectionAuth      bool
	introspectionAuthSkipToken string
}

func NewAccessController(authenticators []authentication.Authenticator, authenticationRequired bool, skipIntrospectionAuth bool, introspectionAuthSkipToken string) *AccessController {
	return &AccessController{
		authenticationRequired:     authenticationRequired,
		authenticators:             authenticators,
		skipIntrospectionAuth:      skipIntrospectionAuth,
		introspectionAuthSkipToken: introspectionAuthSkipToken,
	}
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

// BypassAuthIfIntrospection checks if the request is an introspection query and if so,
// bypasses the auth if configured to do so.
// It will return false, basically fall back to authentication, in the following cases:
// - introspection is disabled
// - cannot parse or identify the operation as introspection
// - the provided token does not match the configured token (authentication later on will verify the token)
func (a *AccessController) BypassAuthIfIntrospection(r *http.Request, operationProcessor *OperationProcessor, body []byte) bool {
	if !a.skipIntrospectionAuth {
		return false
	}

	if operationProcessor == nil || body == nil {
		return false
	}

	operationKit, err := operationProcessor.NewKit()
	if err != nil {
		return false
	}
	defer operationKit.Free()

	err = operationKit.UnmarshalOperationFromBody(body)
	if err != nil {
		return false
	}

	err = operationKit.Parse()
	if err != nil {
		return false
	}

	isIntrospection, err := operationKit.isIntrospectionQuery()
	if err != nil {
		return false
	}

	if isIntrospection {
		if a.isValidIntrospectionToken(r) {
			return true
		}
	}

	return false
}

// isValidIntrospectionToken safely validates the configured introspection token
// against the Authorization header of the request.
func (a *AccessController) isValidIntrospectionToken(r *http.Request) bool {
	// If no token is configured, allow introspection without authentication
	if len(a.introspectionAuthSkipToken) == 0 {
		return true
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(authHeader), []byte(a.introspectionAuthSkipToken)) == 1
}
