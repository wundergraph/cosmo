package expr

import (
	"github.com/expr-lang/expr/ast"
	"reflect"
)

type UsesBody struct {
	UsesBody bool
}

func (v *UsesBody) Visit(baseNode *ast.Node) {
	if baseNode == nil || v.UsesBody {
		return
	}

	callNode, ok := (*baseNode).(*ast.CallNode)
	if !ok {
		return
	}

	typeDef, ok := callNode.Callee.(*ast.MemberNode)
	if !ok {
		return
	}

	node, ok := typeDef.Node.(*ast.MemberNode)
	if !ok {
		return
	}

	property, ok := typeDef.Property.(*ast.StringNode)
	if !ok {
		return
	}

	isTypeEquals := node.Type() == reflect.TypeOf(RequestBody{})
	isMethodCalled := property.Value == "GetRawBody"

	if isTypeEquals && isMethodCalled {
		v.UsesBody = true
	}
}
