package core

import (
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"go.uber.org/zap"
)

// BuildRetryFunction creates a ShouldRetry function based on the provided expression
func BuildRetryFunction(manager *expr.RetryExpressionManager) (retrytransport.ShouldRetryFunc, error) {
	return func(err error, req *http.Request, resp *http.Response, expression string) bool {
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
		shouldRetry, evalErr := manager.ShouldRetry(ctx, expression)
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
