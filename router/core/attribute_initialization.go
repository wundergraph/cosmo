package core

import (
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func initializeAttributes(logger *zap.Logger, attrs []config.CustomAttribute, enableAttributeMapper bool) (mapper *attributeMapper, expressions *attributeExpressions, err error) {
	mapper = newAttributeMapper(enableAttributeMapper, attrs)
	expressions, err = newAttributeExpressions(logger, attrs)

	return
}
