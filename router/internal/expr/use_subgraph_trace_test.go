package expr

import (
	"testing"

	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/require"
)

func TestUsesSubgraphTrace(t *testing.T) {
	t.Parallel()

	t.Run("verify valid subgraph.operation.trace access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		operationNode := &ast.StringNode{Value: "operation"}
		subgraphOperation := &ast.MemberNode{
			Node:     subgraphNode,
			Property: operationNode,
		}
		traceNode := &ast.StringNode{Value: "trace"}
		member := &ast.MemberNode{
			Node:     subgraphOperation,
			Property: traceNode,
		}
		var n ast.Node = member

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.True(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify valid subgraph.operation.trace.someProperty access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		operationNode := &ast.StringNode{Value: "operation"}
		subgraphOperation := &ast.MemberNode{
			Node:     subgraphNode,
			Property: operationNode,
		}
		traceNode := &ast.StringNode{Value: "trace"}
		operationTrace := &ast.MemberNode{
			Node:     subgraphOperation,
			Property: traceNode,
		}
		propertyNode := &ast.StringNode{Value: "someProperty"}
		member := &ast.MemberNode{
			Node:     operationTrace,
			Property: propertyNode,
		}
		var n ast.Node = member

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.True(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify subgraph.operation.something access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		operationNode := &ast.StringNode{Value: "operation"}
		subgraphOperation := &ast.MemberNode{
			Node:     subgraphNode,
			Property: operationNode,
		}
		somethingNode := &ast.StringNode{Value: "something"}
		member := &ast.MemberNode{
			Node:     subgraphOperation,
			Property: somethingNode,
		}
		var n ast.Node = member

		visitor := &UsesSubgraphTrace{}
		visitor.Visit(&n)
		require.False(t, visitor.UsesSubgraphTrace)
	})

	t.Run("verify subgraph.something.trace access", func(t *testing.T) {
		t.Parallel()

		subgraphNode := &ast.IdentifierNode{Value: "subgraph"}
		somethingNode := &ast.StringNode{Value: "something"}
		subgraphSomething := &ast.MemberNode{
			Node:     subgraphNode,
			Property: somethingNode,
		}
		traceNode := &ast.StringNode{Value: "trace"}
		member := &ast.MemberNode{
			Node:     subgraphSomething,
			Property: traceNode,
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
