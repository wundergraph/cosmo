package expr

import (
	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/require"
	"reflect"
	"testing"
)

type VisitorExample struct {
	Uses bool
}

func (v *VisitorExample) Visit(node *ast.Node) {
	if node == nil {
		return
	}

	if v.Uses {
		return
	}

	if _, ok := (*node).(*ast.MemberNode); ok {
		v.Uses = true
	}
}

func TestExprManager(t *testing.T) {
	t.Parallel()

	t.Run("verify compiling any expression", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		expr, err := exprManager.CompileAnyExpression("request.error ?? 'somevalue'", UseDefaultContext())
		require.NoError(t, err)

		context := Context{
			Request: Request{
				Error: nil,
			},
		}

		result, err := ResolveAnyExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.Equal(t, "somevalue", result)
	})

	t.Run("verify compiling expression with type", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		expr, err := exprManager.CompileExpression("request.error == nil", reflect.Bool, UseDefaultContext())
		require.NoError(t, err)

		context := Context{
			Request: Request{
				Error: nil,
			},
		}

		result, err := ResolveBoolExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.True(t, result)
	})

	t.Run("verify compiling expression with type", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		expr, err := exprManager.CompileExpression("request.error == nil", reflect.Bool, UseDefaultContext())
		require.NoError(t, err)

		context := Context{
			Request: Request{
				Error: nil,
			},
		}

		result, err := ResolveBoolExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.True(t, result)
	})

	t.Run("verify compiling an expression", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error ?? 'somevalue'", UseDefaultContext())
		require.NoError(t, err)
	})

	t.Run("verify compiling expression with custom visitor", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		visitorExample := VisitorExample{}
		require.False(t, visitorExample.Uses)

		expr, err := exprManager.CompileExpression("request.error == nil", reflect.Bool, UseDefaultContext(), &visitorExample)
		require.NoError(t, err)

		context := UseDefaultContext()

		_, err = ResolveBoolExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.True(t, visitorExample.Uses)
	})

	t.Run("verify when body.raw is not accessed", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error", UseDefaultContext())
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		_, err = exprManager.CompileAnyExpression("request.body", UseDefaultContext())
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.False(t, exprManager.VisitorManager.IsBodyUsedInExpressions())
	})

	t.Run("verify when body.raw is accessed", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error", UseDefaultContext())
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		_, err = exprManager.CompileAnyExpression("request.body.raw", UseDefaultContext())
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.True(t, exprManager.VisitorManager.IsBodyUsedInExpressions())
	})

	t.Run("verify when body.raw is called conditionally", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error ?? request.body.raw", UseDefaultContext())
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.True(t, exprManager.VisitorManager.IsBodyUsedInExpressions())
	})

}
