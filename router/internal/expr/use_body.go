package expr

import (
	"github.com/expr-lang/expr/ast"
)

type UsesBody struct {
	UsesBody bool
}

func (v *UsesBody) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesBody {
		return
	}

	// Check if it's a member access
	rawAccess, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	// Check if the property is "raw"
	rawProperty, ok := rawAccess.Property.(*ast.StringNode)
	if !ok || rawProperty.Value != "raw" {
		return
	}

	// Check if the node is request.body
	bodyAccess, ok := rawAccess.Node.(*ast.MemberNode)
	if !ok {
		return
	}

	// Check if the property is "body"
	bodyProperty, ok := bodyAccess.Property.(*ast.StringNode)
	if !ok || bodyProperty.Value != "body" {
		return
	}

	// Check if the node is "request"
	requestNode, ok := bodyAccess.Node.(*ast.IdentifierNode)
	if !ok || requestNode.Value != "request" {
		return
	}

	v.UsesBody = true
}
