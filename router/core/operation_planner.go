package core

import (
	"errors"
	"strconv"
	"time"

	"golang.org/x/sync/singleflight"

	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/pkg/graphqlschemausage"
	"github.com/wundergraph/cosmo/router/pkg/slowplancache"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type planWithMetaData struct {
	preparedPlan                      plan.Plan
	operationDocument, schemaDocument *ast.Document
	typeFieldUsageInfo                []*graphqlschemausage.TypeFieldUsageInfo
	argumentUsageInfo                 []*graphqlmetricsv1.ArgumentUsageInfo
	content                           string
	operationName                     string
	planningDuration                  time.Duration
}

type OperationPlanner struct {
	sf             singleflight.Group
	planCache      ExecutionPlanCache[uint64, *planWithMetaData]
	slowPlanCache  *slowplancache.Cache[*planWithMetaData]
	executor       *Executor
	trackUsageInfo bool

	// planningDurationOverride, when set, replaces the measured planning duration.
	// This is used in tests to simulate slow queries.
	planningDurationOverride func(content string) time.Duration
}

type operationPlannerOpts struct {
	operationContent bool
}

type ExecutionPlanCache[K any, V any] interface {
	// Get the value from the cache
	Get(key K) (V, bool)
	// Set the value in the cache with a cost. The cost depends on the cache implementation
	Set(key K, value V, cost int64) bool
	// Iterate over all items in the cache (non-deterministic)
	IterValues(cb func(v V) (stop bool))
	// Close the cache and free resources
	Close()
}

func NewOperationPlanner(
	executor *Executor,
	planCache ExecutionPlanCache[uint64, *planWithMetaData],
	fallbackCache *slowplancache.Cache[*planWithMetaData],
	planningDurationOverride func(content string) time.Duration,
) *OperationPlanner {
	return &OperationPlanner{
		planCache:                planCache,
		executor:                 executor,
		trackUsageInfo:           executor.TrackUsageInfo,
		slowPlanCache:            fallbackCache,
		planningDurationOverride: planningDurationOverride,
	}
}

// planOperation performs the core planning work: parse, plan, and postprocess.
func (p *OperationPlanner) planOperation(content string, name string, includeQueryPlan bool) (*planWithMetaData, error) {
	doc, report := astparser.ParseGraphqlDocumentString(content)
	if report.HasErrors() {
		return nil, &reportError{report: &report}
	}

	planner, err := plan.NewPlanner(p.executor.PlanConfig)
	if err != nil {
		return nil, err
	}

	var preparedPlan plan.Plan
	if includeQueryPlan {
		preparedPlan = planner.Plan(&doc, p.executor.RouterSchema, name, &report, plan.IncludeQueryPlanInResponse())
	} else {
		preparedPlan = planner.Plan(&doc, p.executor.RouterSchema, name, &report)
	}
	if report.HasErrors() {
		return nil, &reportError{report: &report}
	}
	post := postprocess.NewProcessor(postprocess.CollectDataSourceInfo())
	post.Process(preparedPlan)

	return &planWithMetaData{
		preparedPlan:      preparedPlan,
		operationDocument: &doc,
		schemaDocument:    p.executor.RouterSchema,
	}, nil
}

func (p *OperationPlanner) preparePlan(ctx *operationContext, opts operationPlannerOpts) (*planWithMetaData, error) {
	out, err := p.planOperation(ctx.content, ctx.name, ctx.executionOptions.IncludeQueryPlanInResponse)
	if err != nil {
		return nil, err
	}

	out.operationName = ctx.name

	if opts.operationContent {
		out.content = ctx.Content()
	}

	if p.trackUsageInfo {
		out.typeFieldUsageInfo = graphqlschemausage.GetTypeFieldUsageInfo(out.preparedPlan)
		out.argumentUsageInfo, err = graphqlschemausage.GetArgumentUsageInfo(out.operationDocument, p.executor.RouterSchema, ctx.variables, out.preparedPlan, ctx.remapVariables)
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

	// Store plan config regardless of cache to enable costs calculation.
	opContext.planConfig = p.executor.PlanConfig

	if skipCache {
		prepared, err := p.preparePlan(opContext, operationPlannerOpts{operationContent: false})
		if err != nil {
			return err
		}
		opContext.preparedPlan = prepared
		if options.TrackSchemaUsageInfo {
			opContext.typeFieldUsageInfo = prepared.typeFieldUsageInfo
			opContext.argumentUsageInfo = prepared.argumentUsageInfo
			opContext.inputUsageInfo, err = graphqlschemausage.GetInputUsageInfo(prepared.operationDocument, p.executor.RouterSchema, opContext.variables, prepared.preparedPlan, opContext.remapVariables)
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
		// re-use a prepared plan from the main cache
		opContext.preparedPlan = cachedPlan
		opContext.planCacheHit = true
	} else if p.slowPlanCache != nil {
		if cachedPlan, ok = p.slowPlanCache.Get(operationID); ok {
			// found in the plan fallback cache — re-use and re-insert into main cache
			opContext.preparedPlan = cachedPlan
			opContext.planCacheHit = true
			p.planCache.Set(operationID, cachedPlan, 1)
		}
	}

	if opContext.preparedPlan == nil {
		// prepare a new plan using single flight
		// this ensures that we only prepare the plan once for this operation ID
		operationIDStr := strconv.FormatUint(operationID, 10)
		sharedPreparedPlan, err, _ := p.sf.Do(operationIDStr, func() (interface{}, error) {
			start := time.Now()
			prepared, err := p.preparePlan(opContext, operationPlannerOpts{operationContent: p.slowPlanCache != nil})
			if err != nil {
				return nil, err
			}
			prepared.planningDuration = time.Since(start)

			// This is only used for test cases
			if p.planningDurationOverride != nil {
				prepared.planningDuration = p.planningDurationOverride(prepared.content)
			}

			// Set into the main cache after planningDuration is finalized,
			// because the OnEvict callback reads planningDuration concurrently.
			p.planCache.Set(operationID, prepared, 1)
			p.slowPlanCache.Set(operationID, prepared, prepared.planningDuration)

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
		opContext.inputUsageInfo, err = graphqlschemausage.GetInputUsageInfo(opContext.preparedPlan.operationDocument, p.executor.RouterSchema, opContext.variables, opContext.preparedPlan.preparedPlan, opContext.remapVariables)
		if err != nil {
			return err
		}
	}

	return nil
}
