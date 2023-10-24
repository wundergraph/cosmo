package authentication

import (
	"context"
	"net/http"
)

type Authorization interface {
	Authorization() string
}

type Authenticator interface {
	Authenticate(ctx context.Context, auth Authorization) (bool, error)
}

type httpAuthorization http.Request

func (a httpAuthorization) Authorization() string {
	return a.Header.Get("Authorization")
}

func AuthenticateHTTPRequest(ctx context.Context, authenticator Authenticator, r *http.Request) (bool, error) {
	return authenticator.Authenticate(ctx, (*httpAuthorization)(r))
}
