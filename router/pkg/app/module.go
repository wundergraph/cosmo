package app

import (
	"context"
	"fmt"
	"net/http"
	"sync"
)

type ModuleID string

type ModuleInfo struct {
	// Name is the name of the module
	ID ModuleID
	// New is the function that creates a new instance of the module
	New func() Module
}

type Module interface {
	Module() ModuleInfo
}

var (
	modules   = make(map[string]ModuleInfo)
	modulesMu sync.RWMutex
)

func RegisterModule(instance Module) {
	mod := instance.Module()

	if mod.ID == "" {
		panic("module ID missing")
	}
	if val := mod.New(); val == nil {
		panic("ModuleInfo.New must return a non-nil module instance")
	}

	modulesMu.Lock()
	defer modulesMu.Unlock()

	if _, ok := modules[string(mod.ID)]; ok {
		panic(fmt.Sprintf("module already registered: %s", mod.ID))
	}
	modules[string(mod.ID)] = mod
}

// Module Interfaces

// RouterMiddlewareHandler allows you to add a middleware to the router.
// The middleware is called for every request. It allows you to modify the request before it is processed by the router.
// The same semantics of http.Handler apply here. Don't manipulate / consume the body of the request unless
// you know what you are doing. If you consume the body of the request it will not be available for the next handler.
type RouterMiddlewareHandler interface {
	// Middleware is the middleware handler
	Middleware(http.ResponseWriter, *http.Request, http.Handler)
}

// EnginePreOriginHandler allows you to add a handler to the router engine origin requests.
// The handler is called before the request is sent to the origin. All origin handlers are called sequentially.
// It allows you to modify the request before it is sent. The same semantics of http.RoundTripper apply here.
// Don't manipulate / consume the body of the request unless you know what you are doing.
// If you consume the body of the request it will not be available for the next handler.
type EnginePreOriginHandler interface {
	// OnOriginRequest is called before the request is sent to the origin
	// Might be called multiple times if there are multiple origins
	OnOriginRequest(*http.Request)
}

// EnginePostOriginHandler allows you to add a handler to the router engine origin requests.
// The handler is called after the response was received from the origin. All origin handlers are called sequentially.
// It allows you to return a custom response to the client. If your return nil as response, the next handler is called.
// The same semantics of http.RoundTripper apply here. In order to modify the response, you have to return a new response.

type EnginePostOriginHandler interface {
	// OnOriginResponse is called after the request is sent to the origin.
	// Might be called multiple times if there are multiple origins
	OnOriginResponse(*http.Response, *http.Request) (*http.Response, error)
}

// Provisioner is called before the server starts
// It allows you to initialize your module e.g. create a database connection
// or load a configuration file
type Provisioner interface {
	// Provision is called before the server starts
	Provision(context.Context) error
}

type Cleaner interface {
	// Cleanup is called after the server stops
	Cleanup(context.Context) error
}
