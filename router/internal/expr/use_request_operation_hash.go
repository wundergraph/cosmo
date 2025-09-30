package expr

import (
	"github.com/expr-lang/expr/ast"
)

// UsesRequestOperationHash detects whether an expression references request.operation.hash
type UsesRequestOperationHash struct {
	UsesRequestOperationHash bool
}

func (v *UsesRequestOperationHash) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationHash {
		return
	}

	member, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	switch p := member.Property.(type) {
	case *ast.StringNode:
		if p.Value != "hash" {
			return
		}
	case *ast.IdentifierNode:
		if p.Value != "hash" {
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

	v.UsesRequestOperationHash = true
}
