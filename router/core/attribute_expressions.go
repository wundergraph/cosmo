package core

import (
	"errors"
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

	attrExprMapWithSha256            map[string]*vm.Program
	attrExprMapWithParsingTime       map[string]*vm.Program
	attrExprMapWithNameOrType        map[string]*vm.Program
	attrExprMapWithPersistedId       map[string]*vm.Program
	attrExprMapWithNormalizationTime map[string]*vm.Program
	attrExprMapWithHash              map[string]*vm.Program
	attrExprMapWithValidationTime    map[string]*vm.Program
	attrExprMapWithPlanningTime      map[string]*vm.Program
	expressionsWithSha256            map[string]*vm.Program
	expressionsWithParsingTime       map[string]*vm.Program
	expressionsWithNameOrType        map[string]*vm.Program
	expressionsWithPersistedId       map[string]*vm.Program
	expressionsWithNormalizationTime map[string]*vm.Program
	expressionsWithHash              map[string]*vm.Program
	expressionsWithValidationTime    map[string]*vm.Program
	expressionsWithPlanningTime      map[string]*vm.Program
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

	attrExprMapWithSha256 := make(map[string]*vm.Program)
	attrExprMapWithParsingTime := make(map[string]*vm.Program)
	attrExprMapWithNameOrType := make(map[string]*vm.Program)
	attrExprMapWithPersistedId := make(map[string]*vm.Program)
	attrExprMapWithNormalizationTime := make(map[string]*vm.Program)
	attrExprMapWithHash := make(map[string]*vm.Program)
	attrExprMapWithValidationTime := make(map[string]*vm.Program)
	attrExprMapWithPlanningTime := make(map[string]*vm.Program)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.Expression != "" {
			usesAuth := VisitorCheckForRequestAuthAccess{}
			usesSubgraph := expr.UsesSubgraph{}

			usesSha256 := expr.UsesRequestOperationSha256{}
			usesParsingTime := expr.UsesRequestOperationParsingTime{}
			usesPersistedId := expr.UsesRequestOperationPersistedId{}
			usesNormalizationTime := expr.UsesRequestOperationNormalizationTime{}
			usesHash := expr.UsesRequestOperationHash{}
			usesNameOrType := expr.UsesRequestOperationNameOrType{}
			usesValidationTime := expr.UsesRequestOperationValidationTime{}
			usesPlanningTime := expr.UsesRequestOperationPlanningTime{}

			prog, err := exprManager.CompileExpression(a.ValueFrom.Expression, reflect.String, &usesAuth, &usesSubgraph, &usesSha256, &usesNormalizationTime, &usesParsingTime, &usesPersistedId, &usesHash, &usesNameOrType, &usesValidationTime, &usesPlanningTime)
			if err != nil {
				return nil, fmt.Errorf("custom attribute error, unable to compile '%s' with expression '%s': %s", a.Key, a.ValueFrom.Expression, err)
			}

			if usesSubgraph.UsesSubgraph {
				attrExprMapSubgraph[a.Key] = prog
			} else if usesPlanningTime.UsesRequestOperationPlanningTime {
				attrExprMapWithPlanningTime[a.Key] = prog
			} else if usesValidationTime.UsesRequestOperationValidationTime {
				attrExprMapWithValidationTime[a.Key] = prog
			} else if usesHash.UsesRequestOperationHash {
				attrExprMapWithHash[a.Key] = prog
			} else if usesNormalizationTime.UsesRequestOperationNormalizationTime {
				attrExprMapWithNormalizationTime[a.Key] = prog
			} else if usesPersistedId.UsesRequestOperationPersistedId {
				attrExprMapWithPersistedId[a.Key] = prog
			} else if usesNameOrType.UsesRequestOperationNameOrType {
				attrExprMapWithNameOrType[a.Key] = prog
			} else if usesParsingTime.UsesRequestOperationParsingTime {
				attrExprMapWithParsingTime[a.Key] = prog
			} else if usesSha256.UsesRequestOperationSha256 {
				attrExprMapWithSha256[a.Key] = prog
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
		expressionsWithSha256:   attrExprMapWithSha256,
		// everything here is prefixed with expressionsWith
		expressionsWithParsingTime:       attrExprMapWithParsingTime,
		expressionsWithNameOrType:        attrExprMapWithNameOrType,
		expressionsWithPersistedId:       attrExprMapWithPersistedId,
		expressionsWithNormalizationTime: attrExprMapWithNormalizationTime,
		expressionsWithHash:              attrExprMapWithHash,
		expressionsWithValidationTime:    attrExprMapWithValidationTime,
		expressionsWithPlanningTime:      attrExprMapWithPlanningTime,
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

type AttributeExpressionsKey string

const (
	AttributeExpressionsKeyAll                   AttributeExpressionsKey = "expressionsAttributes"
	AttributeExpressionsKeyWithAuth              AttributeExpressionsKey = "expressionsAttributesWithAuth"
	AttributeExpressionsKeyWithSubgraph          AttributeExpressionsKey = "expressionsAttributesWithSubgraph"
	AttributeExpressionsKeyWithSha256            AttributeExpressionsKey = "expressionsAttributesWithSha256"
	AttributeExpressionsKeyWithParsingTime       AttributeExpressionsKey = "expressionsAttributesWithParsingTime"
	AttributeExpressionsKeyWithNameOrType        AttributeExpressionsKey = "expressionsAttributesWithNameOrType"
	AttributeExpressionsKeyWithPersistedId       AttributeExpressionsKey = "expressionsAttributesWithPersistedId"
	AttributeExpressionsKeyWithNormalizationTime AttributeExpressionsKey = "expressionsAttributesWithNormalizationTime"
	AttributeExpressionsKeyWithHash              AttributeExpressionsKey = "expressionsAttributesWithHash"
	AttributeExpressionsKeyWithValidationTime    AttributeExpressionsKey = "expressionsAttributesWithValidationTime"
	AttributeExpressionsKeyWithPlanningTime      AttributeExpressionsKey = "expressionsAttributesWithPlanningTime"
)

func (r *attributeExpressions) expressionsWithKey(key AttributeExpressionsKey, exprCtx *expr.Context) ([]attribute.KeyValue, error) {
	switch key {
	case AttributeExpressionsKeyAll:
		return expressionAttributes(r.expressions, exprCtx)
	case AttributeExpressionsKeyWithAuth:
		return expressionAttributes(r.expressionsWithSubgraph, exprCtx)
	case AttributeExpressionsKeyWithSubgraph:
		return expressionAttributes(r.expressionsWithAuth, exprCtx)

	// Special Types
	case AttributeExpressionsKeyWithSha256:
		return expressionAttributes(r.expressionsWithSha256, exprCtx)
	case AttributeExpressionsKeyWithParsingTime:
		return expressionAttributes(r.attrExprMapWithParsingTime, exprCtx)
	case AttributeExpressionsKeyWithNameOrType:
		return expressionAttributes(r.attrExprMapWithNameOrType, exprCtx)
	case AttributeExpressionsKeyWithPersistedId:
		return expressionAttributes(r.attrExprMapWithPersistedId, exprCtx)
	case AttributeExpressionsKeyWithNormalizationTime:
		return expressionAttributes(r.attrExprMapWithNormalizationTime, exprCtx)
	case AttributeExpressionsKeyWithHash:
		return expressionAttributes(r.attrExprMapWithHash, exprCtx)
	case AttributeExpressionsKeyWithValidationTime:
		return expressionAttributes(r.attrExprMapWithValidationTime, exprCtx)
	case AttributeExpressionsKeyWithPlanningTime:
		return expressionAttributes(r.attrExprMapWithPlanningTime, exprCtx)
	}

	return nil, errors.New("unknown key")
}
