package module

import (
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

func init() {
	// Register your module here
	core.RegisterModule(&MyModule{})
}

const myModuleID = "myModule"

// MyModule is a simple module that has access to the GraphQL operation and add a header to the response
// It demonstrates how to use the different handlers to customize the router.
// It also shows how to use the config file to configure and validate your module config.
// By default, the config file is located at `config.yaml` in the working directory of the router.
type MyModule struct {
	// Properties that are set by the config file are automatically populated based on the `mapstructure` tag
	// Create a new section under `modules.<name>` in the config file with the same name as your module.
	// Don't forget in Go the first letter of a property must be uppercase to be exported

	Value uint64 `mapstructure:"value"`

	Logger *zap.Logger
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	// Provision your module here, validate config etc.

	if m.Value == 0 {
		ctx.Logger.Error("Value must be greater than 0")
		return fmt.Errorf("value must be greater than 0")
	}

	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *MyModule) Cleanup() error {
	// Shutdown your module here, close connections etc.

	return nil
}

func (m *MyModule) OnOriginResponse(response *http.Response, ctx core.RequestContext) *http.Response {
	// Return a new response or nil if you want to pass it to the next handler
	// If you want to modify the response, return a new response

	// Access the custom value set in OnOriginRequest
	value := ctx.GetString("myValue")

	fmt.Println("SharedValue", value)

	fmt.Println("OnOriginResponse", response.Request.URL, response.StatusCode)

	return nil
}

func (m *MyModule) OnOriginRequest(request *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	// Return the modified request or nil if you want to pass it to the next handler
	// Return a new response if you want to abort the request and return a custom response

	// Set a header on all origin requests
	request.Header.Set("myHeader", ctx.GetString("myValue"))

	// Set a custom value on the request context. See OnOriginResponse
	ctx.Set("myValue", "myValue")

	return request, nil
}

func (m *MyModule) Middleware(ctx core.RequestContext, next http.Handler) {

	operation := ctx.Operation()

	// Access the GraphQL operation context
	fmt.Println(
		operation.Name(),
		operation.Type(),
		operation.Hash(),
		operation.Content(),
	)

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &MyModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*MyModule)(nil)
	_ core.EnginePreOriginHandler  = (*MyModule)(nil)
	_ core.EnginePostOriginHandler = (*MyModule)(nil)
	_ core.Provisioner             = (*MyModule)(nil)
	_ core.Cleaner                 = (*MyModule)(nil)
)
