package core

import (
	"errors"
	"io"
	"net/http"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"go.uber.org/zap"
)

// Helper functions for creating proper request contexts

func createOperationContext(opType string) *operationContext {
	return &operationContext{
		name:    "TestOperation",
		opType:  opType,
		hash:    12345,
		content: "test content",
	}
}

func createRequestWithContext(opType string) (*http.Request, *requestContext) {
	req, _ := http.NewRequest("POST", "http://example.com/graphql", nil)
	logger := zap.NewNop()

	// Create operation context
	operationCtx := createOperationContext(opType)

	// Create request context using the buildRequestContext function
	reqCtx := buildRequestContext(requestContextOptions{
		operationContext: operationCtx,
		requestLogger:    logger,
		metricsEnabled:   false,
		traceEnabled:     false,
		mapper:           &attributeMapper{},
		w:                nil,
		r:                req,
	})

	// Attach the request context to the Go context
	ctx := withRequestContext(req.Context(), reqCtx)
	req = req.WithContext(ctx)

	return req, reqCtx
}

func TestBuildRetryFunction(t *testing.T) {
	t.Run("build function when retry is disabled", func(t *testing.T) {
		manager := expr.NewRetryExpressionManager()
		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)
	})

	t.Run("default expression behavior", func(t *testing.T) {
		// Use the default expression that would be in the config
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression("")
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test default behavior - should retry on 500
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp, ""))

		// Should not retry on 200
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp, ""))

		// Test with errors - only expression-defined errors are handled here
		assert.True(t, fn(syscall.ETIMEDOUT, req, nil, ""))
		assert.True(t, fn(errors.New("connection refused"), req, nil, ""))
		assert.True(t, fn(errors.New("unexpected EOF"), req, nil, "")) // EOF is now handled at transport layer, not expression
		assert.False(t, fn(errors.New("some other error"), req, nil, ""))
	})

	t.Run("expression-based retry", func(t *testing.T) {
		expression := "statusCode == 500 || statusCode == 503"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Should retry on 500
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp, expression))

		// Should retry on 503
		resp.StatusCode = 503
		assert.True(t, fn(nil, req, resp, expression))

		// Should not retry on 502
		resp.StatusCode = 502
		assert.False(t, fn(nil, req, resp, expression))
	})

	t.Run("expression with error conditions", func(t *testing.T) {
		expression := "IsTimeout() || statusCode == 503"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Should retry on timeout error
		err = syscall.ETIMEDOUT
		assert.True(t, fn(err, req, nil, expression))

		// Should retry on 503
		resp := &http.Response{StatusCode: 503}
		assert.True(t, fn(nil, req, resp, expression))

		// Should not retry on other errors
		err = errors.New("some other error")
		assert.False(t, fn(err, req, nil, expression))
	})

	t.Run("invalid expression returns error", func(t *testing.T) {
		expression := "invalid syntax +++"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to compile retry expression")
	})

	t.Run("empty expression uses default", func(t *testing.T) {
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression("")
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test with retryable status code
		resp := &http.Response{StatusCode: 502}
		assert.True(t, fn(nil, req, resp, ""))

		// Test with connection error
		err = errors.New("connection refused")
		assert.True(t, fn(err, req, nil, ""))

		// Test with timeout error
		err = syscall.ETIMEDOUT
		assert.True(t, fn(err, req, nil, ""))

		// Test with non-retryable error
		err = errors.New("some other error")
		assert.False(t, fn(err, req, nil, ""))
	})

	t.Run("expression that always returns false but the error is an eof error", func(t *testing.T) {
		expression := "false" // Don't retry
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		assert.True(t, fn(io.ErrUnexpectedEOF, req, nil, expression))
	})

	t.Run("expression that always returns true", func(t *testing.T) {
		expression := "true" // Always retry
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)
		resp := &http.Response{StatusCode: 500}

		// Should retry when expression is true
		assert.True(t, fn(nil, req, resp, expression))

		// Even for status codes that wouldn't normally retry
		resp.StatusCode = 200
		assert.True(t, fn(nil, req, resp, expression))
	})

	t.Run("complex expression", func(t *testing.T) {
		expression := "(statusCode >= 500 && statusCode < 600) || IsConnectionError()"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test 5xx errors
		resp := &http.Response{StatusCode: 503}
		assert.True(t, fn(nil, req, resp, expression))

		// Test connection error
		err = errors.New("connection refused")
		assert.True(t, fn(err, req, nil, expression))

		// Test non-matching conditions
		resp.StatusCode = 404
		err = errors.New("some other error")
		assert.False(t, fn(err, req, resp, expression))
	})

	t.Run("mutation never retries with proper context", func(t *testing.T) {
		// Use expression that would normally retry on 500 errors
		expression := "statusCode >= 500 || IsTimeout() || IsConnectionError()"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with mutation context
		req, _ := createRequestWithContext(OperationTypeMutation)

		// Test with 500 status - should NOT retry because it's a mutation
		resp := &http.Response{StatusCode: 500}
		assert.False(t, fn(nil, req, resp, expression))

		// Test with timeout error - should NOT retry because it's a mutation
		assert.False(t, fn(syscall.ETIMEDOUT, req, nil, expression))

		// Test with connection error - should NOT retry because it's a mutation
		assert.False(t, fn(errors.New("connection refused"), req, nil, expression))

		// Test with expression that always returns true - should still NOT retry
		alwaysRetryExpression := "true"
		err = manager.AddExpression(alwaysRetryExpression)
		assert.NoError(t, err)
		assert.False(t, fn(nil, req, resp, alwaysRetryExpression))
	})

	t.Run("query retries with proper context", func(t *testing.T) {
		expression := "statusCode >= 500 || IsTimeout()"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test with 500 status - should retry because it's a query
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp, expression))

		// Test with timeout error - should retry because it's a query
		assert.True(t, fn(syscall.ETIMEDOUT, req, nil, expression))

		// Test with 200 status - should not retry even for query
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp, expression))
	})

	t.Run("subscription retries with proper context", func(t *testing.T) {
		expression := "statusCode >= 500"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with subscription context
		req, _ := createRequestWithContext(OperationTypeSubscription)

		// Test with 500 status - should retry because it's a subscription (not mutation)
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp, expression))

		// Test with 200 status - should not retry
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp, expression))
	})

	t.Run("error logging with proper context", func(t *testing.T) {
		// Test that error logging works with proper request context
		expression := "statusCode >= 500"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create request with proper context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test that it works normally with proper context
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp, expression))

		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp, expression))
	})

	t.Run("request context with query operation", func(t *testing.T) {
		expression := "statusCode >= 500"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create request with proper query context
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Should work with proper request context - expression should be evaluated normally
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp, expression))

		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp, expression))
	})

	t.Run("complex expression with mutation context", func(t *testing.T) {
		// Complex expression that would normally retry in many cases
		expression := "(statusCode >= 500 && statusCode < 600) || IsConnectionError() || IsTimeout() || statusCode == 429"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Create a request with mutation context
		req, _ := createRequestWithContext(OperationTypeMutation)

		// Test various conditions that would normally trigger retry
		resp := &http.Response{StatusCode: 500}
		assert.False(t, fn(nil, req, resp, expression))

		resp.StatusCode = 503
		assert.False(t, fn(nil, req, resp, expression))

		resp.StatusCode = 429
		assert.False(t, fn(nil, req, resp, expression))

		assert.False(t, fn(syscall.ETIMEDOUT, req, nil, expression))
		assert.False(t, fn(errors.New("connection refused"), req, nil, expression))
	})

	t.Run("new operation with comprehensive retry conditions", func(t *testing.T) {
		// Create a new comprehensive operation to test all retry scenarios
		expression := "statusCode >= 500 || statusCode == 429 || IsTimeout() || IsConnectionError()"
		manager := expr.NewRetryExpressionManager()
		err := manager.AddExpression(expression)
		assert.NoError(t, err)

		fn, err := BuildRetryFunction(manager)
		assert.NoError(t, err)
		assert.NotNil(t, fn)

		// Test query operation - should retry on all conditions
		req, _ := createRequestWithContext(OperationTypeQuery)

		// Test 5xx errors
		resp := &http.Response{StatusCode: 500}
		assert.True(t, fn(nil, req, resp, expression))
		resp.StatusCode = 503
		assert.True(t, fn(nil, req, resp, expression))

		// Test rate limiting
		resp.StatusCode = 429
		assert.True(t, fn(nil, req, resp, expression))

		// Test timeouts
		assert.True(t, fn(syscall.ETIMEDOUT, req, nil, expression))

		// Test connection errors
		assert.True(t, fn(errors.New("connection refused"), req, nil, expression))

		// Test success - should not retry
		resp.StatusCode = 200
		assert.False(t, fn(nil, req, resp, expression))

		// Test client errors - should not retry
		resp.StatusCode = 404
		assert.False(t, fn(nil, req, resp, expression))

		// Now test the same conditions with a mutation - should never retry
		mutationReq, _ := createRequestWithContext(OperationTypeMutation)

		resp.StatusCode = 500
		assert.False(t, fn(nil, mutationReq, resp, expression))
		resp.StatusCode = 503
		assert.False(t, fn(nil, mutationReq, resp, expression))
		resp.StatusCode = 429
		assert.False(t, fn(nil, mutationReq, resp, expression))
		assert.False(t, fn(syscall.ETIMEDOUT, mutationReq, nil, expression))
		assert.False(t, fn(errors.New("connection refused"), mutationReq, nil, expression))
	})
}
