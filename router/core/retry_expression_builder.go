package core

import (
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"go.uber.org/zap"
)

const DefaultRetryExpression = "IsRetryableStatusCode() || IsConnectionError() || IsTimeout()"

// BuildRetryFunction creates a ShouldRetry function based on the provided expression
func BuildRetryFunction(expression string) (retrytransport.ShouldRetryFunc, error) {
	// Use default expression if empty string is passed
	if expression == "" {
		expression = DefaultRetryExpression
	}

	// Create the retry expression manager
	manager, err := expr.NewRetryExpressionManager(expression)
	if err != nil {
		return nil, fmt.Errorf("failed to compile retry expression: %w", err)
	}

	// Return expression-based retry function
	return func(err error, req *http.Request, resp *http.Response) bool {
		reqContext := getRequestContext(req.Context())

		if reqContext == nil {
			return false
		}

		// Never retry mutations, regardless of expression result
		if reqContext.Operation().Type() == "mutation" {
			return false
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
