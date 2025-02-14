package core

import (
	"errors"
	"fmt"

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
			if node.Value == "request" && property.Value == "auth" {
				v.HasAuth = true
			}
		}
	}
}

func newAttributeExpressions(attr []config.CustomAttribute) (*attributeExpressions, error) {
	attrExprMap := make(map[string]*vm.Program)
	attrExprMapWithAuth := make(map[string]*vm.Program)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.Expression != "" {
			usesAuth := VisitorCheckForRequestAuthAccess{}
			prog, err := expr.CompileStringExpressionWithPatch(a.ValueFrom.Expression, &usesAuth)
			if err != nil {
				return nil, fmt.Errorf("custom attribute error, unable to compile '%s' with expression '%s': %s", a.Key, a.ValueFrom.Expression, err)
			}
			if usesAuth.HasAuth {
				attrExprMapWithAuth[a.Key] = prog
			} else {
				attrExprMap[a.Key] = prog
			}
		}
	}

	return &attributeExpressions{
		expressions:         attrExprMap,
		expressionsWithAuth: attrExprMapWithAuth,
	}, nil
}

func expressionAttributes(expressions map[string]*vm.Program, reqCtx *requestContext) ([]attribute.KeyValue, error) {
	if reqCtx == nil {
		return nil, nil
	}
	errs := make([]error, 0)

	var result []attribute.KeyValue
	for exprKey, exprVal := range expressions {
		val, err := reqCtx.ResolveStringExpression(exprVal)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		result = append(result, attribute.String(exprKey, val))
	}

	return result, errors.Join(errs...)
}

func (r *attributeExpressions) expressionsAttributes(reqCtx *requestContext) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressions, reqCtx)
}

func (r *attributeExpressions) expressionsAttributesWithAuth(reqCtx *requestContext) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressionsWithAuth, reqCtx)
}
