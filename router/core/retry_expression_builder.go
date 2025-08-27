package core

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"go.uber.org/zap"
)

const defaultRetryExpression = "IsRetryableStatusCode() || IsConnectionError() || IsTimeout()"

var noopRetryFunc = func(err error, req *http.Request, resp *http.Response) bool {
	return false
}

// BuildRetryFunction creates a ShouldRetry function based on the provided expression
func BuildRetryFunction(retryOpts retrytransport.RetryOptions) (retrytransport.ShouldRetryFunc, error) {
	// We do not need to build a retry function if retries are disabled
	// This means that any bad expressions are ignored if retries are disabled
	if !retryOpts.Enabled {
		return noopRetryFunc, nil
	}

	// Use default expression if empty string is passed
	expression := retryOpts.Expression
	if expression == "" {
		expression = defaultRetryExpression
	}

	// Create the retry expression manager
	manager, err := expr.NewRetryExpressionManager(expression)
	if err != nil {
		return nil, fmt.Errorf("failed to create expression manager: %w", err)
	}

	// Return expression-based retry function
	return func(err error, req *http.Request, resp *http.Response) bool {
		reqContext := getRequestContext(req.Context())

		if reqContext == nil {
			return false
		}

		// Never retry mutations, regardless of expression result
		if strings.ToLower(reqContext.Operation().Type()) == "mutation" {
			return false
		}

		if isDefaultRetryableError(err) {
			return true
		}

		// Create retry context
		ctx := expr.LoadRetryContext(err, resp)

		// Evaluate the expression
		shouldRetry, evalErr := manager.ShouldRetry(ctx)
		if evalErr != nil {
			reqContext.logger.Error("Failed to evaluate retry expression",
				zap.Error(evalErr),
				zap.String("expression", expression),
			)

			// Disable retries on evaluation error
			return false
		}

		return shouldRetry
	}, nil
}

// isDefaultRetryableError checks for errors that should always be retryable
// regardless of the configured retry expression
func isDefaultRetryableError(err error) bool {
	if err == nil {
		return false
	}

	errStr := strings.ToLower(err.Error())
	// EOF errors are always retryable as they indicate connection issues
	return strings.Contains(errStr, "unexpected eof")
}
