package graphqlmetrics

import (
	"context"
	"slices"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.uber.org/zap"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
)

// PrometheusSink implements the Sink interface for exporting schema field usage metrics
// to Prometheus via OpenTelemetry metrics. It measures field usage patterns by operation.
type PrometheusSink struct {
	metricStore  metric.Store
	logger       *zap.Logger
	includeOpSha bool
}

// PrometheusSinkConfig contains configuration for creating a PrometheusSink.
type PrometheusSinkConfig struct {
	MetricStore  metric.Store
	Logger       *zap.Logger
	IncludeOpSha bool // Whether to include operation SHA256 in metrics
}

// aggregatedUsageKey represents a unique combination of operation and field attributes
type aggregatedUsageKey struct {
	operationName string
	operationType string
	operationHash string // empty if not included
	fieldName     string
	parentType    string
}

// NewPrometheusSink creates a new sink that exports schema field usage metrics to Prometheus.
func NewPrometheusSink(cfg PrometheusSinkConfig) *PrometheusSink {
	return &PrometheusSink{
		metricStore:  cfg.MetricStore,
		logger:       cfg.Logger.With(zap.String("component", "prometheus_sink")),
		includeOpSha: cfg.IncludeOpSha,
	}
}

// Export processes a batch of SchemaUsageInfo items and records their field usage to Prometheus.
// It aggregates field usage across the entire batch before recording metrics, minimizing the number
// of calls to MeasureSchemaFieldUsage.
func (s *PrometheusSink) Export(ctx context.Context, batch []*graphqlmetrics.SchemaUsageInfo) error {
	if len(batch) == 0 {
		return nil
	}

	s.logger.Debug("Exporting schema field usage to Prometheus", zap.Int("batch_size", len(batch)))

	// Aggregate all field usage across the entire batch
	aggregatedCounts := s.aggregateBatch(batch)

	// Record metrics for each unique combination of operation + field attributes
	for key, count := range aggregatedCounts {
		opAttrs := []attribute.KeyValue{
			rotel.WgOperationName.String(key.operationName),
			rotel.WgOperationType.String(key.operationType),
		}

		// Include operation SHA256 if it was provided
		if key.operationHash != "" {
			opAttrs = append(opAttrs, rotel.WgOperationSha256.String(key.operationHash))
		}

		fieldAttrs := []attribute.KeyValue{
			rotel.WgGraphQLFieldName.String(key.fieldName),
			rotel.WgGraphQLParentType.String(key.parentType),
		}

		allAttrs := slices.Concat(opAttrs, fieldAttrs)
		s.metricStore.MeasureSchemaFieldUsage(
			ctx,
			int64(count),
			[]attribute.KeyValue{},
			otelmetric.WithAttributeSet(attribute.NewSet(allAttrs...)),
		)
	}

	s.logger.Debug("Successfully exported schema field usage to Prometheus",
		zap.Int("batch_size", len(batch)),
		zap.Int("unique_metrics", len(aggregatedCounts)))
	return nil
}

// Close performs cleanup when shutting down the sink.
// For PrometheusSink, there's no specific cleanup needed.
func (s *PrometheusSink) Close(ctx context.Context) error {
	s.logger.Debug("Closing Prometheus sink")
	return nil
}

// aggregateBatch aggregates field usage counts across the entire batch,
// grouping by operation attributes and field attributes.
func (s *PrometheusSink) aggregateBatch(batch []*graphqlmetrics.SchemaUsageInfo) map[aggregatedUsageKey]int {
	aggregatedCounts := make(map[aggregatedUsageKey]int)

	for _, usageInfo := range batch {
		if usageInfo.OperationInfo == nil || usageInfo.TypeFieldMetrics == nil {
			continue
		}

		// Extract operation info
		opName := usageInfo.OperationInfo.Name
		opType := s.operationTypeToString(usageInfo.OperationInfo.Type)
		opHash := ""
		if s.includeOpSha {
			opHash = usageInfo.OperationInfo.Hash
		}

		// Process each field in this usage info
		for _, field := range usageInfo.TypeFieldMetrics {
			// Skip fields without valid parent type or path
			if len(field.Path) == 0 || len(field.TypeNames) < 1 {
				continue
			}

			// The parent type is typically the first type in the TypeNames list
			// The field name is the last element in the path
			parentType := field.TypeNames[0]
			fieldName := field.Path[len(field.Path)-1]

			key := aggregatedUsageKey{
				operationName: opName,
				operationType: opType,
				operationHash: opHash,
				fieldName:     fieldName,
				parentType:    parentType,
			}

			// Increment count, using field.Count if available, otherwise 1
			if field.Count > 0 {
				aggregatedCounts[key] += int(field.Count)
			} else {
				aggregatedCounts[key]++
			}
		}
	}

	return aggregatedCounts
}

// operationTypeToString converts the protobuf OperationType to a string.
func (s *PrometheusSink) operationTypeToString(opType graphqlmetrics.OperationType) string {
	switch opType {
	case graphqlmetrics.OperationType_QUERY:
		return "query"
	case graphqlmetrics.OperationType_MUTATION:
		return "mutation"
	case graphqlmetrics.OperationType_SUBSCRIPTION:
		return "subscription"
	default:
		return "unknown"
	}
}
