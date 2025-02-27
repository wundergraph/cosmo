package requestlogger

import (
	"fmt"
	"github.com/expr-lang/expr/vm"
	exprlocal "github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

type ExpressionAttribute struct {
	Key     string
	Default string
	Expr    *vm.Program
}

func GetAccessLogConfigExpressions(attributes []config.CustomAttribute) ([]ExpressionAttribute, error) {
	exprSlice := make([]ExpressionAttribute, 0)
	for _, sAttribute := range attributes {
		if sAttribute.ValueFrom == nil || sAttribute.ValueFrom.Expression == "" {
			continue
		}

		err := exprlocal.ValidateAnyExpression(sAttribute.ValueFrom.Expression)
		if err != nil {
			return nil, fmt.Errorf("failed when validating log expressions: %w", err)
		}

		expression, err := exprlocal.CompileAnyExpression(sAttribute.ValueFrom.Expression)
		if err != nil {
			return nil, fmt.Errorf("failed when compiling log expressions: %w", err)
		}

		exprSlice = append(exprSlice, ExpressionAttribute{
			Key:     sAttribute.Key,
			Default: sAttribute.Default,
			Expr:    expression,
		})
	}
	return exprSlice, nil
}

func CleanupExpressionAttributes(attributes []config.CustomAttribute) []config.CustomAttribute {
	filtered := make([]config.CustomAttribute, 0, len(attributes))

	for _, elem := range attributes {
		if elem.ValueFrom == nil || elem.ValueFrom.Expression == "" {
			filtered = append(filtered, elem)
		}
	}

	return filtered
}
