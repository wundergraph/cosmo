package authentication

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type websocketInitialPayloadAuthenticator struct {
	tokenDecoder        tokenDecoder
	key                 string
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
	secretKey := strings.ToLower(a.key)
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

// WebsocketInitialPayloadAuthenticatorOptions contains the available options for the InitialPayload authenticator
type WebsocketInitialPayloadAuthenticatorOptions struct {
	// TokenDecoder is the token decoder to use for decoding the token.
	TokenDecoder tokenDecoder
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
