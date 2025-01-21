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
	tokenDecoder    TokenDecoder
	name            string
	headerSourceMap map[string][]string
}

func (a *httpHeaderAuthenticator) Name() string {
	return a.name
}

func (a *httpHeaderAuthenticator) Authenticate(ctx context.Context, p Provider) (Claims, error) {
	headers := p.AuthenticationHeaders()
	var errs error

	for header, prefixes := range a.headerSourceMap {
		authorization := headers.Get(header)

		if len(prefixes) == 0 {
			prefixes = []string{""}
		}

		for _, prefix := range prefixes {
			tokenString := authorization
			if prefix != "" {
				if !strings.HasPrefix(authorization, prefix) {
					continue
				}

				tokenString = strings.TrimSpace(authorization[len(prefix):])
			}

			claims, err := a.tokenDecoder.Decode(tokenString)
			if err != nil {
				errs = errors.Join(errs, fmt.Errorf("could not validate token: %w", err))
				continue
			}
			// If claims is nil, we should return an empty Claims map to signal that the
			// authentication was successful, but no claims were found.
			if claims == nil {
				claims = make(Claims)
			}
			return claims, nil
		}
	}

	return nil, errs
}

// HttpHeaderAuthenticatorOptions contains the available options for the HttpHeader authenticator
type HttpHeaderAuthenticatorOptions struct {
	// Name is the authenticator name. It cannot be empty.
	Name string
	// HeaderSourcePrefixes are the headers and their prefixes to use for retrieving the token.
	// It defaults to Authorization and Bearer
	HeaderSourcePrefixes map[string][]string
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

	if len(opts.HeaderSourcePrefixes) == 0 {
		opts.HeaderSourcePrefixes = map[string][]string{
			defaultHeaderName: {defaultHeaderValuePrefix},
		}
	}

	return &httpHeaderAuthenticator{
		tokenDecoder:    opts.TokenDecoder,
		name:            opts.Name,
		headerSourceMap: opts.HeaderSourcePrefixes,
	}, nil
}
