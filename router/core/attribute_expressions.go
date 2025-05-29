package core

import (
	"fmt"
	"reflect"

	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/attribute"
)

// attributeExpressions maps context attributes to custom attributes.
type attributeExpressions struct {
	// expressions is a map of expressions that can be used to resolve dynamic attributes
	expressions map[string]*vm.Program
	// expressionsWithAuth is a map of expressions that can be used to resolve dynamic attributes and acces the auth
	// argument
	expressionsWithAuth map[string]*vm.Program

	expressionsWithSubgraph map[string]*vm.Program
}

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
			if node.Value == expr.ExprRequestKey && property.Value == expr.ExprRequestAuthKey {
				v.HasAuth = true
			}
		}
	}
}

func newAttributeExpressions(attr []config.CustomAttribute, exprManager *expr.Manager) (*attributeExpressions, error) {
	attrExprMap := make(map[string]*vm.Program)
	attrExprMapWithAuth := make(map[string]*vm.Program)
	attrExprMapSubgraph := make(map[string]*vm.Program)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.Expression != "" {
			usesAuth := VisitorCheckForRequestAuthAccess{}
			usesSubgraph := expr.UsesSubgraph{}
			prog, err := exprManager.CompileExpression(a.ValueFrom.Expression, reflect.String, &usesAuth, &usesSubgraph)
			if err != nil {
				return nil, fmt.Errorf("custom attribute error, unable to compile '%s' with expression '%s': %s", a.Key, a.ValueFrom.Expression, err)
			}
			if usesSubgraph.UsesSubgraph {
				attrExprMapSubgraph[a.Key] = prog
			} else if usesAuth.HasAuth {
				attrExprMapWithAuth[a.Key] = prog
			} else {
				attrExprMap[a.Key] = prog
			}
		}
	}

	return &attributeExpressions{
		expressions:             attrExprMap,
		expressionsWithAuth:     attrExprMapWithAuth,
		expressionsWithSubgraph: attrExprMapSubgraph,
	}, nil
}

func expressionAttributes(expressions map[string]*vm.Program, exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	if exprCtx == nil {
		return nil, nil
	}

	var result []attribute.KeyValue
	for exprKey, exprVal := range expressions {
		val, err := expr.ResolveStringExpression(exprVal, *exprCtx)
		if err != nil {
			return nil, err
		}
		result = append(result, attribute.String(exprKey, val))
	}

	return result, nil
}

func (r *attributeExpressions) expressionsAttributes(exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressions, exprCtx)
}

func (r *attributeExpressions) expressionsAttributesWithAuth(exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressionsWithAuth, exprCtx)
}

func (r *attributeExpressions) expressionsAttributesWithSubgraph(exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressionsWithSubgraph, exprCtx)
}
