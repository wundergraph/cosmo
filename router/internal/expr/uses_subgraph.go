package expr

import "github.com/expr-lang/expr/ast"

const (
	nodeName = "subgraph"
)

// This visitor is used to identify if expressions should be executed in a subgraph context
type UsesSubgraph struct {
	UsesSubgraph bool
}

func (v *UsesSubgraph) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesSubgraph {
		return
	}

	// Check if it's an identifier node
	identifierNode, ok := (*baseNode).(*ast.IdentifierNode)
	if ok && identifierNode.Value == nodeName {
		v.UsesSubgraph = true
		return
	}

	// Check if it's a member access
	memberNode, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	// Check if the node itself is "subgraph"
	if identifierNode, ok := memberNode.Node.(*ast.IdentifierNode); ok && identifierNode.Value == nodeName {
		v.UsesSubgraph = true
		return
	}

	// Continue traversing
	if memberNode.Node != nil {
		v.Visit(&memberNode.Node)
	}
}
