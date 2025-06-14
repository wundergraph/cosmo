package my_custom_module

import (
	"context"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const metricsModuleID = "metricsModule"

type MetricsModule struct {
}

func (m *MetricsModule) MyModule() core.MyModuleInfo {
	return core.MyModuleInfo{
		ID: metricsModuleID,
		New: func() core.MyModule {
			return &MetricsModule{}
		},
	}
}

func (m *MetricsModule) Provision(ctx context.Context) error {
	return nil
}

func (m *MetricsModule) Cleanup() error {
	return nil
}

func (m *MetricsModule) OnOperationPreParse(reqContext core.RequestContext, params *core.OperationPreParseParams) error {
	params.Logger.Info("OnOperationPreParse", zap.Any("params", params))
	params.Controller.SetSkipParse(false)
	return nil
}

func (m *MetricsModule) OnOperationPostParse(reqContext core.RequestContext, params *core.OperationPostParseParams, exitError *core.ExitError) error {
	params.Logger.Info("OnOperationPostParse", zap.Any("params", params))

	return nil
}

func (m *MetricsModule) OnOperationPreNormalize(reqContext core.RequestContext, params *core.OperationPreNormalizeParams) error {	 
	params.Logger.Info("OnOperationPreNormalize", zap.Any("params", params))
	return nil
}

func (m *MetricsModule) OnOperationPostNormalize(reqContext core.RequestContext, params *core.OperationPostNormalizeParams, exitError *core.ExitError) error {
	params.Logger.Info("OnOperationPostNormalize", zap.Any("params", params))
	return nil
}

func (m *MetricsModule) OnOperationPreValidate(reqContext core.RequestContext, params *core.OperationPreValidateParams) error {
	params.Logger.Info("OnOperationPreValidate", zap.Any("params", params))

	return nil
}

func (m *MetricsModule) OnOperationPostValidate(reqContext core.RequestContext, params *core.OperationPostValidateParams, exitError *core.ExitError) error {
	params.Logger.Info("OnOperationPostValidate", zap.Any("params", params))
	return nil
}

func (m *MetricsModule) OnOperationPrePlan(reqContext core.RequestContext, params *core.OperationPrePlanParams) error {
	params.Logger.Info("OnOperationPrePlan", zap.Any("params", params))
	return nil
}

func (m *MetricsModule) OnOperationPostPlan(reqContext core.RequestContext, params *core.OperationPostPlanParams, exitError *core.ExitError) error {
	params.Logger.Info("OnOperationPostPlan", zap.Any("params", params))
	return nil
}

// interface guard
var _ core.OperationParseLifecycleHook = &MetricsModule{}
var _ core.OperationNormalizeLifecycleHook = &MetricsModule{}
var _ core.OperationValidateLifecycleHook = &MetricsModule{}
var _ core.OperationPlanLifecycleHook = &MetricsModule{}