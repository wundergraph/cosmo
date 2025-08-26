package expr

import (
	"errors"
	"net"
	"net/http"
	"os"
	"strings"
	"syscall"
)

// RetryContext is the context for retry expressions
type RetryContext struct {
	StatusCode int    `expr:"statusCode"`
	Error      string `expr:"error"`
	// originalError stores the original error for proper type checking
	// This field is not exposed to expressions
	originalError error
}

// IsHttpReadTimeout returns true if the error is an HTTP-specific timeout
// waiting for response headers from the server.
func (ctx RetryContext) IsHttpReadTimeout() bool {
	// Only check for HTTP-specific timeout awaiting response headers
	if ctx.Error != "" {
		errLower := strings.ToLower(ctx.Error)
		return strings.Contains(errLower, "timeout awaiting response headers")
	}

	return false
}

// IsTimeout returns true if the error is any type of timeout error,
// including HTTP read timeouts, network timeouts, deadline exceeded errors,
// or direct syscall timeout errors.
func (ctx RetryContext) IsTimeout() bool {
	// Check for HTTP-specific read timeouts
	if ctx.IsHttpReadTimeout() {
		return true
	}

	// Check for net package timeout errors using the standard Go method
	if ctx.originalError != nil {
		if netErr, ok := ctx.originalError.(net.Error); ok && netErr.Timeout() {
			return true
		}
		// Check for deadline exceeded errors
		if errors.Is(ctx.originalError, os.ErrDeadlineExceeded) {
			return true
		}
		// Also check for direct syscall timeout errors not wrapped in net.Error
		if errors.Is(ctx.originalError, syscall.ETIMEDOUT) {
			return true
		}
	}

	return false
}

// IsConnectionError returns true if the error is a connection-related error,
// including connection refused, connection reset, DNS resolution failures,
// or TLS handshake errors.
func (ctx RetryContext) IsConnectionError() bool {
	// Use existing helpers for specific connection errors
	if ctx.IsConnectionRefused() || ctx.IsConnectionReset() {
		return true
	}

	// Fall back to string matching for other connection errors not covered by specific helpers
	if ctx.Error != "" {
		errLower := strings.ToLower(ctx.Error)
		return strings.Contains(errLower, "no such host") ||
			strings.Contains(errLower, "handshake failure") ||
			strings.Contains(errLower, "handshake timeout")
	}

	return false
}

// Is5xxError returns true if the HTTP status code is in the 5xx range,
// indicating a server error.
func (ctx RetryContext) Is5xxError() bool {
	return ctx.StatusCode >= 500 && ctx.StatusCode < 600
}

// IsRetryableStatusCode returns true if the HTTP status code is generally
// considered retryable, including 500, 502, 503, and 504.
func (ctx RetryContext) IsRetryableStatusCode() bool {
	switch ctx.StatusCode {
	case http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

// IsConnectionRefused returns true if the error is specifically a connection
// refused error (ECONNREFUSED), either through direct syscall error checking
// or string matching.
func (ctx RetryContext) IsConnectionRefused() bool {
	if ctx.originalError != nil && errors.Is(ctx.originalError, syscall.ECONNREFUSED) {
		return true
	}

	// Fall back to string matching
	if ctx.Error != "" {
		errLower := strings.ToLower(ctx.Error)
		return strings.Contains(errLower, "connection refused")
	}

	return false
}

// IsConnectionReset returns true if the error is specifically a connection
// reset error (ECONNRESET), either through direct syscall error checking
// or string matching.
func (ctx RetryContext) IsConnectionReset() bool {
	if ctx.originalError != nil && errors.Is(ctx.originalError, syscall.ECONNRESET) {
		return true
	}

	// Fall back to string matching
	if ctx.Error != "" {
		errLower := strings.ToLower(ctx.Error)
		return strings.Contains(errLower, "connection reset")
	}

	return false
}

// LoadRetryContext creates a RetryContext from the given error and HTTP response.
// It extracts the error message and status code to make them available for
// retry condition evaluation in expressions.
func LoadRetryContext(err error, resp *http.Response) RetryContext {
	ctx := RetryContext{
		originalError: err,
	}

	if err != nil {
		ctx.Error = err.Error()
	}

	if resp != nil {
		ctx.StatusCode = resp.StatusCode
	}

	return ctx
}
