package expr

import (
	"github.com/expr-lang/expr/ast"
)

const (
	variablesAttributeName = "variables"
)

// UsesRequestOperationVariables detects whether an expression references request.operation.variables
type UsesRequestOperationVariables struct {
	UsesRequestOperationVariables bool
}

func (v *UsesRequestOperationVariables) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesRequestOperationVariables {
		return
	}

	// Check if it's a member access ending with "variables"
	variablesAccess, ok := (*baseNode).(*ast.MemberNode)
	if !ok {
		return
	}

	// Property should be "variables"
	switch p := variablesAccess.Property.(type) {
	case *ast.StringNode:
		if p.Value != variablesAttributeName {
			return
		}
	case *ast.IdentifierNode:
		if p.Value != variablesAttributeName {
			return
		}
	default:
		return
	}

	// Parent should be a member access to "operation"
	operationAccess, ok := variablesAccess.Node.(*ast.MemberNode)
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
	if !ok || requestIdent.Value != ExprRequestKey {
		return
	}

	v.UsesRequestOperationVariables = true
}
