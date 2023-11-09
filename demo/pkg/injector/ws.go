package injector

import (
	"context"

	"github.com/99designs/gqlgen/graphql/handler/transport"
)

func InitPayloadFunc(ctx context.Context, initPayload transport.InitPayload) (context.Context, *transport.InitPayload, error) {
	// If initPayload is nil, make it an empty map to allow resolvers
	// to detect if it was not properly injected
	ctx = NewContextWithInitPayload(ctx, initPayload)
	return ctx, &initPayload, nil
}
