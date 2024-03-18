package core

import (
	"errors"
	"strconv"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"golang.org/x/sync/singleflight"

	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
)

type planWithMetaData struct {
	preparedPlan                      plan.Plan
	operationDocument, schemaDocument *ast.Document
}

type OperationPlanner struct {
	sf        singleflight.Group
	planCache ExecutionPlanCache
	executor  *Executor
}

type ExecutionPlanCache interface {
	Get(key interface{}) (interface{}, bool)
	Set(key, value interface{}, cost int64) bool
}

func NewNoopExecutionPlanCache() ExecutionPlanCache {
	return &noopExecutionPlanCache{}
}

type noopExecutionPlanCache struct{}

func (n *noopExecutionPlanCache) Get(key interface{}) (interface{}, bool) {
	return nil, false
}

func (n *noopExecutionPlanCache) Set(key, value interface{}, cost int64) bool {
	return true
}

func NewOperationPlanner(executor *Executor, planCache ExecutionPlanCache) *OperationPlanner {
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

	validation := astvalidation.DefaultOperationValidator()

	// validate the document before planning
	state := validation.Validate(&doc, p.executor.Definition, &report)
	if state != astvalidation.Valid {
		return nil, &reportError{report: &report}
	}

	planner, err := plan.NewPlanner(p.executor.PlanConfig)
	if err != nil {
		return nil, err
	}

	// create and postprocess the plan
	preparedPlan := planner.Plan(&doc, p.executor.Definition, unsafebytes.BytesToString(requestOperationName), &report)
	if report.HasErrors() {
		return nil, &reportError{report: &report}
	}
	post := postprocess.DefaultProcessor()
	post.Process(preparedPlan)

	return &planWithMetaData{
		preparedPlan:      preparedPlan,
		operationDocument: &doc,
		schemaDocument:    p.executor.Definition,
	}, nil
}

func (p *OperationPlanner) Plan(operation *ParsedOperation, clientInfo *ClientInfo, protocol OperationProtocol, traceOptions resolve.TraceOptions) (*operationContext, error) {

	opContext := &operationContext{
		name:         operation.Name,
		opType:       operation.Type,
		content:      operation.NormalizedRepresentation,
		hash:         operation.ID,
		clientInfo:   clientInfo,
		variables:    operation.Variables,
		files:        operation.Files,
		traceOptions: traceOptions,
		extensions:   operation.Extensions,
		persistedID:  operation.PersistedID,
		protocol:     protocol,
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
		opContext.preparedPlan = cachedPlan.(*planWithMetaData)
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
