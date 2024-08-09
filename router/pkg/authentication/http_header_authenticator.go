package authentication

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

const (
	defaultHeaderName        = "Authorization"
	defaultHeaderValuePrefix = "Bearer"
)

type httpHeaderAuthenticator struct {
	tokenDecoder        TokenDecoder
	name                string
	headerNames         []string
	headerValuePrefixes []string
}

func (a *httpHeaderAuthenticator) Close() {
	if a.tokenDecoder != nil {
		a.tokenDecoder.Close()
	}
}

func (a *httpHeaderAuthenticator) Name() string {
	return a.name
}

func (a *httpHeaderAuthenticator) Authenticate(ctx context.Context, p Provider) (Claims, error) {
	headers := p.AuthenticationHeaders()
	var errs error
	for _, header := range a.headerNames {
		authorization := headers.Get(header)
		for _, prefix := range a.headerValuePrefixes {
			if strings.HasPrefix(authorization, prefix) {
				tokenString := strings.TrimSpace(authorization[len(prefix):])
				claims, err := a.tokenDecoder.Decode(tokenString)
				if err != nil {
					errs = errors.Join(errs, fmt.Errorf("could not validate token: %w", err))
					continue
				}
				return claims, nil
			}
		}
	}
	return nil, errs
}

// HttpHeaderAuthenticatorOptions contains the available options for the HttpHeader authenticator
type HttpHeaderAuthenticatorOptions struct {
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
	// TokenDecoder is the token decoder to use for decoding the token. It cannot be nil.
	TokenDecoder TokenDecoder
}

// NewHttpHeaderAuthenticator returns a HttpHeader based authenticator. See HttpHeaderAuthenticatorOptions
// for the available options.
func NewHttpHeaderAuthenticator(opts HttpHeaderAuthenticatorOptions) (Authenticator, error) {
	if opts.Name == "" {
		return nil, fmt.Errorf("authenticator Name must be provided")
	}

	if opts.TokenDecoder == nil {
		return nil, fmt.Errorf("token decoder must be provided")
	}

	headerNames := opts.HeaderNames
	if len(headerNames) == 0 {
		headerNames = []string{defaultHeaderName}
	}
	headerValuePrefixes := opts.HeaderValuePrefixes
	if len(headerValuePrefixes) == 0 {
		headerValuePrefixes = []string{defaultHeaderValuePrefix}
	}

	return &httpHeaderAuthenticator{
		tokenDecoder:        opts.TokenDecoder,
		name:                opts.Name,
		headerNames:         headerNames,
		headerValuePrefixes: headerValuePrefixes,
	}, nil
}
