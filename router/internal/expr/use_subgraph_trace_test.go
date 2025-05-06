package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/require"
)

func TestUsesSubgraphTrace(t *testing.T) {
	t.Parallel()

	t.Run("verify valid subgraph.request.clientTrace access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		requestNode := &ast.StringNode{Value: "request"}
		subgraphRequest := &ast.MemberNode{
			Node:     subgraphNode,
			Property: requestNode,
		}
		clientTraceNode := &ast.StringNode{Value: "clientTrace"}
		member := &ast.MemberNode{
			Node:     subgraphRequest,
			Property: clientTraceNode,
		}
		var n ast.Node = member

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.True(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify valid subgraph.request.clientTrace.someProperty access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		requestNode := &ast.StringNode{Value: "request"}
		subgraphRequest := &ast.MemberNode{
			Node:     subgraphNode,
			Property: requestNode,
		}
		clientTraceNode := &ast.StringNode{Value: "clientTrace"}
		requestClientTrace := &ast.MemberNode{
			Node:     subgraphRequest,
			Property: clientTraceNode,
		}
		propertyNode := &ast.StringNode{Value: "someProperty"}
		member := &ast.MemberNode{
			Node:     requestClientTrace,
			Property: propertyNode,
		}
		var n ast.Node = member

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.True(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify subgraph.request.something access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		requestNode := &ast.StringNode{Value: "request"}
		subgraphRequest := &ast.MemberNode{
			Node:     subgraphNode,
			Property: requestNode,
		}
		somethingNode := &ast.StringNode{Value: "something"}
		member := &ast.MemberNode{
			Node:     subgraphRequest,
			Property: somethingNode,
		}
		var n ast.Node = member

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify subgraph.something.clientTrace access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		somethingNode := &ast.StringNode{Value: "something"}
		subgraphSomething := &ast.MemberNode{
			Node:     subgraphNode,
			Property: somethingNode,
		}
		clientTraceNode := &ast.StringNode{Value: "clientTrace"}
		member := &ast.MemberNode{
			Node:     subgraphSomething,
			Property: clientTraceNode,
		}
		var n ast.Node = member

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify nil node", func(t *testing.T) {
		t.Parallel()

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(nil)
		require.False(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify non-member node", func(t *testing.T) {
		t.Parallel()

		node := &ast.IdentifierNode{Value: "subgraph"}
		var n ast.Node = node

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesSubgraphTrace)
	})
}
