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

type ProgramWrapper struct {
	Program *vm.Program
	Key     string
}

// attributeExpressions maps context attributes to custom attributes.
type attributeExpressions struct {
	expressions map[expr.AttributeBucket][]ProgramWrapper
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
	attrs := make(map[expr.AttributeBucket][]ProgramWrapper)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.Expression != "" {
			bucket := expr.RequestOperationBucketVisitor{}

			// Keep sha256 visitor intact for other features, but consolidate classification via bucket
			prog, err := exprManager.CompileExpression(a.ValueFrom.Expression, reflect.String, &bucket)
			if err != nil {
				return nil, fmt.Errorf("custom attribute error, unable to compile '%s' with expression '%s': %s", a.Key, a.ValueFrom.Expression, err)
			}

			attrs[bucket.Bucket] = append(attrs[bucket.Bucket], ProgramWrapper{
				Program: prog,
				Key:     a.Key,
			})
		}
	}

	return &attributeExpressions{
		expressions: attrs,
	}, nil
}

func expressionAttributes(expressions map[expr.AttributeBucket][]ProgramWrapper, exprCtx *expr.Context, key expr.AttributeBucket) ([]attribute.KeyValue, error) {
	if exprCtx == nil {
		return nil, nil
	}

	programWrappers, ok := expressions[key]
	if !ok {
		return nil, nil
	}

	var result []attribute.KeyValue
	for _, wrapper := range programWrappers {
		val, err := expr.ResolveStringExpression(wrapper.Program, *exprCtx)
		if err != nil {
			return nil, err
		}
		result = append(result, attribute.String(wrapper.Key, val))
	}

	return result, nil
}

func (r *attributeExpressions) expressionsAttributes(exprCtx *expr.Context, key expr.AttributeBucket) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressions, exprCtx, key)
}
