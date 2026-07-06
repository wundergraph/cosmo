package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/assert"
)

func TestUsesRequestOperationVariables(t *testing.T) {
	t.Parallel()

	t.Run("nil node", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		visitor.Visit(nil)
		assert.False(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("request.operation.variables access", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.StringNode{Value: "variables"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("request[\"operation\"][\"variables\"] access", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.IdentifierNode{Value: "operation"},
			},
			Property: &ast.IdentifierNode{Value: "variables"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("request[\"operation\"].variables access", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.IdentifierNode{Value: "variables"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("request.operation.variablesRemappingCacheHit access - not variables", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.StringNode{Value: "variablesRemappingCacheHit"},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("request.operation.variablesNormalizationCacheHit access - not variables", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.StringNode{Value: "variablesNormalizationCacheHit"},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("other.operation.variables access - wrong root", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "other"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.StringNode{Value: "variables"},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("request.body.variables access - wrong middle", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "body"},
			},
			Property: &ast.StringNode{Value: "variables"},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesRequestOperationVariables)
	})

	t.Run("already set short-circuit", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationVariables{UsesRequestOperationVariables: true}
		node := ast.Node(&ast.MemberNode{
			Node:     &ast.IdentifierNode{Value: "request"},
			Property: &ast.StringNode{Value: "anything"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationVariables)
	})
}
