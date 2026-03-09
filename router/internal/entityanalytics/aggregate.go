package entityanalytics

import (
	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
)

// AggregateEntityAnalyticsBatch groups identical EntityAnalyticsInfo records by their
// operation/client/schema envelope and counts duplicates.
func AggregateEntityAnalyticsBatch(batch []*entityanalyticsv1.EntityAnalyticsInfo) *entityanalyticsv1.PublishEntityAnalyticsRequest {
	req := &entityanalyticsv1.PublishEntityAnalyticsRequest{
		Aggregations: make([]*entityanalyticsv1.EntityAnalyticsAggregation, 0, len(batch)),
	}
WithNextItem:
	for _, item := range batch {
		for i := range req.Aggregations {
			if isEntityAnalyticsEqual(item, req.Aggregations[i].Analytics) {
				req.Aggregations[i].RequestCount++
				continue WithNextItem
			}
		}
		req.Aggregations = append(req.Aggregations, &entityanalyticsv1.EntityAnalyticsAggregation{
			Analytics:    item,
			RequestCount: 1,
		})
	}
	return req
}

func isEntityAnalyticsEqual(a, b *entityanalyticsv1.EntityAnalyticsInfo) bool {
	if a == b {
		return true
	}
	if a.Operation.Hash != b.Operation.Hash {
		return false
	}
	if a.Schema.Version != b.Schema.Version {
		return false
	}
	if a.Client.Name != b.Client.Name {
		return false
	}
	if a.Client.Version != b.Client.Version {
		return false
	}
	return true
}
