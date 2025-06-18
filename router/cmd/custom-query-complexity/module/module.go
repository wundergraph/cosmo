package module

import (
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const myModuleID = "myModule"

type MyModule struct{}

func init() {
	// Register your module here
	core.RegisterModule(&MyModule{})
}

type PlanAnalyzer struct {
	SubgraphsContacted map[string]int
}

func NewPlanAnalyzer() *PlanAnalyzer {
	return &PlanAnalyzer{
		SubgraphsContacted: make(map[string]int),
	}
}

func (p *PlanAnalyzer) Analyze(plan *resolve.FetchTreeNode) {
	p.analyzePlanNode(plan)
}

func (p *PlanAnalyzer) TotalSubgraphsContacted() int {
	total := 0
	for _, count := range p.SubgraphsContacted {
		total += count
	}
	return total
}

func (p *PlanAnalyzer) analyzePlanNode(plan *resolve.FetchTreeNode) {
	switch plan.Kind {
	case resolve.FetchTreeNodeKindSingle:
		p.analyzeSingleFetch(plan)
	case resolve.FetchTreeNodeKindSequence, resolve.FetchTreeNodeKindParallel:
		for _, child := range plan.ChildNodes {
			p.analyzePlanNode(child)
		}
	}
}

func (p *PlanAnalyzer) analyzeSingleFetch(plan *resolve.FetchTreeNode) {
	key := plan.Item.Fetch.DataSourceInfo().Name

	if entry, ok := p.SubgraphsContacted[key]; ok {
		p.SubgraphsContacted[key] = entry + 1
	} else {
		p.SubgraphsContacted[key] = 1
	}
}

func (m *MyModule) Middleware(ctx core.RequestContext, next http.Handler) {
	qp := ctx.Operation().QueryPlan()

	analyzer := NewPlanAnalyzer()
	analyzer.Analyze(qp)

	fmt.Printf("subgraphs contacted: %v\n", analyzer.SubgraphsContacted)
	fmt.Printf("total subgraphs contacted: %d\n", analyzer.TotalSubgraphsContacted())

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
