package authentication

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type websocketInitialPayloadAuthenticator struct {
	tokenDecoder        tokenDecoder
	secretKey           string
	name                string
	headerValuePrefixes []string
}

func (a *websocketInitialPayloadAuthenticator) Name() string {
	return a.name
}

func (a *websocketInitialPayloadAuthenticator) Authenticate(ctx context.Context, p Provider) (Claims, error) {
	initialPayload := WebsocketInitialPayloadFromContext(ctx)
	if initialPayload == nil {
		return nil, nil
	}

	var initialPayloadMap map[string]interface{}
	json.Unmarshal(initialPayload, &initialPayloadMap)
	secretKey := strings.ToLower(a.secretKey)
	for key, tokenString := range initialPayloadMap {
		if strings.ToLower(key) == secretKey {
			authorization := tokenString.(string)
			for _, prefix := range a.headerValuePrefixes {
				if strings.HasPrefix(authorization, prefix) {
					authorization := strings.TrimSpace(authorization[len(prefix):])
					return a.tokenDecoder.Decode(authorization)
				}
			}
		}
	}
	return nil, nil
}

// HttpHeaderAuthenticatorOptions contains the available options for the HttpHeader authenticator
type WebsocketInitialPayloadAuthenticatorOptions struct {
	// TokenDecoder is the token decoder to use for decoding the token.
	TokenDecoder tokenDecoder
	// SecretKey is the key in the initial payload that contains the token.
	SecretKey string
	// HeaderValuePrefixes are the prefixes to use for retrieving the token. It defaults to
	// Bearer
	HeaderValuePrefixes []string
}

// NewWebsocketInitialPayloadAuthenticator returns a HttpHeader based authenticator. See HttpHeaderAuthenticatorOptions
// for the available options.
func NewWebsocketInitialPayloadAuthenticator(opts WebsocketInitialPayloadAuthenticatorOptions) (Authenticator, error) {
	if opts.SecretKey == "" {
		return nil, fmt.Errorf("secret key must be provided")
	}

	if opts.TokenDecoder == nil {
		return nil, fmt.Errorf("token decoder must be provided")
	}

	return &websocketInitialPayloadAuthenticator{
		tokenDecoder:        opts.TokenDecoder,
		name:                "websocket-initial-payload",
		secretKey:           opts.SecretKey,
		headerValuePrefixes: opts.HeaderValuePrefixes,
	}, nil
}
