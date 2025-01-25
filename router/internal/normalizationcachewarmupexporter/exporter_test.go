package normalizationcachewarmupexporter

import (
	"context"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/cespare/xxhash/v2"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/exporter"
	"go.uber.org/zap"
)

type FakeClient struct {
	wg           sync.WaitGroup
	mu           sync.Mutex
	aggregations []*graphqlmetricsv1.NormalizationCacheWarmupDataAggregation
}

func (f *FakeClient) PublishGraphQLMetrics(ctx context.Context, c *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest]) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {
	return nil, nil
}

func (f *FakeClient) PublishAggregatedGraphQLMetrics(ctx context.Context, c *connect.Request[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest]) (*connect.Response[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsResponse], error) {
	return nil, nil
}

func (f *FakeClient) PublishNormalizationCacheWarmupData(ctx context.Context, c *connect.Request[graphqlmetricsv1.PublishNormalizationCacheWarmupDataRequest]) (*connect.Response[graphqlmetricsv1.PublishNormalizationCacheWarmupDataResponse], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	defer f.wg.Done()
	f.aggregations = append(f.aggregations, c.Msg.Aggregation)
	return &connect.Response[graphqlmetricsv1.PublishNormalizationCacheWarmupDataResponse]{
		Msg: &graphqlmetricsv1.PublishNormalizationCacheWarmupDataResponse{},
	}, nil
}

func TestExporter(t *testing.T) {

	c := &FakeClient{}

	e, err := NewExporter(
		zap.NewNop(),
		c,
		"secret",
		&exporter.Settings{
			BatchSize: 2,
			QueueSize: 2,
			Interval:  500 * time.Millisecond,
			RetryOptions: exporter.RetryOptions{
				Enabled:     false,
				MaxDuration: 300 * time.Millisecond,
				Interval:    100 * time.Millisecond,
				MaxRetry:    3,
			},
			ExportTimeout: 100 * time.Millisecond,
		},
	)
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = e.Shutdown(context.Background())
	})

	c.wg.Add(1)

	ok := e.RecordUsage(&graphqlmetricsv1.NormalizationCacheWarmupData{
		Query: &graphqlmetricsv1.NormalizationCacheWarmupDataQuery{
			Query: "query { field }",
			Hash:  xxhash.Sum64([]byte("query { field }")),
		},
	}, false)
	require.True(t, ok)

	ok = e.RecordUsage(&graphqlmetricsv1.NormalizationCacheWarmupData{
		Query: &graphqlmetricsv1.NormalizationCacheWarmupDataQuery{
			Query: "query { field }",
			Hash:  xxhash.Sum64([]byte("query { field }")),
		},
	}, false)
	require.True(t, ok)

	c.wg.Wait()

	c.mu.Lock()
	defer c.mu.Unlock()

	require.Len(t, c.aggregations, 1)
	require.Len(t, c.aggregations[0].Operations, 1)
}

func TestExporterWithVariables(t *testing.T) {

	c := &FakeClient{}

	e, err := NewExporter(
		zap.NewNop(),
		c,
		"secret",
		&exporter.Settings{
			BatchSize: 3,
			QueueSize: 3,
			Interval:  500 * time.Millisecond,
			RetryOptions: exporter.RetryOptions{
				Enabled:     false,
				MaxDuration: 300 * time.Millisecond,
				Interval:    100 * time.Millisecond,
				MaxRetry:    3,
			},
			ExportTimeout: 100 * time.Millisecond,
		},
	)
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = e.Shutdown(context.Background())
	})

	c.wg.Add(1)

	ok := e.RecordUsage(&graphqlmetricsv1.NormalizationCacheWarmupData{
		Query: &graphqlmetricsv1.NormalizationCacheWarmupDataQuery{
			Query: "query { otherField }",
			Hash:  xxhash.Sum64([]byte("query { otherField }")),
		},
	}, false)
	require.True(t, ok)

	ok = e.RecordUsage(&graphqlmetricsv1.NormalizationCacheWarmupData{
		Query: &graphqlmetricsv1.NormalizationCacheWarmupDataQuery{
			Query: "query { field }",
			Hash:  xxhash.Sum64([]byte("query { field }")),
		},
		VariableVariations: map[uint64]*graphqlmetricsv1.VariableVariation{
			0: {
				VariableValues: []*graphqlmetricsv1.VariableValue{
					{
						Key:   "a",
						Value: true,
					},
				},
			},
		},
	}, false)
	require.True(t, ok)

	ok = e.RecordUsage(&graphqlmetricsv1.NormalizationCacheWarmupData{
		Query: &graphqlmetricsv1.NormalizationCacheWarmupDataQuery{
			Query: "query { field }",
			Hash:  xxhash.Sum64([]byte("query { field }")),
		},
		VariableVariations: map[uint64]*graphqlmetricsv1.VariableVariation{
			0: {
				VariableValues: []*graphqlmetricsv1.VariableValue{
					{
						Key:   "a",
						Value: true,
					},
				},
			},
			1: {
				VariableValues: []*graphqlmetricsv1.VariableValue{
					{
						Key:   "b",
						Value: true,
					},
				},
			},
		},
	}, false)
	require.True(t, ok)

	c.wg.Wait()

	c.mu.Lock()
	defer c.mu.Unlock()

	require.Len(t, c.aggregations, 1)
	require.Len(t, c.aggregations[0].Operations, 2)
	require.Len(t, c.aggregations[0].Operations[xxhash.Sum64([]byte("query { otherField }"))].VariableVariations, 0)
	require.Len(t, c.aggregations[0].Operations[xxhash.Sum64([]byte("query { field }"))].VariableVariations, 2)
}
