package expr

import (
	"errors"
	"fmt"
	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/checker"
	"github.com/expr-lang/expr/conf"
	"github.com/expr-lang/expr/parser"
	"github.com/expr-lang/expr/vm"
	"reflect"
)

type Manager struct {
	VisitorManager *VisitorGroup
}

func CreateNewExprManager() *Manager {
	return &Manager{
		VisitorManager: createVisitorGroup(),
	}
}

// CompileExpression compiles an expression and returns the program for the specific type.
// The exprContext is used to provide the context for the expression evaluation. Not safe for concurrent use.
func (c *Manager) CompileExpression(exprString string, kind reflect.Kind, visitors ...ast.Visitor) (*vm.Program, error) {
	options := mergeOptions(expr.AsKind(kind), visitors)
	return c.compileExpressionWithExprOptions(options, exprString)
}

// CompileAnyExpression compiles an expression and returns the program for any type.
// The exprContext is used to provide the context for the expression evaluation. Not safe for concurrent use.
func (c *Manager) CompileAnyExpression(exprString string, visitors ...ast.Visitor) (*vm.Program, error) {
	// We need a separate api for any expressions as it does not have an associated reflect.Kind
	options := mergeOptions(expr.AsAny(), visitors)
	return c.compileExpressionWithExprOptions(options, exprString)
}

func (c *Manager) compileExpressionWithExprOptions(options []expr.Option, exprString string) (*vm.Program, error) {
	v, err := expr.Compile(exprString,
		c.compileOptions(options...)...,
	)
	if err != nil {
		return nil, handleExpressionError(err)
	}
	return v, nil
}

func (c *Manager) compileOptions(extra ...expr.Option) []expr.Option {
	options := []expr.Option{
		expr.Env(Context{}),
	}
	options = append(options, extra...)

	for _, visitor := range c.VisitorManager.globalVisitors {
		options = append(options, expr.Patch(visitor))
	}
	return options
}

func mergeOptions(typeOption expr.Option, visitors []ast.Visitor) []expr.Option {
	compilationOptions := []expr.Option{
		typeOption,
	}

	for _, visitor := range visitors {
		compilationOptions = append(compilationOptions, expr.Patch(visitor))
	}

	return compilationOptions
}

// ValidateAnyExpression compiles the expression to ensure that the expression itself is valid but more
// importantly it checks if the return type is not nil and is an allowed return type
// this allows us to ensure that nil and return types such as func or channels are not returned
func (c *Manager) ValidateAnyExpression(s string) error {
	tree, err := parser.Parse(s)
	if err != nil {
		return handleExpressionError(err)
	}

	// Check if the expression is just a nil literal
	if _, ok := tree.Node.(*ast.NilNode); ok {
		return handleExpressionError(errors.New("disallowed nil"))
	}

	config := conf.CreateNew()
	for _, op := range c.compileOptions() {
		op(config)
	}

	expectedType, err := checker.Check(tree, config)
	if err != nil {
		return handleExpressionError(err)
	}

	// Disallowed types
	switch expectedType.Kind() {
	case reflect.Invalid, reflect.Chan, reflect.Func:
		return handleExpressionError(fmt.Errorf("disallowed type: %s", expectedType.String()))
	}

	return nil
}
