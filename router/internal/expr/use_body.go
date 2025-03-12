package expr

import "github.com/expr-lang/expr/ast"

type UsesBody struct {
	UsesBody bool
}

func (v *UsesBody) Visit(node *ast.Node) {
	if node == nil {
		return
	}

	if v.UsesBody {
		return
	}

	switch n := (*node).(type) {
	case *ast.MemberNode:
		property, propertyOk := n.Property.(*ast.StringNode)
		node, nodeOk := n.Node.(*ast.IdentifierNode)
		if propertyOk && nodeOk {
			// TODO: To change to look for method call for raw body
			if node.Value == "request" && property.Value == "body" {
				v.UsesBody = true
			}
		}
	}
}
