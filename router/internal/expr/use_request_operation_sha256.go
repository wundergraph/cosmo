package expr

import (
	"github.com/expr-lang/expr/ast"
)

const (
	sha256HashAttributeName = "sha256Hash"
	operationAttributeName  = "operation"
)

// UsesRequestOperationSha256 detects whether an expression references request.operation.sha256Hash
type UsesRequestOperationSha256 struct {
	UsesRequestOperationSha256 bool
}

func (v *UsesRequestOperationSha256) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationSha256 {
		return
	}

	// Check if it's a member access ending with "sha256Hash"
	shaAccess, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	// Property should be "sha256Hash"
	switch p := shaAccess.Property.(type) {
	case *ast.StringNode:
		if p.Value != sha256HashAttributeName {
			return
		}
	case *ast.IdentifierNode:
		if p.Value != sha256HashAttributeName {
			return
		}
	default:
		return
	}

	// Parent should be a member access to "operation"
	operationAccess, ok := shaAccess.Node.(*ast.MemberNode)
	if !ok {
		return
	}

	switch op := operationAccess.Property.(type) {
	case *ast.StringNode:
		if op.Value != operationAttributeName {
			return
		}
	case *ast.IdentifierNode:
		if op.Value != operationAttributeName {
			return
		}
	default:
		return
	}

	// Root should be identifier "request"
	requestIdent, ok := operationAccess.Node.(*ast.IdentifierNode)
	if !ok || requestIdent.Value != "request" {
		return
	}

	v.UsesRequestOperationSha256 = true
}
