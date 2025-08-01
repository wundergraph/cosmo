package authentication

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

type Claims map[string]any

// Provider is an interface that represents entities that might provide
// authentication information. If no authentication information is available,
// the AuthenticationHeaders method should return nil.
type Provider interface {
	AuthenticationHeaders() http.Header
}

// Authenticator represents types that given a Provider, can authenticate it.
// If no authentication information is available, the Authenticate method
// should return nil without any errors.
type Authenticator interface {
	Name() string
	Authenticate(ctx context.Context, p Provider) (Claims, error)
}

type Authentication interface {
	// Authenticator returns the name of the Authenticator that authenticated
	// the request.
	Authenticator() string
	// Claims returns the claims of the authenticated request, as returned by
	// the Authenticator.
	Claims() Claims
	// SetScopes sets the scopes of the authenticated request. It will replace the scopes already parsed from the claims.
	// If users desire to append the scopes, they can first run `Scopes` to get the current scopes, and then append the new scopes
	SetScopes(scopes []string)
	// Scopes returns the scopes of the authenticated request, as returned by
	// the Authenticator.
	Scopes() []string
}

type authentication struct {
	authenticator string
	claims        Claims
}

func (a *authentication) Authenticator() string {
	return a.authenticator
}

func (a *authentication) Claims() Claims {
	if a == nil {
		return nil
	}
	return a.claims
}

func (a *authentication) SetScopes(scopes []string) {
	if a == nil {
		return
	}
	if a.claims == nil {
		a.claims = make(Claims)
	}
	// per https://datatracker.ietf.org/doc/html/rfc8693#section-2.1-4.8, scopes should be space separated
	a.claims["scope"] = strings.Join(scopes, " ")
}

func (a *authentication) Scopes() []string {
	if a == nil {
		return nil
	}
	scopes, ok := a.claims["scope"].(string)
	if !ok {
		return nil
	}
	return strings.Split(scopes, " ")
}

var errUnacceptableAud = errors.New("audience match not found")

// Authenticate tries to authenticate the given Provider using the given authenticators. If any of
// the authenticators succeeds, the Authentication result is returned with no error. If the Provider
// has no authentication information, the Authentication result is nil with no error. If the authentication
// information is present but some or all of the authenticators fail to validate it, then a non-nil error
// will be produced.
func Authenticate(ctx context.Context, authenticators []Authenticator, p Provider) (Authentication, error) {
	var joinedErrors error
	for _, auth := range authenticators {
		claims, err := auth.Authenticate(ctx, p)
		if err != nil {
			// If authentication fails for one provider, we try the
			// rest before returning an error.
			joinedErrors = errors.Join(joinedErrors, err)
			continue
		}

		// Claims is nil when no authentication information matched the authenticator.
		// In that case, we continue to the next authenticator.
		if claims == nil {
			continue
		}

		// If authentication succeeds, we return the authentication for the first provider.
		return &authentication{
			authenticator: auth.Name(),
			claims:        claims,
		}, nil
	}
	// If no authentication failed error will be nil here,
	// even if to claims were found.
	return nil, joinedErrors
}

func NewEmptyAuthentication() Authentication {
	return &authentication{}
}
