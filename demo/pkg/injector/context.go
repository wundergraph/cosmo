package injector

import (
	"context"
	"net/http"

	"github.com/99designs/gqlgen/graphql/handler/transport"
)

type contextKey string

const (
	headerKey  contextKey = "header"
	payloadKey contextKey = "payload"
)

func NewContextWithHeader(ctx context.Context, hdr http.Header) context.Context {
	return context.WithValue(ctx, headerKey, hdr)
}

func NewContextWithInitPayload(ctx context.Context, initPayload transport.InitPayload) context.Context {
	return context.WithValue(ctx, payloadKey, initPayload)
}

func Header(ctx context.Context) http.Header {
	hdr, _ := ctx.Value(headerKey).(http.Header)
	return hdr
}

func InitPayload(ctx context.Context) transport.InitPayload {
	payload, _ := ctx.Value(payloadKey).(transport.InitPayload)
	return payload
}
