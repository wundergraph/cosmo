package graphqlmetrics

import (
	"slices"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

func AggregateSchemaUsageInfoBatch(batch []*graphqlmetrics.SchemaUsageInfo) *graphqlmetrics.PublishAggregatedGraphQLRequestMetricsRequest {
	req := &graphqlmetrics.PublishAggregatedGraphQLRequestMetricsRequest{
		Aggregation: make([]*graphqlmetrics.SchemaUsageInfoAggregation, 0, len(batch)),
	}
WithNextItem:
	for _, item := range batch {
		for i := range req.Aggregation {
			if isSchemaUsageInfoEqual(item, req.Aggregation[i].SchemaUsage) {
				req.Aggregation[i].RequestCount++
				continue WithNextItem
			}
		}
		req.Aggregation = append(req.Aggregation, &graphqlmetrics.SchemaUsageInfoAggregation{
			SchemaUsage:  item,
			RequestCount: 1,
		})
	}
	return req
}

func isSchemaUsageInfoEqual(a, b *graphqlmetrics.SchemaUsageInfo) bool {
	if a == b {
		return true
	}
	// Different hash imply already different query type, name, arguments, fields
	if a.OperationInfo.Hash != b.OperationInfo.Hash {
		return false
	}

	if a.SchemaInfo.Version != b.SchemaInfo.Version {
		return false
	}

	if a.ClientInfo.Name != b.ClientInfo.Name {
		return false
	}

	if a.ClientInfo.Version != b.ClientInfo.Version {
		return false
	}

	if a.RequestInfo.Error != b.RequestInfo.Error {
		return false
	}

	if a.RequestInfo.StatusCode != b.RequestInfo.StatusCode {
		return false
	}

	if !areAttributesEqual(a.Attributes, b.Attributes) {
		return false
	}

	// Can vary between requests when different variables are used
	if !areInputUsageInfosEqual(a.InputMetrics, b.InputMetrics) {
		return false
	}

	return true
}

func areInputUsageInfosEqual(a, b []*graphqlmetrics.InputUsageInfo) bool {
	if len(a) != len(b) {
		return false
	}

	for i, v := range a {
		if !isInputUsageInfoEqual(v, b[i]) {
			return false
		}
	}

	return true
}

func isInputUsageInfoEqual(a, b *graphqlmetrics.InputUsageInfo) bool {
	if a.NamedType != b.NamedType {
		return false
	}

	if a.TypeName != b.TypeName {
		return false
	}

	if !slices.Equal(a.Path, b.Path) {
		return false
	}

	if !slices.Equal(a.EnumValues, b.EnumValues) {
		return false
	}

	return true
}

func areAttributesEqual(a, b map[string]string) bool {
	if a == nil && b == nil {
		return true
	}

	if len(a) != len(b) {
		return false
	}

	for k, v := range a {
		if b[k] != v {
			return false
		}
	}

	return true
}
