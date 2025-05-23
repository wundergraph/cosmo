package expr

import (
	"github.com/expr-lang/expr/ast"
)

// This visitor is used to identify if we should enable client tracing because clientTrace
// has been accessed in an expression
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

	// First check the current node's property
	propertyNode, ok := memberNode.Property.(*ast.StringNode)
	if ok && propertyNode.Value == "clientTrace" {
		// Check if this trace is accessed through subgraph.operation
		if v.isSubgraphOperation(memberNode.Node) {
			v.UsesSubgraphTrace = true
			return
		}
	}

	// Then check the node itself and its children
	if memberNode.Node != nil {
		// Check if the node itself is a member access with "trace"
		if nextMember, ok := memberNode.Node.(*ast.MemberNode); ok {
			if nextProperty, ok := nextMember.Property.(*ast.StringNode); ok && nextProperty.Value == "clientTrace" {
				if v.isSubgraphOperation(nextMember.Node) {
					v.UsesSubgraphTrace = true
					return
				}
			}
		}
		// Continue traversing
		v.Visit(&memberNode.Node)
	}
}

func (v *UsesSubgraphTrace) isSubgraphOperation(node ast.Node) bool {
	memberNode, ok := node.(*ast.MemberNode)
	if !ok {
		return false
	}

	// Check if the property is "request"
	requestProperty, ok := memberNode.Property.(*ast.StringNode)
	if !ok || requestProperty.Value != "request" {
		return false
	}

	// Check if the node is "subgraph"
	subgraphNode, ok := memberNode.Node.(*ast.IdentifierNode)
	return ok && subgraphNode.Value == "subgraph"
}
