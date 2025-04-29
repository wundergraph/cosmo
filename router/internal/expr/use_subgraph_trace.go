package expr

import (
	"github.com/expr-lang/expr/ast"
)

type UsesSubgraphTrace struct {
	UsesSubgraphTrace bool
}

func (v *UsesSubgraphTrace) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesSubgraphTrace {
		return
	}

	// Check if it's a member access
	memberNode, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	// Check if the property is "trace"
	propertyNode, ok := memberNode.Property.(*ast.StringNode)
	if !ok || propertyNode.Value != "trace" {
		return
	}

	// Check if the node is subgraph.operation
	operationNode, ok := memberNode.Node.(*ast.MemberNode)
	if !ok {
		return
	}

	// Check if the property is "operation"
	operationProperty, ok := operationNode.Property.(*ast.StringNode)
	if !ok || operationProperty.Value != "operation" {
		return
	}

	// Check if the node is "subgraph"
	subgraphNode, ok := operationNode.Node.(*ast.IdentifierNode)
	if !ok || subgraphNode.Value != "subgraph" {
		return
	}

	v.UsesSubgraphTrace = true
}
