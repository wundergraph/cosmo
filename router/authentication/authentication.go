package authentication

import (
	"context"
	"net/http"
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
}

type authentication struct {
	authenticator string
	claims        Claims
}

func (a *authentication) Authenticator() string {
	return a.authenticator
}

func (a *authentication) Claims() Claims {
	return a.claims
}

func Authenticate(ctx context.Context, authenticators []Authenticator, p Provider) (Authentication, error) {
	for _, auth := range authenticators {
		claims, err := auth.Authenticate(ctx, p)
		if err != nil {
			return nil, err
		}
		if claims != nil {
			return &authentication{
				authenticator: auth.Name(),
				claims:        claims,
			}, nil
		}
	}
	return nil, nil
}
