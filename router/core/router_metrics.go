package core

import (
	"strconv"

	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

// RouterMetrics encapsulates all data and configuration that the router
// uses to collect and its metrics
type RouterMetrics struct {
	metrics             metric.Store
	gqlMetricsExporter  *graphqlmetrics.Exporter
	routerConfigVersion string
	logger              *zap.Logger
}

// StartOperation starts the metrics for a new GraphQL operation. The returned value is a OperationMetrics
// where the caller must always call Finish() (usually via defer()). If the metrics are disabled, this
// returns nil, but OperationMetrics is safe to call with a nil receiver.
func (m *RouterMetrics) StartOperation(clientInfo *ClientInfo, logger *zap.Logger, requestContentLength int64) *OperationMetrics {
	if m == nil || m.metrics == nil {
		// Return a nil OperationMetrics, which will be a no-op, to simplify callers
		return nil
	}
	metrics := startOperationMetrics(m.metrics, logger, requestContentLength, m.gqlMetricsExporter, m.routerConfigVersion)
	if clientInfo != nil {
		metrics.AddClientInfo(clientInfo)
	}
	return metrics
}

func NewRouterMetrics(metrics metric.Store, gqlMetrics *graphqlmetrics.Exporter, configVersion string, logger *zap.Logger) *RouterMetrics {
	return &RouterMetrics{
		metrics:             metrics,
		gqlMetricsExporter:  gqlMetrics,
		routerConfigVersion: configVersion,
		logger:              logger,
	}
}

func (m *RouterMetrics) ExportSchemaUsageInfo(operationContext *operationContext, statusCode int, hasError bool) {
	if m.gqlMetricsExporter == nil {
		return
	}

	usageInfo, err := plan.GetSchemaUsageInfo(
		operationContext.preparedPlan.preparedPlan,
		operationContext.preparedPlan.operationDocument,
		operationContext.preparedPlan.schemaDocument,
		operationContext.Variables(),
	)
	if err != nil {
		m.logger.Error("failed to get schema usage info", zap.Error(err))
		return
	}

	fieldUsageInfos := make([]*graphqlmetricsv1.TypeFieldUsageInfo, len(usageInfo.TypeFields))
	argumentUsageInfos := make([]*graphqlmetricsv1.ArgumentUsageInfo, len(usageInfo.Arguments))
	inputUsageInfos := make([]*graphqlmetricsv1.InputUsageInfo, len(usageInfo.InputTypeFields))

	for i := range usageInfo.TypeFields {
		fieldUsageInfos[i] = &graphqlmetricsv1.TypeFieldUsageInfo{
			Count:       1,
			Path:        usageInfo.TypeFields[i].Path,
			TypeNames:   usageInfo.TypeFields[i].EnclosingTypeNames,
			SubgraphIDs: usageInfo.TypeFields[i].Source.IDs,
			NamedType:   usageInfo.TypeFields[i].FieldTypeName,
		}
	}

	for i := range usageInfo.Arguments {
		argumentUsageInfos[i] = &graphqlmetricsv1.ArgumentUsageInfo{
			Count:     1,
			Path:      []string{usageInfo.Arguments[i].FieldName, usageInfo.Arguments[i].ArgumentName},
			TypeName:  usageInfo.Arguments[i].EnclosingTypeName,
			NamedType: usageInfo.Arguments[i].ArgumentTypeName,
		}
	}

	for i := range usageInfo.InputTypeFields {
		// In that case it is a top level input field usage e.g employee(id: 1)
		if len(usageInfo.InputTypeFields[i].EnclosingTypeNames) == 0 {
			inputUsageInfos[i] = &graphqlmetricsv1.InputUsageInfo{
				Count:     uint64(usageInfo.InputTypeFields[i].Count),
				NamedType: usageInfo.InputTypeFields[i].FieldTypeName,
				// Root input fields have no enclosing type name and no path
			}
		} else {
			inputUsageInfos[i] = &graphqlmetricsv1.InputUsageInfo{
				Path:      []string{usageInfo.InputTypeFields[i].EnclosingTypeNames[0], usageInfo.InputTypeFields[i].FieldName},
				Count:     uint64(usageInfo.InputTypeFields[i].Count),
				TypeName:  usageInfo.InputTypeFields[i].EnclosingTypeNames[0],
				NamedType: usageInfo.InputTypeFields[i].FieldTypeName,
			}
		}
	}

	var opType graphqlmetricsv1.OperationType
	switch operationContext.opType {
	case "query":
		opType = graphqlmetricsv1.OperationType_QUERY
	case "mutation":
		opType = graphqlmetricsv1.OperationType_MUTATION
	case "subscription":
		opType = graphqlmetricsv1.OperationType_SUBSCRIPTION
	}

	// Non-blocking
	m.gqlMetricsExporter.Record(&graphqlmetricsv1.SchemaUsageInfo{
		RequestDocument:  operationContext.content,
		TypeFieldMetrics: fieldUsageInfos,
		OperationInfo: &graphqlmetricsv1.OperationInfo{
			Type: opType,
			Hash: strconv.FormatUint(operationContext.hash, 10),
			Name: operationContext.name,
		},
		SchemaInfo: &graphqlmetricsv1.SchemaInfo{
			Version: m.routerConfigVersion,
		},
		ClientInfo: &graphqlmetricsv1.ClientInfo{
			Name:    operationContext.clientInfo.Name,
			Version: operationContext.clientInfo.Version,
		},
		ArgumentMetrics: argumentUsageInfos,
		InputMetrics:    inputUsageInfos,
		RequestInfo: &graphqlmetricsv1.RequestInfo{
			Error:      hasError,
			StatusCode: int32(statusCode),
		},
	})
}
