package expr

import (
	"fmt"
	"reflect"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
)

// RetryExpressionManager handles compilation and evaluation of retry expressions
type RetryExpressionManager struct {
	program *vm.Program
}

// NewRetryExpressionManager creates a new RetryExpressionManager with the given expression
func NewRetryExpressionManager(expression string) (*RetryExpressionManager, error) {
	if expression == "" {
		return nil, nil
	}

	// Compile the expression with retry context
	options := []expr.Option{
		expr.Env(RetryContext{}),
		expr.AsKind(reflect.Bool),
	}

	program, err := expr.Compile(expression, options...)
	if err != nil {
		return nil, fmt.Errorf("failed to compile retry expression: %w", handleExpressionError(err))
	}

	return &RetryExpressionManager{
		program: program,
	}, nil
}

// ShouldRetry evaluates the retry expression with the given context
func (m *RetryExpressionManager) ShouldRetry(ctx RetryContext) (bool, error) {
	if m == nil || m.program == nil {
		// Use default behavior if no expression is configured
		return false, nil
	}

	result, err := expr.Run(m.program, ctx)
	if err != nil {
		return false, fmt.Errorf("failed to evaluate retry expression: %w", handleExpressionError(err))
	}

	shouldRetry, ok := result.(bool)
	if !ok {
		return false, fmt.Errorf("retry expression must return a boolean, got %T", result)
	}

	return shouldRetry, nil
}
