package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/assert"
)

func TestUsesResponseBody(t *testing.T) {
	t.Run("nil node", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		visitor.Visit(nil)
		assert.False(t, visitor.UsesResponseBody)
	})

	t.Run("response.body access", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "response",
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesResponseBody)
	})

	t.Run("response with different property", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "response",
			},
			Property: &ast.StringNode{
				Value: "headers",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesResponseBody)
	})

	t.Run("other.body access", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "request",
			},
			Property: &ast.StringNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesResponseBody)
	})

	t.Run("non-member node", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		node := ast.Node(&ast.IdentifierNode{
			Value: "response",
		})
		visitor.Visit(&node)
		assert.False(t, visitor.UsesResponseBody)
	})

	t.Run("already uses response body", func(t *testing.T) {
		visitor := &UsesResponseBody{
			UsesResponseBody: true,
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
		assert.True(t, visitor.UsesResponseBody)
	})

	t.Run("property not a string node", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.IdentifierNode{
				Value: "response",
			},
			Property: &ast.IdentifierNode{
				Value: "body",
			},
		})
		visitor.Visit(&node)
		assert.True(t, visitor.UsesResponseBody)
	})

	t.Run("response.body.raw access", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "response",
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
		assert.True(t, visitor.UsesResponseBody)
	})

	t.Run("response.body.other access", func(t *testing.T) {
		visitor := &UsesResponseBody{}
		node := ast.Node(&ast.MemberNode{
			Node: &ast.MemberNode{
				Node: &ast.IdentifierNode{
					Value: "response",
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
		assert.True(t, visitor.UsesResponseBody)
	})
}
