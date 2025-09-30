package expr

import (
	"github.com/expr-lang/expr/ast"
)

// UsesRequestOperationPlanningTime detects request.operation.planningTime
type UsesRequestOperationPlanningTime struct {
	UsesRequestOperationPlanningTime bool
}

func (v *UsesRequestOperationPlanningTime) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationPlanningTime {
		return
	}

	member, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	switch p := member.Property.(type) {
	case *ast.StringNode:
		if p.Value != "planningTime" {
			return
		}
	case *ast.IdentifierNode:
		if p.Value != "planningTime" {
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

	v.UsesRequestOperationPlanningTime = true
}
