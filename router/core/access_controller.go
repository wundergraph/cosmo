package core

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

// IntrospectionAuthMode defines how introspection queries are authenticated.
type IntrospectionAuthMode string

const (
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

// AccessController handles both authentication and authorization for the Router
type AccessController struct {
	authenticationRequired     bool
	authenticators             []authentication.Authenticator
	introspectionAuthMode      IntrospectionAuthMode
	introspectionAuthSkipToken string
}

// NewAccessController creates a new AccessController.
// It returns an error if the introspection auth mode is invalid.
func NewAccessController(
	authenticators []authentication.Authenticator,
	authenticationRequired bool,
	introspectionAuthMode IntrospectionAuthMode,
	introspectionAuthSkipToken string) (*AccessController, error) {
	if introspectionAuthMode != IntrospectionAuthModeFull && introspectionAuthMode != IntrospectionAuthModeToken && introspectionAuthMode != IntrospectionAuthModeSkip {
		return nil, fmt.Errorf("invalid introspection auth mode: %s", introspectionAuthMode)
	}

	return &AccessController{
		authenticationRequired:     authenticationRequired,
		authenticators:             authenticators,
		introspectionAuthMode:      introspectionAuthMode,
		introspectionAuthSkipToken: introspectionAuthSkipToken,
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

// BypassAuthIfIntrospection checks if the request is an introspection query and if so,
// returns true to indicate that the auth should be skipped.
// It will return false, indicating to fall back to authentication, in the following cases:
// - introspection is disabled
// - introspection authentication skip is not enabled
// - cannot parse or identify the operation as introspection
// - the provided token does not match the configured token (authentication later on will verify the token)
func (a *AccessController) SkipAuthIfIntrospection(r *http.Request, operationProcessor *OperationProcessor, body []byte) bool {
	if a.introspectionAuthMode == IntrospectionAuthModeFull {
		return false
	}

	if !isIntrospectionQuery(operationProcessor, body) {
		return false
	}

	if a.introspectionAuthMode == IntrospectionAuthModeToken {
		return a.isValidIntrospectionToken(r)
	}

	return true
}

// isIntrospectionQuery checks if the operation in body is an introspection query.
// It returns false if the operation is not an introspection query or we cannot parse it.
func isIntrospectionQuery(operationProcessor *OperationProcessor, body []byte) bool {
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

	return isIntrospection
}

// isValidIntrospectionToken safely validates the configured introspection token
// against the Authorization header of the request.
func (a *AccessController) isValidIntrospectionToken(r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(authHeader), []byte(a.introspectionAuthSkipToken)) == 1
}
