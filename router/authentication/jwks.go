package authentication

import (
	"context"
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
	jwks              *keyfunc.JWKS
	name              string
	headerName        string
	headerValuePrefix string
}

func (a *jwksAuthenticator) Name() string {
	return a.name
}

func (a *jwksAuthenticator) Authenticate(ctx context.Context, p Provider) (Claims, error) {
	headers := p.AuthenticationHeaders()
	if len(headers) == 0 {
		return nil, nil
	}
	authorization := headers.Get(a.headerName)
	if !strings.HasPrefix(authorization, a.headerValuePrefix) {
		return nil, nil
	}
	tokenString := strings.TrimSpace(authorization[len(a.headerValuePrefix):])
	token, err := jwt.Parse(tokenString, a.jwks.Keyfunc)
	if err != nil {
		return nil, fmt.Errorf("could not authenticate: %w", err)
	}
	claims := token.Claims.(jwt.MapClaims)
	return Claims(claims), nil
}

// JWKSAuthenticatorOptions contains the available options for the JWKS authenticator
type JWKSAuthenticatorOptions struct {
	// Name is the authenticator name. It cannot be empty.
	Name string
	// URL is the URL of the JWKS endpoint, it is mandatory.
	URL string
	// HeaderName is the header to use for retrieving the token. It defaults to
	// Authorization
	HeaderName string
	// HeaderValuePrefix is the prefix to use for retrieving the token. It defaults to
	// Bearer
	HeaderValuePrefix string
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

	headerName := opts.HeaderName
	if headerName == "" {
		headerName = defaultHeaderName
	}
	headerValuePrefix := opts.HeaderValuePrefix
	if headerValuePrefix == "" {
		headerValuePrefix = defaultHeaderValuePrefix
	}

	return &jwksAuthenticator{
		jwks:              jwks,
		name:              opts.Name,
		headerName:        headerName,
		headerValuePrefix: headerValuePrefix,
	}, nil
}
