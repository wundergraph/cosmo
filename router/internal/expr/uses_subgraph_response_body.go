package expr

import "github.com/expr-lang/expr/ast"

const (
	subgraphNodeName = "subgraph"
)

// This visitor is used to identify if expressions use subgraph.response.body
type UsesSubgraphResponseBody struct {
	UsesSubgraphResponseBody bool
}

func (v *UsesSubgraphResponseBody) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesSubgraphResponseBody {
		return
	}

	// Check if it's a member access
	memberNode, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	// Check if this is subgraph.response.body access
	if v.isSubgraphResponseBodyAccess(memberNode) {
		v.UsesSubgraphResponseBody = true
		return
	}

	// Continue traversing nested member access
	if memberNode.Node != nil {
		v.Visit(&memberNode.Node)
	}
}

func (v *UsesSubgraphResponseBody) isSubgraphResponseBodyAccess(memberNode *ast.MemberNode) bool {
	// Check if the property is "body"
	bodyPropertyName := v.getPropertyName(memberNode.Property)
	if bodyPropertyName != "body" {
		return false
	}

	// Check if the node is response access (response.body)
	responseNode, ok := memberNode.Node.(*ast.MemberNode)
	if !ok {
		return false
	}

	// Check if the property is "response"
	responsePropertyName := v.getPropertyName(responseNode.Property)
	if responsePropertyName != "response" {
		return false
	}

	// Check if the base node is "subgraph"
	subgraphNode, ok := responseNode.Node.(*ast.IdentifierNode)
	if !ok || subgraphNode.Value != subgraphNodeName {
		return false
	}

	return true
}

// getPropertyName extracts the property name from either StringNode or IdentifierNode
func (v *UsesSubgraphResponseBody) getPropertyName(property ast.Node) string {
	switch prop := property.(type) {
	case *ast.StringNode:
		return prop.Value
	case *ast.IdentifierNode:
		return prop.Value
	default:
		return ""
	}
}
