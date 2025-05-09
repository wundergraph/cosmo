package expr

import "github.com/expr-lang/expr/ast"

type VisitorCheckForRequestAuthAccess struct {
	HasAuth bool
}

func (v *VisitorCheckForRequestAuthAccess) Visit(node *ast.Node) {
	if node == nil {
		return
	}

	if v.HasAuth {
		return
	}

	switch n := (*node).(type) {
	case *ast.MemberNode:
		property, propertyOk := n.Property.(*ast.StringNode)
		node, nodeOk := n.Node.(*ast.IdentifierNode)
		if propertyOk && nodeOk {
			if node.Value == ExprRequestKey && property.Value == ExprRequestAuthKey {
				v.HasAuth = true
			}
		}
	}
}
