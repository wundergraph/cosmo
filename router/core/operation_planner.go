package core

import (
	"context"
	"errors"
	"strconv"

	"github.com/dgraph-io/ristretto"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"golang.org/x/sync/singleflight"
)

type planWithMetaData struct {
	preparedPlan    plan.Plan
	variables       []byte
	schemaUsageInfo plan.SchemaUsageInfo
}

type OperationPlanner struct {
	sf        singleflight.Group
	planCache *ristretto.Cache
	executor  *Executor
}

func NewOperationPlanner(executor *Executor, planCache *ristretto.Cache) *OperationPlanner {
	return &OperationPlanner{
		planCache: planCache,
		executor:  executor,
	}
}

func (p *OperationPlanner) preparePlan(requestOperationName []byte, requestOperationContent string) (planWithMetaData, error) {
	doc, report := astparser.ParseGraphqlDocumentString(requestOperationContent)
	if report.HasErrors() {
		return planWithMetaData{}, &reportError{report: &report}
	}

	validation := astvalidation.DefaultOperationValidator()

	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&doc, p.executor.Definition, &report)

	// validate the document before planning
	state := validation.Validate(&doc, p.executor.Definition, &report)
	if state != astvalidation.Valid {
		return planWithMetaData{}, &reportError{report: &report}
	}

	planner := plan.NewPlanner(context.Background(), p.executor.PlanConfig)

	// create and postprocess the plan
	preparedPlan := planner.Plan(&doc, p.executor.Definition, unsafebytes.BytesToString(requestOperationName), &report)
	if report.HasErrors() {
		return planWithMetaData{}, errors.Join(errMsgOperationParseFailed, report)
	}
	post := postprocess.DefaultProcessor()
	post.Process(preparedPlan)

	extractedVariables := make([]byte, len(doc.Input.Variables))
	copy(extractedVariables, doc.Input.Variables)

	schemaUsageInfo := plan.GetSchemaUsageInfo(preparedPlan)

	return planWithMetaData{
		preparedPlan:    preparedPlan,
		variables:       extractedVariables,
		schemaUsageInfo: schemaUsageInfo,
	}, nil
}

func (p *OperationPlanner) Plan(operation *ParsedOperation, clientInfo *ClientInfo) (*operationContext, error) {
	variablesCopy := make([]byte, len(operation.Variables))
	copy(variablesCopy, operation.Variables)

	opContext := &operationContext{
		name:       operation.Name,
		opType:     operation.Type,
		content:    operation.NormalizedRepresentation,
		hash:       operation.ID,
		variables:  variablesCopy,
		clientInfo: clientInfo,
	}

	operationID := opContext.Hash()
	// try to get a prepared plan for this operation ID from the cache
	cachedPlan, ok := p.planCache.Get(operationID)
	if ok && cachedPlan != nil {
		// re-use a prepared plan
		opContext.preparedPlan = cachedPlan.(*planWithMetaData)
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
			p.planCache.Set(operationID, &prepared, 1)
			return &prepared, nil
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
