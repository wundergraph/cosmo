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

// RequestIDMiddleware adds a request ID to the request header
func RequestIDMiddleware(headerName, requestID string) Middleware {
	return func(req *http.Request) (*http.Request, error) {
		req.Header.Set(headerName, requestID)
		return req, nil
	}
}

// UserAgentMiddleware adds a user agent to the request
func UserAgentMiddleware(userAgent string) Middleware {
	return func(req *http.Request) (*http.Request, error) {
		req.Header.Set("User-Agent", userAgent)
		return req, nil
	}
}
