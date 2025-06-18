package module

import (
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "myModule"

type MyModule struct{}

func init() {
	// Register your module here
	core.RegisterModule(&MyModule{})
}

func (m *MyModule) Middleware(ctx core.RequestContext, next http.Handler) {
	qps := ctx.Operation().QueryPlanStats()

	fmt.Printf("subgraphs contacted: %v\n", qps.SubgraphFetches)
	fmt.Printf("total subgraphs contacted: %d\n", qps.TotalSubgraphFetches)

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
)
