package expr

import (
	"github.com/expr-lang/expr/ast"
)

// UsesRequestOperationNormalizationTime detects request.operation.normalizationTime
type UsesRequestOperationNormalizationTime struct {
	UsesRequestOperationNormalizationTime bool
}

func (v *UsesRequestOperationNormalizationTime) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationNormalizationTime {
		return
	}

	member, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	switch p := member.Property.(type) {
	case *ast.StringNode:
		if p.Value != "normalizationTime" {
			return
		}
	case *ast.IdentifierNode:
		if p.Value != "normalizationTime" {
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

	v.UsesRequestOperationNormalizationTime = true
}
