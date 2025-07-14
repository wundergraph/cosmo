package expr

import "github.com/expr-lang/expr/ast"

const (
	responseNodeName = "response"
)

// This visitor is used to identify if expressions use response.body
type UsesResponseBody struct {
	UsesResponseBody bool
}

func (v *UsesResponseBody) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesResponseBody {
		return
	}

	// Check if it's a member access
	memberNode, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	// Check if this is response.body access
	if v.isResponseBodyAccess(memberNode) {
		v.UsesResponseBody = true
		return
	}

	// Continue traversing nested member access
	if memberNode.Node != nil {
		v.Visit(&memberNode.Node)
	}
}

func (v *UsesResponseBody) isResponseBodyAccess(memberNode *ast.MemberNode) bool {
	// Check if the property is "body"
	bodyPropertyName := v.getPropertyName(memberNode.Property)
	if bodyPropertyName != "body" {
		return false
	}

	// Check if the node is "response"
	responseNode, ok := memberNode.Node.(*ast.IdentifierNode)
	if !ok || responseNode.Value != responseNodeName {
		return false
	}

	return true
}

// getPropertyName extracts the property name from either StringNode or IdentifierNode
func (v *UsesResponseBody) getPropertyName(property ast.Node) string {
	switch prop := property.(type) {
	case *ast.StringNode:
		return prop.Value
	case *ast.IdentifierNode:
		return prop.Value
	default:
		return ""
	}
}
