package graphqlmetrics

import graphqlmetricsv12 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"

// Aggregate aggregates the given schema usage info items.
// A schema usage info item is considered equal to another if:
// - The operation hash is equal which means that the same query, same fields was executed
// - The request info is equal which means that the same router config version was used
// - The client info is equal which means that the same client was used
// - The attributes are equal

func Aggregate(items []*graphqlmetricsv12.SchemaUsageInfo) []*graphqlmetricsv12.SchemaUsageInfo {
	aggregated := make([]*graphqlmetricsv12.SchemaUsageInfo, 0, len(items))
	duplicates := make(map[*graphqlmetricsv12.SchemaUsageInfo]struct{}, len(items))

	// check for same schema usage infos and aggregate field metrics
	for _, a := range items {

		// skip already aggregated items
		if _, ok := duplicates[a]; ok {
			continue
		}

		for _, b := range items {
			if a != b && isSchemaUsageInfoEqual(a, b) {
				for k, metric := range b.TypeFieldMetrics {
					a.TypeFieldMetrics[k].Count += metric.Count
				}
				duplicates[b] = struct{}{}
			}
		}

		aggregated = append(aggregated, a)
	}

	return aggregated
}

func isSchemaUsageInfoEqual(a, b *graphqlmetricsv12.SchemaUsageInfo) bool {
	// Different hash imply different query type, name and fields
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

	return true
}

func areAttributesEqual(a, b map[string]string) bool {
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
