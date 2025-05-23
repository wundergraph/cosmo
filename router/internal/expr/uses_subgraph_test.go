package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/assert"
)

func TestUsesSubgraph(t *testing.T) {
	t.Run("nil node", func(t *testing.T) {
		visitor := &UsesSubgraph{}
		visitor.Visit(nil)
		assert.False(t, visitor.UsesSubgraph)
	})

	t.Run("direct subgraph identifier", func(t *testing.T) {
		visitor := &UsesSubgraph{}
		node := ast.Node(&ast.IdentifierNode{
			Value: "subgraph",
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraph)
	})

	t.Run("subgraph member access", func(t *testing.T) {
		visitor := &UsesSubgraph{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "subgraph",
			},
			Property: &ast.StringNode{
				Value: "someProperty",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraph)
	})

	t.Run("nested member access", func(t *testing.T) {
		visitor := &UsesSubgraph{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "inner",
				},
			},
			Property: &ast.StringNode{
				Value: "outer",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraph)
	})

	t.Run("non-subgraph identifier", func(t *testing.T) {
		visitor := &UsesSubgraph{}
		node := ast.Node(&ast.IdentifierNode{
			Value: "other",
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraph)
	})

	t.Run("non-subgraph member access", func(t *testing.T) {
		visitor := &UsesSubgraph{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "other",
			},
			Property: &ast.StringNode{
				Value: "property",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraph)
	})

	t.Run("non-subgraph member access with use subgraph true", func(t *testing.T) {
		visitor := &UsesSubgraph{
			UsesSubgraph: true,
		}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "other",
			},
			Property: &ast.StringNode{
				Value: "property",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraph)
	})
}
