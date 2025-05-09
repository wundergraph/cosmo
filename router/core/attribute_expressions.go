package core

import (
	"errors"
	"fmt"
	"reflect"

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

	// expressionsWithSubgraph is a map of expressions that can be used to resolve attributes in a subgrpah context
	expressionsWithSubgraph map[string]*vm.Program
}

func newAttributeExpressions(attr []config.CustomAttribute, exprManager *expr.Manager) (*attributeExpressions, error) {
	attrExprMap := make(map[string]*vm.Program)
	attrExprMapWithAuth := make(map[string]*vm.Program)
	attrExprMapSubgraph := make(map[string]*vm.Program)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.Expression != "" {
			usesAuth := expr.VisitorCheckForRequestAuthAccess{}
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

	var err error
	result := make([]attribute.KeyValue, 0, len(expressions))
	for exprKey, exprVal := range expressions {
		val, err := expr.ResolveStringExpression(exprVal, *exprCtx)
		if err != nil {
			err = errors.Join(err, fmt.Errorf("custom attribute error, unable to resolve '%s': %w", exprKey, err))
			continue
		}
		result = append(result, attribute.String(exprKey, val))
	}

	return result, err
}

func (r *attributeExpressions) expressionsAttributes(exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressions, exprCtx)
}

func (r *attributeExpressions) expressionsAttributesWithAuth(exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressionsWithAuth, exprCtx)
}

func (r *attributeExpressions) expressionsAttributesForSubgraphs(exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	return expressionAttributes(r.expressionsWithSubgraph, exprCtx)
}
