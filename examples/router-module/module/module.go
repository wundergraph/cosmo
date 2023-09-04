package module

import (
	"context"
	"github.com/wundergraph/cosmo/router/pkg/app"
	"net/http"
)

func init() {
	// Register your module here
	app.RegisterModule(&MyModule{})
}

// MyModule is a simple module that adds a header to the response
type MyModule struct {
	// Properties that are set by the config file are automatically populated
	// Create a new section under `modules.<name>` in the config file `config.yaml` with the same name as your module
	// Don't forget in go the first letter of a property must be uppercase to be exported

	Value uint64 `mapstructure:"value"`
}

func (m MyModule) Provision(ctx context.Context) error {
	// Provision your module here, validate config etc.

	return nil
}

func (m MyModule) Cleanup(ctx context.Context) error {
	// Shutdown your module here

	return nil
}

func (m MyModule) OnOriginResponse(response *http.Response, request *http.Request) (*http.Response, error) {
	// Return the response or nil if you want to pass it to the next handler
	// If you want to modify the response, return a new response
	// If you return an error, the request will be aborted and the error will be returned to the client

	return nil, nil
}

func (m MyModule) OnOriginRequest(request *http.Request) {
	// Manipulate the request here
}

func (m MyModule) Middleware(writer http.ResponseWriter, request *http.Request, next http.Handler) {
	// Manipulate the response here or pass it to the next handler

	next.ServeHTTP(writer, request)
}

func (m MyModule) Module() app.ModuleInfo {
	return app.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: "myModule",
		New: func() app.Module {
			return MyModule{}
		},
	}
}

// Interface guard
var (
	_ app.RouterMiddlewareHandler = (*MyModule)(nil)
	_ app.EnginePreOriginHandler  = (*MyModule)(nil)
	_ app.EnginePostOriginHandler = (*MyModule)(nil)
	_ app.Provisioner             = (*MyModule)(nil)
	_ app.Cleaner                 = (*MyModule)(nil)
)
