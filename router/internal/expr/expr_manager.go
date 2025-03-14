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

type visitorKind uint

const (
	usesBodyKey visitorKind = iota
)

type ExprManager struct {
	globalVisitors map[visitorKind]ast.Visitor
}

func CreateNewExprManager() *ExprManager {
	return &ExprManager{
		globalVisitors: map[visitorKind]ast.Visitor{
			usesBodyKey: &UsesBody{},
		},
	}
}

// CompileExpression compiles an expression and returns the program.
// The exprContext is used to provide the context for the expression evaluation. Not safe for concurrent use.
func (c *ExprManager) CompileExpression(s string, kind reflect.Kind, visitors ...ast.Visitor) (*vm.Program, error) {
	options := mergeOptions(expr.AsKind(kind), visitors)
	v, err := expr.Compile(s,
		c.compileOptions(options...)...,
	)
	if err != nil {
		return nil, handleExpressionError(err)
	}
	return v, nil
}

func (c *ExprManager) CompileAnyExpression(s string, visitors ...ast.Visitor) (*vm.Program, error) {
	options := mergeOptions(expr.AsAny(), visitors)
	v, err := expr.Compile(s,
		c.compileOptions(options...)...,
	)
	if err != nil {
		return nil, handleExpressionError(err)
	}
	return v, nil
}

func (c *ExprManager) compileOptions(extra ...expr.Option) []expr.Option {
	options := []expr.Option{
		expr.Env(Context{}),
	}

	options = append(options, extra...)

	for _, visitor := range c.globalVisitors {
		options = append(options, expr.Patch(visitor))
	}

	return options
}

// ValidateAnyExpression compiles the expression to ensure that the expression itself is valid but more
// importantly it checks if the return type is not nil and is an allowed return type
// this allows us to ensure that nil and return types such as func or channels are not returned
func (c *ExprManager) ValidateAnyExpression(s string) error {
	tree, err := parser.Parse(s)
	if err != nil {
		return handleExpressionError(err)
	}

	config := conf.CreateNew()
	for _, op := range c.compileOptions() {
		op(config)
	}

	expectedType, err := checker.Check(tree, config)
	if err != nil {
		return handleExpressionError(err)
	}

	if expectedType == nil {
		return handleExpressionError(errors.New("disallowed nil"))
	}

	// Disallowed types
	switch expectedType.Kind() {
	case reflect.Invalid, reflect.Chan, reflect.Func:
		return handleExpressionError(fmt.Errorf("disallowed type: %s", expectedType.String()))
	}

	return nil
}

func (c *ExprManager) IsBodyUsedInExpressions() bool {
	body := c.globalVisitors[usesBodyKey].(*UsesBody)
	return body.UsesBody
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
