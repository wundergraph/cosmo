package authentication

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultHeaderName        = "Authorization"
	defaultHeaderValuePrefix = "Bearer"
)

type jwksAuthenticator struct {
	// JSON Web Key Set, automatically updated in the background
	// by keyfunc.
	jwks                *keyfunc.JWKS
	name                string
	headerNames         []string
	headerValuePrefixes []string
}

func (a *jwksAuthenticator) Name() string {
	return a.name
}

func (a *jwksAuthenticator) Authenticate(ctx context.Context, p Provider) (Claims, error) {
	headers := p.AuthenticationHeaders()
	var errs error
	for _, header := range a.headerNames {
		authorization := headers.Get(header)
		for _, prefix := range a.headerValuePrefixes {
			if strings.HasPrefix(authorization, prefix) {
				tokenString := strings.TrimSpace(authorization[len(prefix):])
				token, err := jwt.Parse(tokenString, a.jwks.Keyfunc)
				if err != nil {
					errs = errors.Join(errs, fmt.Errorf("could not validate token: %w", err))
					continue
				}
				claims := token.Claims.(jwt.MapClaims)
				return Claims(claims), nil
			}
		}
	}
	return nil, errs
}

// JWKSAuthenticatorOptions contains the available options for the JWKS authenticator
type JWKSAuthenticatorOptions struct {
	// Name is the authenticator name. It cannot be empty.
	Name string
	// URL is the URL of the JWKS endpoint, it is mandatory.
	URL string
	// HeaderNames are the header names to use for retrieving the token. It defaults to
	// Authorization
	HeaderNames []string
	// HeaderValuePrefixes are the prefixes to use for retrieving the token. It defaults to
	// Bearer
	HeaderValuePrefixes []string
	// RefreshInterval is the minimum time interval between two JWKS refreshes. It
	// defaults to 1 minute.
	RefreshInterval time.Duration
}

// NewJWKSAuthenticator returns a JWKS based authenticator. See JWKSAuthenticatorOptions
// for the available options.
func NewJWKSAuthenticator(opts JWKSAuthenticatorOptions) (Authenticator, error) {
	if opts.Name == "" {
		return nil, fmt.Errorf("authenticator Name must be provided")
	}
	jwks, err := keyfunc.Get(opts.URL, keyfunc.Options{
		RefreshInterval: opts.RefreshInterval,
	})
	if err != nil {
		return nil, fmt.Errorf("error initializing JWKS from %q: %w", opts.URL, err)
	}

	headerNames := opts.HeaderNames
	if len(headerNames) == 0 {
		headerNames = []string{defaultHeaderName}
	}
	headerValuePrefixes := opts.HeaderValuePrefixes
	if len(headerValuePrefixes) == 0 {
		headerValuePrefixes = []string{defaultHeaderValuePrefix}
	}

	return &jwksAuthenticator{
		jwks:                jwks,
		name:                opts.Name,
		headerNames:         headerNames,
		headerValuePrefixes: headerValuePrefixes,
	}, nil
}
