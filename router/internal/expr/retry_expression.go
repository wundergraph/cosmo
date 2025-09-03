package expr

import (
	"fmt"
	"reflect"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
)

// RetryExpressionManager handles compilation and evaluation of retry expressions
type RetryExpressionManager struct {
	expressionMap map[string]*vm.Program
}

const defaultRetryExpression = "IsRetryableStatusCode() || IsConnectionError() || IsTimeout()"

// NewRetryExpressionManager creates a new RetryExpressionManager
func NewRetryExpressionManager() *RetryExpressionManager {
	return &RetryExpressionManager{
		expressionMap: make(map[string]*vm.Program),
	}
}

func (c *RetryExpressionManager) AddExpression(exprString string) error {
	expression := exprString
	if expression == "" {
		expression = defaultRetryExpression
	}

	// The expression has already been processed, skip recompilation
	if _, ok := c.expressionMap[expression]; ok {
		return nil
	}

	// Compile the expression with retry context
	options := []expr.Option{
		expr.Env(RetryContext{}),
		expr.AsKind(reflect.Bool),
	}

	program, err := expr.Compile(expression, options...)
	if err != nil {
		return fmt.Errorf("failed to compile retry expression: %w", handleExpressionError(err))
	}

	// Use the normalized expression string as the key for deduplication
	c.expressionMap[expression] = program
	return nil
}

// ShouldRetry evaluates the retry expression with the given context
func (m *RetryExpressionManager) ShouldRetry(ctx RetryContext, expressionString string) (bool, error) {
	if m == nil {
		return false, nil
	}

	expression := expressionString
	if expression == "" {
		expression = defaultRetryExpression
	}

	program, ok := m.expressionMap[expression]
	if !ok {
		// If the expression wasn't pre-compiled, do not retry by default
		return false, nil
	}

	result, err := expr.Run(program, ctx)
	if err != nil {
		return false, fmt.Errorf("failed to evaluate retry expression: %w", handleExpressionError(err))
	}

	shouldRetry, ok := result.(bool)
	if !ok {
		return false, fmt.Errorf("retry expression must return a boolean, got %T", result)
	}

	return shouldRetry, nil
}
