package authentication

import "context"

type authenticationKey string

const (
	contextAuthenticationKey = authenticationKey("authentication")
)

// NewContext returns a new context.Context with the given Authentication attached
func NewContext(ctx context.Context, auth Authentication) context.Context {
	return context.WithValue(ctx, contextAuthenticationKey, auth)
}

// FromContext returns the Authentication attached to the given context.Context,
// or nil if there's none.
func FromContext(ctx context.Context) Authentication {
	val := ctx.Value(contextAuthenticationKey)
	auth, ok := val.(Authentication)
	if ok {
		return auth
	}
	return nil
}
