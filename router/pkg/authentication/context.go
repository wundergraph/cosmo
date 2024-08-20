package authentication

import (
	"context"

	"github.com/goccy/go-json"
)

type authenticationKey struct{}
type websocketInitialPayloadContextKey struct{}

// NewContext returns a new context.Context with the given Authentication attached
func NewContext(ctx context.Context, auth Authentication) context.Context {
	return context.WithValue(ctx, authenticationKey{}, auth)
}

// FromContext returns the Authentication attached to the given context.Context,
// or nil if there's none.
func FromContext(ctx context.Context) Authentication {
	val := ctx.Value(authenticationKey{})
	auth, ok := val.(Authentication)
	if ok {
		return auth
	}
	return nil
}

func WithWebsocketInitialPayloadContextKey(ctx context.Context, initialPayload json.RawMessage) context.Context {
	return context.WithValue(ctx, websocketInitialPayloadContextKey{}, initialPayload)
}

func WebsocketInitialPayloadFromContext(ctx context.Context) json.RawMessage {
	initialPayload, _ := ctx.Value(websocketInitialPayloadContextKey{}).(json.RawMessage)
	return initialPayload
}
