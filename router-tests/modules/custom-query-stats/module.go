package custom_query_plans

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "queryStatsModule"

// QueryStatsModule is a simple module that reads and logs the query plan stats
type QueryStatsModule struct {
	ResultsChan chan core.QueryPlanStats
}

func (m *QueryStatsModule) Middleware(ctx core.RequestContext, next http.Handler) {
	qps, err := ctx.Operation().QueryPlanStats()
	if err != nil {
		panic(err)
	}

	m.ResultsChan <- qps

	// Call the next handler in the chain or return early by calling w.Write()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *QueryStatsModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &QueryStatsModule{
				ResultsChan: make(chan core.QueryPlanStats),
			}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*QueryStatsModule)(nil)
)
