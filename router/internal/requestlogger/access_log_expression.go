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
		if expr := sAttribute.ValueFrom.Expression; expr != "" {
			expression, err := exprlocal.CompileAnyExpression(expr)
			if err != nil {
				return nil, fmt.Errorf("failed when compiling log expressions: %w", err)
			}
			exprSlice = append(exprSlice, ExpressionAttribute{
				Key:     sAttribute.Key,
				Default: sAttribute.Default,
				Expr:    expression,
			})
		}
	}
	return exprSlice, nil
}
