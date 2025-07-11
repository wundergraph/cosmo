package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/assert"
)

func TestUsesSubgraphResponseBody(t *testing.T) {
	t.Run("nil node", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		visitor.Visit(nil)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("subgraph.response.body access", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "response",
				},
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("subgraph.response.headers access", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "response",
				},
			},
			Property: &ast.StringNode{
				Value: "headers",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("subgraph.request.body access", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
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
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("other.response.body access", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "other",
				},
				Property: &ast.StringNode{
					Value: "response",
				},
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("response.body access (two levels only)", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "response",
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("subgraph identifier only", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.IdentifierNode{
			Value: "subgraph",
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("subgraph.response access (two levels only)", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "subgraph",
			},
			Property: &ast.StringNode{
				Value: "response",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("already uses subgraph response body", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{
			UsesSubgraphResponseBody: true,
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
		assert.True(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("property not a string node", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "response",
				},
			},
			Property: &ast.IdentifierNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("middle property not a string node", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "subgraph",
				},
				Property: &ast.IdentifierNode{
					Value: "response",
				},
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("base not an identifier node", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.StringNode{
					Value: "subgraph",
				},
				Property: &ast.StringNode{
					Value: "response",
				},
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("middle node not a member node", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "subgraph",
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("subgraph.response.body.raw access", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.MemberNode{
					Node: &ast.IdentifierNode{
						Value: "subgraph",
					},
					Property: &ast.StringNode{
						Value: "response",
					},
				},
				Property: &ast.StringNode{
					Value: "body",
				},
			},
			Property: &ast.StringNode{
				Value: "raw",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphResponseBody)
	})

	t.Run("subgraph.response.body.other access", func(t *testing.T) {
		visitor := &UsesSubgraphResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.MemberNode{
					Node: &ast.IdentifierNode{
						Value: "subgraph",
					},
					Property: &ast.StringNode{
						Value: "response",
					},
				},
				Property: &ast.StringNode{
					Value: "body",
				},
			},
			Property: &ast.StringNode{
				Value: "other",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesSubgraphResponseBody)
	})
}
