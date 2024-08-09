package authentication

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/goccy/go-json"
)

type websocketInitialPayloadAuthenticator struct {
	tokenDecoder        TokenDecoder
	key                 string
	name                string
	headerValuePrefixes []string
}

func (a *websocketInitialPayloadAuthenticator) Close() {
	if a.tokenDecoder != nil {
		a.tokenDecoder.Close()
	}
}

func (a *websocketInitialPayloadAuthenticator) Name() string {
	return a.name
}

func (a *websocketInitialPayloadAuthenticator) Authenticate(ctx context.Context, p Provider) (Claims, error) {
	initialPayload := WebsocketInitialPayloadFromContext(ctx)
	var errs error
	if initialPayload == nil {
		errs = errors.Join(errs, fmt.Errorf("could not validate token, initial payload is empty"))
		return nil, errs
	}

	var initialPayloadMap map[string]interface{}
	err := json.Unmarshal(initialPayload, &initialPayloadMap)
	if err != nil {
		errs = errors.Join(errs, fmt.Errorf("error parsing initial payload: %v", err))
		return nil, errs
	}
	secretKey := strings.ToLower(a.key)
	for key, tokenString := range initialPayloadMap {
		if strings.ToLower(key) == secretKey {
			authorization, ok := tokenString.(string)
			if !ok {
				errs = errors.Join(errs, fmt.Errorf("JWT token is not a string"))
				continue
			}
			for _, prefix := range a.headerValuePrefixes {
				if strings.HasPrefix(authorization, prefix) {
					authorization := strings.TrimSpace(authorization[len(prefix):])
					claims, err := a.tokenDecoder.Decode(authorization)
					if err != nil {
						errs = errors.Join(errs, fmt.Errorf("could not validate token: %w", err))
						continue
					}
					return claims, nil
				}
			}
		}
	}
	return nil, errs
}

// WebsocketInitialPayloadAuthenticatorOptions contains the available options for the InitialPayload authenticator
type WebsocketInitialPayloadAuthenticatorOptions struct {
	// TokenDecoder is the token decoder to use for decoding the token.
	TokenDecoder TokenDecoder
	// Key represents the property name in the initial payload that contains the token.
	Key string
	// HeaderValuePrefixes are the prefixes to use for retrieving the token. It defaults to
	// Bearer
	HeaderValuePrefixes []string
}

// NewWebsocketInitialPayloadAuthenticator returns an InitialPayload based authenticator. See WebsocketInitialPayloadAuthenticatorOptions
// for the available options.
func NewWebsocketInitialPayloadAuthenticator(opts WebsocketInitialPayloadAuthenticatorOptions) (Authenticator, error) {
	if opts.Key == "" {
		return nil, fmt.Errorf("secret key must be provided")
	}

	if opts.TokenDecoder == nil {
		return nil, fmt.Errorf("token decoder must be provided")
	}

	headerValuePrefixes := opts.HeaderValuePrefixes
	if len(headerValuePrefixes) == 0 {
		headerValuePrefixes = []string{defaultHeaderValuePrefix}
	}
	return &websocketInitialPayloadAuthenticator{
		tokenDecoder:        opts.TokenDecoder,
		name:                "websocket-initial-payload",
		key:                 opts.Key,
		headerValuePrefixes: headerValuePrefixes,
	}, nil
}
