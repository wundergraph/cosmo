package my_custom_module

import (
	"context"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const detailedClientModuleID = "detailedClientModule"

type DetailedClientModule struct {}


func (m *DetailedClientModule) MyModule() core.MyModuleInfo {
	return core.MyModuleInfo{
		ID: detailedClientModuleID,
		New: func() core.MyModule {
			return &DetailedClientModule{}
		},
	}
}

func (m *DetailedClientModule) Provision(ctx context.Context) error {
	return nil
}

func (m *DetailedClientModule) Cleanup() error {
	return nil
}

func (m *DetailedClientModule) OnOperationRequest(reqContext core.RequestContext, params *core.OperationRequestParams) error {
	params.Logger.Info("OnOperationRequest")
	detailedClientInfo := DetailedClientInfo{
		Name:    "detailed-client",
		Version: "1.0.0",

		DeviceOS: "iOS",
		AppName: "My App",
	}
	params.Controller.SetClientInfo(&detailedClientInfo)
	return nil
}

func (m *DetailedClientModule) OnOperationResponse(reqContext core.RequestContext, params *core.OperationResponseParams, exitError *core.ExitError) error {
	params.Logger.Info("OnOperationResponse", zap.Any("clientInfo", reqContext.Operation().ClientInfo()))
	return nil
}

type DetailedClientInfo struct {
	Name    string
	Version string

	WGRequestToken string

	DeviceOS string
	AppName string
}

func (c *DetailedClientInfo) GetWGRequestToken() string {
	return c.WGRequestToken
}

func (c *DetailedClientInfo) GetName() string {	
	return c.Name
}

func (c *DetailedClientInfo) SetName(name string) {
	c.Name = name
}

func (c *DetailedClientInfo) SetVersion(version string) {
	c.Version = version
}

func (c *DetailedClientInfo) GetVersion() string {
	return c.Version
}

// interface guard
var _ core.OperationRequestLifecycleHook = &DetailedClientModule{}