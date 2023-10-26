package authentication

import (
	"context"
	"net/http"
)

type httpRequestProvider http.Request

func (a httpRequestProvider) AuthenticationHeaders() http.Header {
	return a.Header
}

// AuthenticateHTTPRequest is a convenience function that calls Authenticate
// when the authentication information is provided by an *http.Request
func AuthenticateHTTPRequest(ctx context.Context, authenticators []Authenticator, r *http.Request) (Authentication, error) {
	provider := (*httpRequestProvider)(r)
	return Authenticate(ctx, authenticators, provider)
}
