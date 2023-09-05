package module

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/app"
	"github.com/wundergraph/cosmo/router/pkg/graphql"
	"net/http"
)

func init() {
	// Register your module here
	app.RegisterModule(&MyModule{})
}

const myModuleID = "myModule"

// MyModule is a simple module that adds a header to the response
type MyModule struct {
	// Properties that are set by the config file are automatically populated based on the `mapstructure` tag
	// Create a new section under `modules.<name>` in the config file `config.yaml` with the same name as your module.
	// Don't forget in go the first letter of a property must be uppercase to be exported

	Value uint64 `mapstructure:"value"`
}

func (m MyModule) Provision(ctx context.Context) error {
	// Provision your module here, validate config etc.

	return nil
}

func (m MyModule) Cleanup(ctx context.Context) error {
	// Shutdown your module here, close connections etc.

	return nil
}

func (m MyModule) OnOriginResponse(response *http.Response, request *http.Request) (*http.Response, error) {
	// Return a new response or nil if you want to pass it to the next handler
	// If you want to modify the response, return a new response
	// If you return an error, the request will be aborted and the response will exit with a 500 status code

	c := graphql.GetContext(request.Context())

	// Set a header on the client response
	c.ResponseHeader.Set("myHeader", c.GetString("myKey"))

	return nil, nil
}

func (m MyModule) OnOriginRequest(request *http.Request) {
	// Read the request or modify headers here

}

func (m MyModule) Middleware(w http.ResponseWriter, r *http.Request, next http.Handler) {
	c := graphql.GetContext(r.Context())

	// Share a value between different handlers
	c.Set("myKey", "myValue")

	// Access the operation context
	fmt.Println(
		c.Name,
		c.Type,
		c.OperationHash,
		c.Content,
	)

	// Call the next handler in the chain, pass the new context with the value
	// You can also stop the chain here and return a response by calling w.Write()
	next.ServeHTTP(w, r)
}

func (m MyModule) Module() app.ModuleInfo {
	return app.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
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
