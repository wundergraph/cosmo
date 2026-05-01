package httpclient

import (
	"context"
	"errors"
	"net/http"
)

// IsCDNFallbackEligible returns true if the error or response indicates a
// server-side failure that warrants retrying against a fallback CDN URL.
// It returns true for HTTP 5xx, 429, and network errors.
// It returns false for client errors (401, 400, 404), context cancellation,
// and context deadline exceeded.
func IsCDNFallbackEligible(resp *http.Response, err error) bool {
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return false
		}
		// If we have a response, use the status code to decide
		if resp != nil {
			return isServerErrorStatus(resp.StatusCode)
		}
		// No response means network error → fallback
		return true
	}
	if resp != nil {
		return isServerErrorStatus(resp.StatusCode)
	}
	return false
}

func isServerErrorStatus(statusCode int) bool {
	return statusCode >= 500 || statusCode == http.StatusTooManyRequests
}
