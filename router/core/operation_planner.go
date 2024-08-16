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
)

type planWithMetaData struct {
	preparedPlan                      plan.Plan
	operationDocument, schemaDocument *ast.Document
}

type OperationPlanner struct {
	sf        singleflight.Group
	planCache ExecutionPlanCache[uint64, *planWithMetaData]
	executor  *Executor
}

type ExecutionPlanCache[K any, V any] interface {
	// Get the value from the cache
	Get(key K) (V, bool)
	// Set the value in the cache with a cost. The cost depends on the cache implementation
	Set(key K, value V, cost int64) bool
	// Close the cache and free resources
	Close()
}

func NewNoopExecutionPlanCache() ExecutionPlanCache[uint64, *planWithMetaData] {
	return &noopExecutionPlanCache{}
}

type noopExecutionPlanCache struct{}

func (n *noopExecutionPlanCache) Close() {}

func (n *noopExecutionPlanCache) Get(key uint64) (*planWithMetaData, bool) {
	return nil, false
}

func (n *noopExecutionPlanCache) Set(key uint64, value *planWithMetaData, cost int64) bool {
	return true
}

func NewOperationPlanner(executor *Executor, planCache ExecutionPlanCache[uint64, *planWithMetaData]) *OperationPlanner {
	return &OperationPlanner{
		planCache: planCache,
		executor:  executor,
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
	post := postprocess.NewProcessor()
	post.Process(preparedPlan)

	return &planWithMetaData{
		preparedPlan:      preparedPlan,
		operationDocument: &doc,
		schemaDocument:    p.executor.RouterSchema,
	}, nil
}

type PlanOptions struct {
	Protocol         OperationProtocol
	ClientInfo       *ClientInfo
	TraceOptions     resolve.TraceOptions
	ExecutionOptions resolve.ExecutionOptions
}

func (p *OperationPlanner) plan(operation *ParsedOperation, options PlanOptions) (*operationContext, error) {
	opContext := &operationContext{
		name:                       operation.Request.OperationName,
		opType:                     operation.Type,
		content:                    operation.NormalizedRepresentation,
		hash:                       operation.ID,
		clientInfo:                 *options.ClientInfo,
		variables:                  operation.Request.Variables,
		files:                      operation.Files,
		traceOptions:               options.TraceOptions,
		extensions:                 operation.Request.Extensions,
		protocol:                   options.Protocol,
		persistedOperationCacheHit: operation.PersistedOperationCacheHit,
		normalizationCacheHit:      operation.NormalizationCacheHit,
		executionOptions:           options.ExecutionOptions,
	}

	if operation.IsPersistedOperation {
		opContext.persistedID = operation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash
	}

	// if we have tracing enabled or want to include a query plan in the response we always prepare a new plan
	// this is because in case of tracing, we're writing trace data to the plan
	// in case of including the query plan, we don't want to cache this additional overhead
	skipCache := options.TraceOptions.Enable || options.ExecutionOptions.IncludeQueryPlanInResponse

	if skipCache {
		prepared, err := p.preparePlan(opContext)
		if err != nil {
			return nil, err
		}
		opContext.preparedPlan = prepared
		return opContext, nil
	}

	operationID := opContext.Hash()
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
			return nil, err
		}
		opContext.preparedPlan, ok = sharedPreparedPlan.(*planWithMetaData)
		if !ok {
			return nil, errors.New("unexpected prepared plan type")
		}
	}
	return opContext, nil
}
