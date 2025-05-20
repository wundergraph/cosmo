package module

import (
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
	"github.corp.ebay.com/security-platform/pfsecapi"
	"github.corp.ebay.com/security-platform/pfsecapi/trustfabric"
	"go.uber.org/zap"
)

func init() {
	fmt.Println("=====tokenFilterModule=====")
	// Register your module here and it will be loaded at router start
	core.RegisterModule(&TFModule{})
}

type TFModule struct{}

func (m *TFModule) OnOriginRequest(request *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	// Return the modified request or nil if you want to pass it to the next handler
	// Return a new response if you want to abort the request and return a custom response

	requestLogger := ctx.Logger()
	fmt.Println("&&&&&&&&&&&&&start tfToken&&&&&&&&&&&&&&")

	requestLogger.Info("&&&&&&&&&&&&&start tfToken&&&&&&&&&&&&&&")
	// Set a header on all origin requests
	var tfClient trustfabric.TrustFabricClient
	_, _, _, tfClient = pfsecapi.NewClients()

	if tfClient != nil {
		// todo: scope
		scopes := "gtrval"
		tfToken, err := tfClient.GetTokenWithScopes(scopes)

		requestLogger.Info("&&&&&&&&&&&&I am in requestLogger tfToken&&&&&&&&&&&&", zap.String("tfToken", tfToken))

		if err != nil {
			requestLogger.Info("&&&&&&&&&&&&I am in requestLogger err&&&&&&&&&&&&", zap.Error(err))
		} else {
			request.Header.Set("X-EBAY-TF-AUTHORIZATION", "Bearer "+tfToken)
		}
	}

	// Set a custom value on the request context. See OnOriginResponse
	//ctx.Set("myValue", "myValue")

	return request, nil
}

func (m *TFModule) Middleware(ctx core.RequestContext, next http.Handler) {

	operation := ctx.Operation()

	// Access the GraphQL operation context
	fmt.Println(
		operation.Name(),
		operation.Type(),
		operation.Hash(),
		operation.Content(),
	)

	// Call the next handler in the chain or
	// return early by calling ctx.ResponseWriter().Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *TFModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: "tfFilterModule",
		// The priority of your module, lower the number higher the priority
		// Value should be > 0
		Priority: 1,
		New: func() core.Module {
			return &TFModule{}
		},
	}
}

// Interface guards
// In words: My Module has to implement the following interfaces
// otherwise it will not compile
// Interface guard
var (
	//_ core.RouterMiddlewareHandler = (*MyModule)(nil)
	//_ core.RouterOnRequestHandler  = (*MyModule)(nil)
	_ core.EnginePreOriginHandler = (*TFModule)(nil)
	//_ core.EnginePostOriginHandler = (*MyModule)(nil)
	//_ core.Provisioner             = (*MyModule)(nil)
	//_ core.Cleaner                 = (*MyModule)(nil)
)
