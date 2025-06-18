package module

import (
	"fmt"
	"net/http"

	"github.com/sanity-io/litter"
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

func (p *PlanAnalyzer) Analyze(plan *resolve.FetchTreeQueryPlanNode) {
	p.analyzePlanNode(plan)
}

func (p *PlanAnalyzer) TotalSubgraphsContacted() int {
	total := 0
	for _, count := range p.SubgraphsContacted {
		total += count
	}
	return total
}

func (p *PlanAnalyzer) analyzePlanNode(plan *resolve.FetchTreeQueryPlanNode) {
	switch plan.Kind {
	case resolve.FetchTreeNodeKindSingle:
		p.analyzeSingleFetch(plan)
	case resolve.FetchTreeNodeKindSequence, resolve.FetchTreeNodeKindParallel:
		for _, child := range plan.Children {
			p.analyzePlanNode(child)
		}
	}
}

func (p *PlanAnalyzer) analyzeSingleFetch(plan *resolve.FetchTreeQueryPlanNode) {
	if entry, ok := p.SubgraphsContacted[plan.Fetch.SubgraphName]; ok {
		p.SubgraphsContacted[plan.Fetch.SubgraphName] = entry + 1
	} else {
		p.SubgraphsContacted[plan.Fetch.SubgraphName] = 1
	}
}

func (m *MyModule) Middleware(ctx core.RequestContext, next http.Handler) {
	qp := ctx.Operation().QueryPlan()

	analyzer := NewPlanAnalyzer()
	analyzer.Analyze(qp)

	litter.Dump("subgraphs contacted", analyzer.SubgraphsContacted)
	litter.Dump("total subgraphs contacted", analyzer.TotalSubgraphsContacted())

	fmt.Println(qp.PrettyPrint())

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
