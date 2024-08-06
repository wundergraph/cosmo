package core

import (
	stdContext "context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"sync"

	"github.com/pkg/errors"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"

	"go.uber.org/zap"
)

var (
	modules   = make(map[string]ModuleInfo)
	modulesMu sync.RWMutex
)

// ModuleRequestContext is the interface that provides the context for a single origin request.
type ModuleRequestContext interface {
	// RequestContext shared across all modules
	RequestContext
	// SendError returns the most recent error occurred while trying to make the origin request.
	SendError() error
}

type moduleRequestContext struct {
	*requestContext
	sendError error
}

// SendError returns the most recent error occurred while trying to make the origin request.
func (m *moduleRequestContext) SendError() error {
	return m.sendError
}

type ModuleID string

type ModuleInfo struct {
	// Name is the name of the module
	ID       ModuleID
	Priority int
	// New is the function that creates a new instance of the module
	New func() Module
}

type Module interface {
	Module() ModuleInfo
}

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

// sortModules sorts the modules by priority
func sortModules(modules map[string]ModuleInfo) []ModuleInfo {
	var moduleList []ModuleInfo
	for _, module := range modules {
		moduleList = append(moduleList, module)
	}

	sort.Slice(moduleList, func(x, y int) bool {
		priorityX := moduleList[x].Priority
		priorityY := moduleList[y].Priority
		leastPriority := math.MaxInt

		// If priority is 0, treat it as the lowest possible value
		if priorityX == 0 {
			priorityX = leastPriority
		}
		if priorityY == 0 {
			priorityY = leastPriority
		}

		return priorityX < priorityY
	})

	return moduleList
}

// Module Interfaces

// RouterMiddlewareHandler allows you to add a middleware to the router.
// The middleware is called for every request. It allows you to modify the request before it is processed by the router.
// The same semantics of http.Handler apply here. Don't manipulate / consume the body of the request unless
// you know what you are doing. If you consume the body of the request it will not be available for the next handler.
type RouterMiddlewareHandler interface {
	// Middleware is the middleware handler
	Middleware(ctx RequestContext, next http.Handler)
}

// EnginePreOriginHandler allows you to add a handler to the router engine origin requests.
// The handler is called before the request is sent to the origin. All origin handlers are called sequentially.
// It allows you to modify the request before it is sent or return a custom response. The same semantics of http.RoundTripper apply here.
// Don't manipulate / consume the body of the request unless you know what you are doing.
// If you consume the body of the request it will not be available for the next handler.
type EnginePreOriginHandler interface {
	// OnOriginRequest is called before the request is sent to the origin
	// Might be called multiple times if there are multiple origins
	OnOriginRequest(req *http.Request, ctx RequestContext) (*http.Request, *http.Response)
}

// EnginePostOriginHandler allows you to add a handler to the router engine origin requests.
// The handler is called after the response was received from the origin. All origin handlers are called sequentially.
// It allows you to return a custom response to the client. If your return nil as response, the next handler is called.
// The same semantics of http.RoundTripper apply here. In order to modify the response, you have to return a new response.
type EnginePostOriginHandler interface {
	// OnOriginResponse is called after the request is sent to the origin.
	// Might be called multiple times if there are multiple origins
	OnOriginResponse(resp *http.Response, ctx RequestContext) *http.Response
}

// Provisioner is called before the server starts
// It allows you to initialize your module e.g. create a database connection
// or load a configuration file
type Provisioner interface {
	// Provision is called before the server starts
	Provision(*ModuleContext) error
}

type Cleaner interface {
	// Cleanup is called after the server stops
	Cleanup() error
}

// ModuleContext is a type which defines the lifetime of modules that are registered with the router.
type ModuleContext struct {
	stdContext.Context
	Module Module
	Logger *zap.Logger
}

// WriteResponseError writes the given error as a GraphQL error response to the http.ResponseWriter
// associated with the given RequestContext. If err is nil, a generic "Internal Error" error is returned.
// Please never write errors directly to the http.ResponseWriter. The function takes care of logging and tracking
// the error in the underlying telemetry system.
func WriteResponseError(ctx RequestContext, err error) {
	var errs graphqlerrors.RequestErrors

	if err != nil {
		errs = graphqlerrors.RequestErrorsFromError(err)
	} else {
		errs = graphqlerrors.RequestErrorsFromError(errors.New("Internal Error"))
	}

	writeRequestErrors(ctx.Request(), ctx.ResponseWriter(), http.StatusInternalServerError, errs, ctx.Logger())
}
