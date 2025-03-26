package expr

import (
	"fmt"
	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
)

// ResolveAnyExpression evaluates the expression and returns the result as a any. The exprContext is used to
// provide the context for the expression evaluation. Not safe for concurrent use.
func ResolveAnyExpression(vm *vm.Program, ctx Context) (any, error) {
	r, err := expr.Run(vm, ctx)
	if err != nil {
		return "", handleExpressionError(err)
	}

	return r, nil
}

// ResolveStringExpression evaluates the expression and returns the result as a string. The exprContext is used to
// provide the context for the expression evaluation. Not safe for concurrent use.
func ResolveStringExpression(vm *vm.Program, ctx Context) (string, error) {
	r, err := expr.Run(vm, ctx)
	if err != nil {
		return "", handleExpressionError(err)
	}

	switch v := r.(type) {
	case string:
		return v, nil
	default:
		return "", fmt.Errorf("expected string, got %T", r)
	}
}

// ResolveBoolExpression evaluates the expression and returns the result as a bool. The exprContext is used to
// provide the context for the expression evaluation. Not safe for concurrent use.
func ResolveBoolExpression(vm *vm.Program, ctx Context) (bool, error) {
	if vm == nil {
		return false, nil
	}

	r, err := expr.Run(vm, ctx)
	if err != nil {
		return false, handleExpressionError(err)
	}

	switch v := r.(type) {
	case bool:
		return v, nil
	default:
		return false, fmt.Errorf("failed to run expression: expected bool, got %T", r)
	}
}
