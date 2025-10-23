package httpclient

import (
	"net/http"
)

// AuthBearerMiddleware adds a Bearer token to the Authorization header
func AuthBearerMiddleware(token string) Middleware {
	return func(req *http.Request) (*http.Request, error) {
		req.Header.Set("Authorization", "Bearer "+token)
		return req, nil
	}
}

// BasicAuthMiddleware adds basic authentication to the request
func BasicAuthMiddleware(username, password string) Middleware {
	return func(req *http.Request) (*http.Request, error) {
		req.SetBasicAuth(username, password)
		return req, nil
	}
}
