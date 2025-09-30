package expr

import (
	"github.com/expr-lang/expr/ast"
)

// UsesRequestOperationParsingTime detects request.operation.parsingTime
type UsesRequestOperationParsingTime struct {
	UsesRequestOperationParsingTime bool
}

func (v *UsesRequestOperationParsingTime) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationParsingTime {
		return
	}

	member, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	switch p := member.Property.(type) {
	case *ast.StringNode:
		if p.Value != "parsingTime" {
			return
		}
	case *ast.IdentifierNode:
		if p.Value != "parsingTime" {
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

	v.UsesRequestOperationParsingTime = true
}
