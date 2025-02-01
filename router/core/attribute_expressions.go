package core

import (
	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

// attributeExpressions maps context attributes to custom attributes.
type attributeExpressions struct {
	logger *zap.Logger

	// expressionsMapper is a map of expressions that can be used to resolve dynamic attributes
	expressions map[string]*vm.Program
}

func newAttributeExpressions(logger *zap.Logger, attr []config.CustomAttribute) *attributeExpressions {
	attrExprMap := make(map[string]*vm.Program)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.Expression != "" {
			prog, err := expr.CompileStringExpression(a.ValueFrom.Expression)
			if err != nil {
				logger.Error("failed to compile expression", zap.Error(err))
				continue
			}
			attrExprMap[a.Key] = prog
		}
	}

	return &attributeExpressions{
		logger:      logger,
		expressions: attrExprMap,
	}
}

func (r *attributeExpressions) expressionsAttributes(reqCtx *requestContext) []attribute.KeyValue {
	if reqCtx == nil {
		return nil
	}

	var result []attribute.KeyValue
	for exprKey, exprVal := range r.expressions {
		val, err := reqCtx.ResolveStringExpression(exprVal)
		if err != nil {
			r.logger.Error("failed to resolve expression", zap.Error(err))
			continue
		}
		result = append(result, attribute.String(exprKey, val))
	}

	return result
}
