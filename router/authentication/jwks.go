package authentication

import (
	"context"
	"fmt"
	"strings"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/golang-jwt/jwt/v5"
)

const (
	bearerPrefix = "Bearer "
)

type jwksAuthenticator struct {
	// JSON Web Key Set, automatically updated in the background
	// by keyfunc.
	jwks *keyfunc.JWKS
}

func (a *jwksAuthenticator) Authenticate(ctx context.Context, auth Authorization) (bool, error) {
	authorization := auth.Authorization()
	if !strings.HasPrefix(authorization, bearerPrefix) {
		return false, nil
	}
	_, err := jwt.Parse(authorization[len(bearerPrefix):], a.jwks.Keyfunc)
	if err != nil {
		return false, fmt.Errorf("could not authenticate: %w", err)
	}
	return true, nil
}

func NewJWKSAuthenticator(URL string) (Authenticator, error) {
	jwks, err := keyfunc.Get(URL, keyfunc.Options{})
	if err != nil {
		return nil, fmt.Errorf("error initializing JWKS from %q: %w", URL, err)
	}
	return &jwksAuthenticator{jwks: jwks}, nil
}
