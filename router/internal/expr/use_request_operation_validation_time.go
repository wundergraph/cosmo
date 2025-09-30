package expr

import (
	"github.com/expr-lang/expr/ast"
)

// UsesRequestOperationValidationTime detects request.operation.validationTime
type UsesRequestOperationValidationTime struct {
	UsesRequestOperationValidationTime bool
}

func (v *UsesRequestOperationValidationTime) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationValidationTime {
		return
	}

	member, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	switch p := member.Property.(type) {
	case *ast.StringNode:
		if p.Value != "validationTime" {
			return
		}
	case *ast.IdentifierNode:
		if p.Value != "validationTime" {
			return
		}
	default:
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

	v.UsesRequestOperationValidationTime = true
}
