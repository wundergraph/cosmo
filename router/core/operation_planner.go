package core

import (
	"errors"
	"strconv"

	"golang.org/x/sync/singleflight"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/pkg/graphqlschemausage"
)

type planWithMetaData struct {
	preparedPlan                      plan.Plan
	operationDocument, schemaDocument *ast.Document
	typeFieldUsageInfo                []*graphqlschemausage.TypeFieldUsageInfo
	argumentUsageInfo                 []*graphqlmetricsv1.ArgumentUsageInfo
}

type OperationPlanner struct {
	sf             singleflight.Group
	planCache      ExecutionPlanCache[uint64, *planWithMetaData]
	executor       *Executor
	trackUsageInfo bool
}

type ExecutionPlanCache[K any, V any] interface {
	// Get the value from the cache
	Get(key K) (V, bool)
	// Set the value in the cache with a cost. The cost depends on the cache implementation
	Set(key K, value V, cost int64) bool
	// Close the cache and free resources
	Close()
}

func NewOperationPlanner(executor *Executor, planCache ExecutionPlanCache[uint64, *planWithMetaData]) *OperationPlanner {
	return &OperationPlanner{
		planCache:      planCache,
		executor:       executor,
		trackUsageInfo: executor.TrackUsageInfo,
	}
}

func (p *OperationPlanner) preparePlan(ctx *operationContext) (*planWithMetaData, error) {
	doc, report := astparser.ParseGraphqlDocumentString(ctx.content)
	if report.HasErrors() {
		return nil, &reportError{report: &report}
	}

	planner, err := plan.NewPlanner(p.executor.PlanConfig)
	if err != nil {
		return nil, err
	}

	var (
		preparedPlan plan.Plan
	)

	// create and postprocess the plan
	// planning uses the router schema
	if ctx.executionOptions.IncludeQueryPlanInResponse {
		preparedPlan = planner.Plan(&doc, p.executor.RouterSchema, ctx.name, &report, plan.IncludeQueryPlanInResponse())
	} else {
		preparedPlan = planner.Plan(&doc, p.executor.RouterSchema, ctx.name, &report)
	}
	if report.HasErrors() {
		return nil, &reportError{report: &report}
	}
	post := postprocess.NewProcessor(postprocess.CollectDataSourceInfo())
	post.Process(preparedPlan)

	out := &planWithMetaData{
		preparedPlan:      preparedPlan,
		operationDocument: &doc,
		schemaDocument:    p.executor.RouterSchema,
	}

	if p.trackUsageInfo {
		out.typeFieldUsageInfo = graphqlschemausage.GetTypeFieldUsageInfo(preparedPlan)
		out.argumentUsageInfo, err = graphqlschemausage.GetArgumentUsageInfo(&doc, p.executor.RouterSchema)
		if err != nil {
			return nil, err
		}
	}

	return out, nil
}

type PlanOptions struct {
	ClientInfo           *ClientInfo
	TraceOptions         resolve.TraceOptions
	ExecutionOptions     resolve.ExecutionOptions
	TrackSchemaUsageInfo bool
}

func (p *OperationPlanner) plan(opContext *operationContext, options PlanOptions) (err error) {
	// if we have tracing enabled or want to include a query plan in the response we always prepare a new plan
	// this is because in case of tracing, we're writing trace data to the plan
	// in case of including the query plan, we don't want to cache this additional overhead
	skipCache := options.TraceOptions.Enable || options.ExecutionOptions.IncludeQueryPlanInResponse

	if skipCache {
		prepared, err := p.preparePlan(opContext)
		if err != nil {
			return err
		}
		opContext.preparedPlan = prepared
		if options.TrackSchemaUsageInfo {
			opContext.typeFieldUsageInfo = prepared.typeFieldUsageInfo
			opContext.argumentUsageInfo = prepared.argumentUsageInfo
			opContext.inputUsageInfo, err = graphqlschemausage.GetInputUsageInfo(prepared.operationDocument, p.executor.RouterSchema, opContext.variables)
			if err != nil {
				return err
			}
		}
		return nil
	}

	operationID := opContext.internalHash
	// try to get a prepared plan for this operation ID from the cache
	cachedPlan, ok := p.planCache.Get(operationID)
	if ok && cachedPlan != nil {
		// re-use a prepared plan
		opContext.preparedPlan = cachedPlan
		opContext.planCacheHit = true
	} else {
		// prepare a new plan using single flight
		// this ensures that we only prepare the plan once for this operation ID
		operationIDStr := strconv.FormatUint(operationID, 10)
		sharedPreparedPlan, err, _ := p.sf.Do(operationIDStr, func() (interface{}, error) {
			prepared, err := p.preparePlan(opContext)
			if err != nil {
				return nil, err
			}
			p.planCache.Set(operationID, prepared, 1)
			return prepared, nil
		})
		if err != nil {
			return err
		}
		opContext.preparedPlan, ok = sharedPreparedPlan.(*planWithMetaData)
		if !ok {
			return errors.New("unexpected prepared plan type")
		}
	}
	if options.TrackSchemaUsageInfo {
		opContext.typeFieldUsageInfo = opContext.preparedPlan.typeFieldUsageInfo
		opContext.argumentUsageInfo = opContext.preparedPlan.argumentUsageInfo
		opContext.inputUsageInfo, err = graphqlschemausage.GetInputUsageInfo(opContext.preparedPlan.operationDocument, p.executor.RouterSchema, opContext.variables)
		if err != nil {
			return err
		}
	}

	return nil
}
