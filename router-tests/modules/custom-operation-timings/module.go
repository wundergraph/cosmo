package custom_operation_timings

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "operationTimingsModule"

// OperationTimingsModule is a simple module that reads and logs the operation timings
type OperationTimingsModule struct {
	ResultsChan chan core.OperationTimings
}

func (m *OperationTimingsModule) Middleware(ctx core.RequestContext, next http.Handler) {
	timings := ctx.Operation().Timings()

	if m.ResultsChan != nil {
		select {
		case m.ResultsChan <- timings:
		default:
			// drop if nobody is listening to avoid blocking the request path
		}
	}

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *OperationTimingsModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &OperationTimingsModule{
				ResultsChan: make(chan core.OperationTimings),
			}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*OperationTimingsModule)(nil)
)
