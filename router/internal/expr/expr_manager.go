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
	VisitorManager *visitorGroup
}

func CreateNewExprManager() *Manager {
	return &Manager{
		VisitorManager: createVisitorMGroup(),
	}
}

// CompileExpression compiles an expression and returns the program for the specific type.
// The exprContext is used to provide the context for the expression evaluation. Not safe for concurrent use.
func (c *Manager) CompileExpression(exprString string, kind reflect.Kind, context ExpressionContext, visitors ...ast.Visitor) (*vm.Program, error) {
	options := mergeOptions(expr.AsKind(kind), context, visitors)
	return c.compileExpressionWithExprOptions(options, exprString)
}

// CompileAnyExpression compiles an expression and returns the program for any type.
// The exprContext is used to provide the context for the expression evaluation. Not safe for concurrent use.
func (c *Manager) CompileAnyExpression(exprString string, context ExpressionContext, visitors ...ast.Visitor) (*vm.Program, error) {
	// We need a separate api for any expressions as it does not have an associated reflect.Kind
	options := mergeOptions(expr.AsAny(), context, visitors)
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
	options := make([]expr.Option, 0)
	options = append(options, extra...)

	for _, visitor := range c.VisitorManager.globalVisitors {
		options = append(options, expr.Patch(visitor))
	}
	return options
}

func mergeOptions(typeOption expr.Option, context ExpressionContext, visitors []ast.Visitor) []expr.Option {
	compilationOptions := []expr.Option{
		typeOption,
		expr.Env(context),
	}

	for _, visitor := range visitors {
		compilationOptions = append(compilationOptions, expr.Patch(visitor))
	}

	return compilationOptions
}

// ValidateAnyExpression compiles the expression to ensure that the expression itself is valid but more
// importantly it checks if the return type is not nil and is an allowed return type
// this allows us to ensure that nil and return types such as func or channels are not returned
func (c *Manager) ValidateAnyExpression(s string, context Context) error {
	tree, err := parser.Parse(s)
	if err != nil {
		return handleExpressionError(err)
	}

	// Check if the expression is just a nil literal
	if _, ok := tree.Node.(*ast.NilNode); ok {
		return handleExpressionError(errors.New("disallowed nil"))
	}

	config := conf.CreateNew()
	for _, op := range c.compileOptions(expr.Env(context)) {
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
