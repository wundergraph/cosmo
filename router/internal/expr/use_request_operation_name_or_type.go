package expr

import (
	"github.com/expr-lang/expr/ast"
)

// UsesRequestOperationNameOrType detects whether an expression references request.operation.name or request.operation.type
type UsesRequestOperationNameOrType struct {
	UsesRequestOperationNameOrType bool
}

func (v *UsesRequestOperationNameOrType) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationNameOrType {
		return
	}

	member, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	propertyIsTarget := false
	switch p := member.Property.(type) {
	case *ast.StringNode:
		propertyIsTarget = p.Value == "name" || p.Value == "type"
	case *ast.IdentifierNode:
		propertyIsTarget = p.Value == "name" || p.Value == "type"
	default:
		return
	}
	if !propertyIsTarget {
		return
	}

	opMember, ok := member.Node.(*ast.MemberNode)
	if !ok {
		return
	}

	switch op := opMember.Property.(type) {
	case *ast.StringNode:
		if op.Value != "operation" {
			return
		}
	case *ast.IdentifierNode:
		if op.Value != "operation" {
			return
		}
	default:
		return
	}

	reqIdent, ok := opMember.Node.(*ast.IdentifierNode)
	if !ok || reqIdent.Value != "request" {
		return
	}

	v.UsesRequestOperationNameOrType = true
}
