package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/require"
)

func TestUsesBody(t *testing.T) {
	t.Parallel()

	t.Run("verify valid body.raw access", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "request"}
		bodyNode := &ast.StringNode{Value: "body"}
		requestBody := &ast.MemberNode{
			Node:     requestNode,
			Property: bodyNode,
		}
		rawNode := &ast.StringNode{Value: "raw"}
		member := &ast.MemberNode{
			Node:     requestBody,
			Property: rawNode,
		}
		var n ast.Node = member

		visitor := &UsesBody{}
		visitor.Visit(&n)
		require.True(t, visitor.UsesBody)
	})

	t.Run("verify nil node", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesBody{}
		visitor.Visit(nil)
		require.False(t, visitor.UsesBody)
	})

	t.Run("verify non-member node", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "request"}
		var n ast.Node = requestNode

		visitor := &UsesBody{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesBody)
	})

	t.Run("verify inner node not member node", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "request"}
		rawNode := &ast.StringNode{Value: "raw"}
		member := &ast.MemberNode{
			Node:     requestNode,
			Property: rawNode,
		}
		var n ast.Node = member

		visitor := &UsesBody{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesBody)
	})

	t.Run("verify property not string node", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "request"}
		bodyNode := &ast.StringNode{Value: "body"}
		requestBody := &ast.MemberNode{
			Node:     requestNode,
			Property: bodyNode,
		}
		rawNode := &ast.IdentifierNode{Value: "raw"}
		member := &ast.MemberNode{
			Node:     requestBody,
			Property: rawNode,
		}
		var n ast.Node = member

		visitor := &UsesBody{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesBody)
	})

	t.Run("verify early return when UsesBody is already true", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "request"}
		var n ast.Node = requestNode

		visitor := &UsesBody{UsesBody: true}
		visitor.Visit(&n)
		require.True(t, visitor.UsesBody)
	})

	t.Run("verify wrong request identifier", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "wrong"}
		bodyNode := &ast.StringNode{Value: "body"}
		requestBody := &ast.MemberNode{
			Node:     requestNode,
			Property: bodyNode,
		}
		rawNode := &ast.StringNode{Value: "raw"}
		member := &ast.MemberNode{
			Node:     requestBody,
			Property: rawNode,
		}
		var n ast.Node = member

		visitor := &UsesBody{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesBody)
	})

	t.Run("verify wrong body property", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "request"}
		bodyNode := &ast.StringNode{Value: "wrong"}
		requestBody := &ast.MemberNode{
			Node:     requestNode,
			Property: bodyNode,
		}
		rawNode := &ast.StringNode{Value: "raw"}
		member := &ast.MemberNode{
			Node:     requestBody,
			Property: rawNode,
		}
		var n ast.Node = member

		visitor := &UsesBody{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesBody)
	})

	t.Run("verify wrong raw property", func(t *testing.T) {
		t.Parallel()

		requestNode := &ast.IdentifierNode{Value: "request"}
		bodyNode := &ast.StringNode{Value: "body"}
		requestBody := &ast.MemberNode{
			Node:     requestNode,
			Property: bodyNode,
		}
		rawNode := &ast.StringNode{Value: "wrong"}
		member := &ast.MemberNode{
			Node:     requestBody,
			Property: rawNode,
		}
		var n ast.Node = member

		visitor := &UsesBody{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesBody)
	})
}
