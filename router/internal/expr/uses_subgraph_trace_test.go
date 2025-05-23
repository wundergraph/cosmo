package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/assert"
)

func TestUsesSubgraphTrace(t *testing.T) {
	t.Run("nil node", func(t *testing.T) {
		visitor := &UsesSubgraphTrace{}
		visitor.Visit(nil)
		assert.False(t, visitor.UsesSubgraphTrace)
	})

	t.Run("subgraph request client trace", func(t *testing.T) {
		visitor := &UsesSubgraphTrace{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "request",
				},
			},
			Property: &ast.StringNode{
				Value: "clientTrace",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphTrace)
	})

	t.Run("non-subgraph client trace", func(t *testing.T) {
		visitor := &UsesSubgraphTrace{}
		node := ast.Node(&ast.IdentifierNode{
			Value: "other",
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphTrace)
	})

	t.Run("subgraph non-request client trace", func(t *testing.T) {
		visitor := &UsesSubgraphTrace{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "other",
				},
			},
			Property: &ast.StringNode{
				Value: "clientTrace",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphTrace)
	})

	t.Run("subgraph non-request client trace when UsesSubgraphTrace is true already", func(t *testing.T) {
		visitor := &UsesSubgraphTrace{
			UsesSubgraphTrace: true,
		}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "other",
				},
			},
			Property: &ast.StringNode{
				Value: "clientTrace",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphTrace)
	})

	t.Run("nested client trace", func(t *testing.T) {
		visitor := &UsesSubgraphTrace{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.MemberNode{
					Node: &ast.IdentifierNode{
						Value: "subgraph",
					},
					Property: &ast.StringNode{
						Value: "request",
					},
				},
				Property: &ast.StringNode{
					Value: "clientTrace",
				},
			},
			Property: &ast.StringNode{
				Value: "someProperty",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphTrace)
	})
}
