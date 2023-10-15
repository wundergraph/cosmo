package graphqlmetrics

import (
	"connectrpc.com/connect"
	"context"
	"fmt"
	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"go.uber.org/zap"
	"testing"
	"time"
)

type MyClient struct {
	t                *testing.T
	publishedBatches [][]*graphqlmetricsv1.SchemaUsageInfo
}

func (m *MyClient) PublishGraphQLMetrics(ctx context.Context, c *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest]) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {
	require.Equal(m.t, "Bearer secret", c.Header().Get("Authorization"))
	m.publishedBatches = append(m.publishedBatches, c.Msg.GetSchemaUsage())
	return nil, nil
}

var _ graphqlmetricsv1connect.GraphQLMetricsServiceClient = (*MyClient)(nil)

func TestExportAggregationSameSchemaUsages(t *testing.T) {
	c := &MyClient{
		t:                t,
		publishedBatches: make([][]*graphqlmetricsv1.SchemaUsageInfo, 0),
	}

	queueSize := 200
	totalItems := 100
	batchSize := 100

	e := NewExporter(
		zap.NewNop(),
		c,
		"secret",
		&ExporterSettings{
			NumConsumers: 1,
			BatchSize:    batchSize,
			QueueSize:    queueSize,
			Interval:     500 * time.Millisecond,
			Retry: RetryOptions{
				Enabled:     false,
				MaxDuration: 300 * time.Millisecond,
				Interval:    100 * time.Millisecond,
				MaxRetry:    3,
			},
			ExportTimeout: 100 * time.Millisecond,
		},
	)

	require.Nil(t, e.Validate())

	e.Start()

	for i := 0; i < totalItems; i++ {

		hash := fmt.Sprintf("hash-%d", i%2)

		usage := &graphqlmetricsv1.SchemaUsageInfo{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:      []string{"user", "name"},
					TypeNames: []string{"User", "String"},
					SourceIDs: []string{"1", "2"},
					Count:     1,
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: hash,
				Name: "user",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			Attributes: map[string]string{
				"client_name":    "wundergraph",
				"client_version": "1.0.0",
			},
		}

		require.True(t, e.Record(usage))
	}

	require.Nil(t, e.Shutdown(context.Background()))

	require.Equal(t, 1, len(c.publishedBatches))
	require.Equal(t, 2, len(c.publishedBatches[0]))
	require.Equal(t, uint64(50), c.publishedBatches[0][0].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(50), c.publishedBatches[0][1].TypeFieldMetrics[0].Count)
}

func TestExportBatchesWithUniqueSchemaUsages(t *testing.T) {
	c := &MyClient{
		t:                t,
		publishedBatches: make([][]*graphqlmetricsv1.SchemaUsageInfo, 0),
	}

	queueSize := 200
	totalItems := 100
	batchSize := 5

	e := NewExporter(
		zap.NewNop(),
		c,
		"secret",
		&ExporterSettings{
			NumConsumers: 1,
			BatchSize:    batchSize,
			QueueSize:    queueSize,
			Interval:     500 * time.Millisecond,
			Retry: RetryOptions{
				Enabled:     false,
				MaxDuration: 300 * time.Millisecond,
				Interval:    100 * time.Millisecond,
				MaxRetry:    3,
			},
			ExportTimeout: 100 * time.Millisecond,
		},
	)

	require.Nil(t, e.Validate())

	e.Start()

	for i := 0; i < totalItems; i++ {
		usage := &graphqlmetricsv1.SchemaUsageInfo{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeNames: []string{"User", "ID"},
					SourceIDs: []string{"1", "2"},
					Count:     2,
				},
				{
					Path:      []string{"user", "name"},
					TypeNames: []string{"User", "String"},
					SourceIDs: []string{"1", "2"},
					Count:     1,
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: fmt.Sprintf("hash-%d", i),
				Name: "user",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			Attributes: map[string]string{},
		}

		require.True(t, e.Record(usage))
	}

	require.Nil(t, e.Shutdown(context.Background()))

	require.Equal(t, totalItems/batchSize, len(c.publishedBatches))
	require.Equal(t, 5, len(c.publishedBatches[0]))
}

func TestExportBatchInterval(t *testing.T) {
	c := &MyClient{
		t:                t,
		publishedBatches: make([][]*graphqlmetricsv1.SchemaUsageInfo, 0),
	}

	queueSize := 200
	totalItems := 5
	batchSize := 10

	e := NewExporter(
		zap.NewNop(),
		c,
		"secret",
		&ExporterSettings{
			NumConsumers: 1,
			BatchSize:    batchSize,
			QueueSize:    queueSize,
			Interval:     100 * time.Millisecond,
			Retry: RetryOptions{
				Enabled:     false,
				MaxDuration: 300 * time.Millisecond,
				Interval:    100 * time.Millisecond,
				MaxRetry:    3,
			},
			ExportTimeout: 100 * time.Millisecond,
		},
	)

	require.Nil(t, e.Validate())

	e.Start()

	for i := 0; i < totalItems; i++ {
		usage := &graphqlmetricsv1.SchemaUsageInfo{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeNames: []string{"User", "ID"},
					SourceIDs: []string{"1", "2"},
					Count:     2,
				},
				{
					Path:      []string{"user", "name"},
					TypeNames: []string{"User", "String"},
					SourceIDs: []string{"1", "2"},
					Count:     1,
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: fmt.Sprintf("hash-%d", i),
				Name: "user",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			Attributes: map[string]string{},
		}

		require.True(t, e.Record(usage))
	}

	require.Nil(t, e.Shutdown(context.Background()))

	require.Equal(t, 1, len(c.publishedBatches))
	require.Equal(t, 5, len(c.publishedBatches[0]))
}
