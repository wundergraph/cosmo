package my_custom_module

import (
    "context"

    "github.com/wundergraph/cosmo/router/core"
    "go.uber.org/zap"
)

const myOverwriteResponseModuleID = "myOverwriteResponseModule"

type MyOverwriteResponseModule struct {
    
}

func (m *MyOverwriteResponseModule) MyModule() core.MyModuleInfo {
	return core.MyModuleInfo{
		ID: myOverwriteResponseModuleID,
		New: func() core.MyModule {
			return &MyOverwriteResponseModule{}
		},
	}
}

func (m *MyOverwriteResponseModule) Provision(ctx context.Context) error {    
	return nil
}
func (m *MyOverwriteResponseModule) Cleanup() error {
	return nil
}

func (m *MyOverwriteResponseModule) OnRouterRequest(reqContext core.RequestContext, params *core.RouterRequestParams) error {
    params.Logger.Info("Incoming /graphql request", zap.String("method", params.HttpRequest.Method))

    return nil
}

func (m *MyOverwriteResponseModule) OnRouterResponse(reqContext core.RequestContext, params *core.RouterResponseParams, exitErr *core.ExitError) error {
    status := params.Controller.GetStatusCode()
    params.Logger.Info("Outgoing /graphql response", zap.Int("status", status))
 
    params.Controller.SetStatusCode(202)
    params.Controller.SetBody([]byte(`{"error":"graphQL partial failure"}`))
    
    return nil
}

// Interface guard
var _ core.RouterLifecycleHook = (*MyOverwriteResponseModule)(nil)