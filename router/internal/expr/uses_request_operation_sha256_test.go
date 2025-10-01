package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/assert"
)

func TestUsesRequestOperationSha256(t *testing.T) {
	t.Parallel()

	t.Run("nil node", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{}
		visitor.Visit(nil)
		assert.False(t, visitor.UsesRequestOperationSha256)
	})

	t.Run("request.operation.sha256Hash access", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.StringNode{Value: "sha256Hash"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationSha256)
	})

	t.Run("request[\"operation\"][\"sha256Hash\"] access", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.IdentifierNode{Value: "operation"},
			},
			Property: &ast.IdentifierNode{Value: "sha256Hash"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationSha256)
	})

	t.Run("request[\"operation\"].sha256Hash access", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.IdentifierNode{Value: "sha256Hash"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationSha256)
	})

	t.Run("request.operation.hash access - not sha256", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.StringNode{Value: "hash"},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesRequestOperationSha256)
	})

	t.Run("other.operation.sha256Hash access - wrong root", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "other"},
				Property: &ast.StringNode{Value: "operation"},
			},
			Property: &ast.StringNode{Value: "sha256Hash"},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesRequestOperationSha256)
	})

	t.Run("request.body.sha256Hash access - wrong middle", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node:     &ast.IdentifierNode{Value: "request"},
				Property: &ast.StringNode{Value: "body"},
			},
			Property: &ast.StringNode{Value: "sha256Hash"},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesRequestOperationSha256)
	})

	t.Run("already set short-circuit", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesRequestOperationSha256{UsesRequestOperationSha256: true}
		node := ast.Node(&ast.MemberNode{
			Node:     &ast.IdentifierNode{Value: "request"},
			Property: &ast.StringNode{Value: "anything"},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesRequestOperationSha256)
	})
}
