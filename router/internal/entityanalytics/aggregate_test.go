package entityanalytics

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
)

func makeInfo(hash, clientName, clientVersion, schemaVersion string) *entityanalyticsv1.EntityAnalyticsInfo {
	return &entityanalyticsv1.EntityAnalyticsInfo{
		Operation: &entityanalyticsv1.OperationInfo{Hash: hash, Name: "op", Type: entityanalyticsv1.OperationType_QUERY},
		Client:    &entityanalyticsv1.ClientInfo{Name: clientName, Version: clientVersion},
		Schema:    &entityanalyticsv1.SchemaInfo{Version: schemaVersion},
	}
}

func TestAggregateEntityAnalyticsBatch_SameEnvelope(t *testing.T) {
	t.Parallel()
	batch := []*entityanalyticsv1.EntityAnalyticsInfo{
		makeInfo("hash1", "web", "1.0", "v1"),
		makeInfo("hash1", "web", "1.0", "v1"),
		makeInfo("hash1", "web", "1.0", "v1"),
	}

	req := AggregateEntityAnalyticsBatch(batch)
	require.Len(t, req.Aggregations, 1)
	assert.Equal(t, uint64(3), req.Aggregations[0].RequestCount)
}

func TestAggregateEntityAnalyticsBatch_DifferentHash(t *testing.T) {
	t.Parallel()
	batch := []*entityanalyticsv1.EntityAnalyticsInfo{
		makeInfo("hash1", "web", "1.0", "v1"),
		makeInfo("hash2", "web", "1.0", "v1"),
	}

	req := AggregateEntityAnalyticsBatch(batch)
	require.Len(t, req.Aggregations, 2)
	assert.Equal(t, uint64(1), req.Aggregations[0].RequestCount)
	assert.Equal(t, uint64(1), req.Aggregations[1].RequestCount)
}

func TestAggregateEntityAnalyticsBatch_DifferentClient(t *testing.T) {
	t.Parallel()
	batch := []*entityanalyticsv1.EntityAnalyticsInfo{
		makeInfo("hash1", "web", "1.0", "v1"),
		makeInfo("hash1", "web", "2.0", "v1"),
		makeInfo("hash1", "mobile", "1.0", "v1"),
	}

	req := AggregateEntityAnalyticsBatch(batch)
	require.Len(t, req.Aggregations, 3)
}

func TestAggregateEntityAnalyticsBatch_DifferentSchema(t *testing.T) {
	t.Parallel()
	batch := []*entityanalyticsv1.EntityAnalyticsInfo{
		makeInfo("hash1", "web", "1.0", "v1"),
		makeInfo("hash1", "web", "1.0", "v2"),
	}

	req := AggregateEntityAnalyticsBatch(batch)
	require.Len(t, req.Aggregations, 2)
}

func TestAggregateEntityAnalyticsBatch_EmptyBatch(t *testing.T) {
	t.Parallel()
	req := AggregateEntityAnalyticsBatch(nil)
	require.Empty(t, req.Aggregations)
}

func TestAggregateEntityAnalyticsBatch_MixedGroups(t *testing.T) {
	t.Parallel()
	batch := []*entityanalyticsv1.EntityAnalyticsInfo{
		makeInfo("hash1", "web", "1.0", "v1"),
		makeInfo("hash2", "web", "1.0", "v1"),
		makeInfo("hash1", "web", "1.0", "v1"),
		makeInfo("hash2", "web", "1.0", "v1"),
		makeInfo("hash1", "web", "1.0", "v1"),
	}

	req := AggregateEntityAnalyticsBatch(batch)
	require.Len(t, req.Aggregations, 2)

	counts := map[string]uint64{}
	for _, agg := range req.Aggregations {
		counts[agg.Analytics.Operation.Hash] = agg.RequestCount
	}
	assert.Equal(t, uint64(3), counts["hash1"])
	assert.Equal(t, uint64(2), counts["hash2"])
}
