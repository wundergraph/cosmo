package my_custom_module

import (
	"errors"
	"context"

	"github.com/wundergraph/cosmo/router/core"
)

const authorizationModuleID = "authorizationModule"

type AuthorizationModule struct {
}

func (m *AuthorizationModule) MyModule() core.MyModuleInfo {
	return core.MyModuleInfo{
		ID: authorizationModuleID,
		New: func() core.MyModule {
			return &AuthorizationModule{}
		},
	}
}

func (m *AuthorizationModule) Provision(ctx context.Context) error {
	return nil
}

func (m *AuthorizationModule) Cleanup() error {
	return nil
}

func (m *AuthorizationModule) OnRouterRequest(reqContext core.RequestContext, params *core.RouterRequestParams) error {
	return errors.New("{\"error\":\"unauthorized\"}")
}

// interface guard
var _ core.RouterRequestHook = (*AuthorizationModule)(nil)