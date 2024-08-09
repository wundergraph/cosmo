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

	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
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

func (p *OperationPlanner) preparePlan(requestOperationName []byte, requestOperationContent string) (*planWithMetaData, error) {
	doc, report := astparser.ParseGraphqlDocumentString(requestOperationContent)
	if report.HasErrors() {
		return nil, &reportError{report: &report}
	}

	planner, err := plan.NewPlanner(p.executor.PlanConfig)
	if err != nil {
		return nil, err
	}

	// create and postprocess the plan
	// planning uses the router schema
	preparedPlan := planner.Plan(&doc, p.executor.RouterSchema, unsafebytes.BytesToString(requestOperationName), &report)
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

func (p *OperationPlanner) Plan(operation *ParsedOperation, clientInfo *ClientInfo, protocol OperationProtocol, traceOptions resolve.TraceOptions) (*operationContext, error) {

	opContext := &operationContext{
		name:                       operation.Request.OperationName,
		opType:                     operation.Type,
		content:                    operation.NormalizedRepresentation,
		hash:                       operation.ID,
		clientInfo:                 clientInfo,
		variables:                  operation.Request.Variables,
		files:                      operation.Files,
		traceOptions:               traceOptions,
		extensions:                 operation.Request.Extensions,
		protocol:                   protocol,
		persistedOperationCacheHit: operation.PersistedOperationCacheHit,
		normalizationCacheHit:      operation.NormalizationCacheHit,
	}

	if operation.IsPersistedOperation {
		opContext.persistedID = operation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash
	}

	if traceOptions.Enable {
		// if we have tracing enabled we always prepare a new plan
		// this is because we're writing trace data to the plan
		requestOperationNameBytes := unsafebytes.StringToBytes(opContext.Name())
		prepared, err := p.preparePlan(requestOperationNameBytes, opContext.Content())
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
			requestOperationNameBytes := unsafebytes.StringToBytes(opContext.Name())
			prepared, err := p.preparePlan(requestOperationNameBytes, opContext.Content())
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
