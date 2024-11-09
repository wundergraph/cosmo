package core

import (
	"context"
	"os"
	"runtime"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	_ "github.com/amacneil/dbmate/v2/pkg/driver/clickhouse"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"github.com/wundergraph/cosmo/graphqlmetrics/test"
	"go.uber.org/zap"
)

func TestPublishGraphQLMetrics(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(zap.NewNop(), db, defaultConfig())

	req := &graphqlmetricsv1.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
			{
				RequestDocument: "query Hello { hello }",
				TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
					{
						Path:                   []string{"hello"},
						TypeNames:              []string{"Query"},
						SubgraphIDs:            []string{"sub123"},
						Count:                  1,
						IndirectInterfaceField: false,
					},
					{
						Path:                   []string{"hi"},
						TypeNames:              []string{"Query"},
						SubgraphIDs:            []string{"sub123"},
						Count:                  1,
						IndirectInterfaceField: true,
					},
				},
				OperationInfo: &graphqlmetricsv1.OperationInfo{
					Hash: "hash123",
					Name: "Hello",
					Type: graphqlmetricsv1.OperationType_QUERY,
				},
				SchemaInfo: &graphqlmetricsv1.SchemaInfo{
					Version: "v1",
				},
				ClientInfo: &graphqlmetricsv1.ClientInfo{
					Name:    "wundergraph",
					Version: "1.0.0",
				},
				RequestInfo: &graphqlmetricsv1.RequestInfo{
					StatusCode: 200,
					Error:      true,
				},
				Attributes: map[string]string{
					"test": "test123",
				},
			},
		},
	}

	pReq := connect.NewRequest[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest](req)

	ctx := utils.SetClaims(context.Background(), &utils.GraphAPITokenClaims{
		FederatedGraphID: "fed123",
		OrganizationID:   "org123",
	})

	_, err := msvc.PublishGraphQLMetrics(
		ctx,
		pReq,
	)
	require.NoError(t, err)

	// Wait until all requests are dispatched
	time.Sleep(time.Millisecond * 100)

	// Wait for batch to be processed
	msvc.Shutdown(time.Second * 10)

	// Validate insert

	var opCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_operations
    	WHERE OperationHash = 'hash123' AND
		OperationName = 'Hello' AND
		OperationType = 'query' AND
    	OperationContent = 'query Hello { hello }'
    	GROUP BY OperationHash LIMIT 1
	`).Scan(&opCount))

	assert.Greater(t, opCount, uint64(0))

	// Validate insert

	var fieldUsageCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage
		WHERE OperationHash = 'hash123' AND
		OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		HttpStatusCode = '200' AND
		HasError = true AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCount))

	assert.Greater(t, fieldUsageCount, uint64(0))

	var indirectFieldUsageCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage
		WHERE OperationHash = 'hash123' AND
		OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		HttpStatusCode = '200' AND
		HasError = true AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello']) AND
		IsIndirectFieldUsage = true
	`).Scan(&indirectFieldUsageCount))

	assert.Greater(t, fieldUsageCount, uint64(0))

	// Validate materialized view

	var fieldUsageCountMv uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage_5m_90d_mv
		WHERE OperationHash = 'hash123' AND
		OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		TotalErrors = 1 AND
		TotalUsages = 1 AND
		TotalClientErrors = 0 AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCountMv))

	assert.Greater(t, fieldUsageCountMv, uint64(0))
}

func TestPublishGraphQLMetricsSendEmptyAndFilledMetrics(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(zap.NewNop(), db, defaultConfig())

	su1 := buildSchemaUsageInfoItem("Hash1", "query Hello { hello }", 0, 0, 0)
	su2 := buildSchemaUsageInfoItem("Hash2", "query Hello { hello }", 1, 2, 0)

	req := &graphqlmetricsv1.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{su1, su2},
	}

	pReq := connect.NewRequest[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest](req)

	ctx := utils.SetClaims(context.Background(), &utils.GraphAPITokenClaims{
		FederatedGraphID: "fed123",
		OrganizationID:   "org123",
	})

	_, err := msvc.PublishGraphQLMetrics(
		ctx,
		pReq,
	)
	require.NoError(t, err)

	// Wait for batch to be processed
	msvc.Shutdown(time.Second * 10)

	// Validate insert

	var opCount uint64

	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_operations
    	WHERE OperationName = 'Hello' AND
		OperationType = 'query' AND
    	OperationContent = 'query Hello { hello }'
	`).Scan(&opCount))

	assert.Equal(t, opCount, uint64(2))

	// Validate insert

	var fieldUsageCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage
		WHERE OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123'
	`).Scan(&fieldUsageCount))

	assert.Equal(t, int(fieldUsageCount), 3)
}

func TestPublishGraphQLMetricsSmallBatches(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(zap.NewNop(), db, defaultConfig())

	// High number slows down race mode significantly
	count := 20_000

	requests := make([]*connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest], 0, count)

	for i := 0; i < count; i++ {
		req := &graphqlmetricsv1.PublishGraphQLRequestMetricsRequest{
			SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
				{
					RequestDocument: "query Hello { hello }",
					TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
						{
							Path:                   []string{"hello"},
							TypeNames:              []string{"Query"},
							SubgraphIDs:            []string{"sub123"},
							Count:                  1,
							IndirectInterfaceField: false,
						},
						{
							Path:                   []string{"hi"},
							TypeNames:              []string{"Query"},
							SubgraphIDs:            []string{"sub123"},
							Count:                  1,
							IndirectInterfaceField: true,
						},
					},
					OperationInfo: &graphqlmetricsv1.OperationInfo{
						Hash: uuid.NewString(),
						Name: "Hello",
						Type: graphqlmetricsv1.OperationType_QUERY,
					},
					SchemaInfo: &graphqlmetricsv1.SchemaInfo{
						Version: "v1",
					},
					ClientInfo: &graphqlmetricsv1.ClientInfo{
						Name:    "wundergraph",
						Version: "1.0.0",
					},
					RequestInfo: &graphqlmetricsv1.RequestInfo{
						StatusCode: 200,
						Error:      true,
					},
					Attributes: map[string]string{
						"test": "test123",
					},
				},
			},
		}

		pReq := connect.NewRequest[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest](req)
		requests = append(requests, pReq)
	}

	ctx := utils.SetClaims(context.Background(), &utils.GraphAPITokenClaims{
		FederatedGraphID: "fed123",
		OrganizationID:   "org123",
	})

	for _, pReq := range requests {
		_, err := msvc.PublishGraphQLMetrics(
			ctx,
			pReq,
		)
		require.NoError(t, err)
	}

	// Wait until all requests are dispatched
	time.Sleep(time.Second * 5)

	// Wait for batch to be processed
	msvc.Shutdown(time.Second * 10)

	// Validate insert

	var opCount uint64

	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_operations
    	WHERE OperationName = 'Hello' AND
		OperationType = 'query' AND
    	OperationContent = 'query Hello { hello }'
	`).Scan(&opCount))

	assert.Equal(t, opCount, uint64(count))

	// Validate insert

	var fieldUsageCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage
		WHERE OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		HttpStatusCode = '200' AND
		HasError = true AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCount))

	assert.Greater(t, fieldUsageCount, uint64(0))

	var allHelloEntries uint64
	require.NoError(t, db.QueryRow(ctx, `
	SELECT COUNT(*) FROM gql_metrics_schema_usage
	WHERE OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		HttpStatusCode = '200' AND
		HasError = true AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		has(Path, 'hello')
	`).Scan(&allHelloEntries))

	assert.Equal(t, int(fieldUsageCount), count)

	// Validate materialized view

	var fieldUsageCountMv uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage_5m_90d_mv
		WHERE OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		TotalErrors = 1 AND
		TotalUsages = 1 AND
		TotalClientErrors = 0 AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCountMv))

	assert.Greater(t, fieldUsageCountMv, uint64(0))
}

func TestPublishAggregatedGraphQLMetrics(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(zap.NewNop(), db, defaultConfig())

	req := &graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest{
		Aggregation: []*graphqlmetricsv1.SchemaUsageInfoAggregation{
			{
				SchemaUsage: &graphqlmetricsv1.SchemaUsageInfo{
					RequestDocument: "query Hello { hello }",
					TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
						{
							Path:                   []string{"hello"},
							TypeNames:              []string{"Query"},
							SubgraphIDs:            []string{"sub123"},
							IndirectInterfaceField: false,
						},
						{
							Path:                   []string{"hi"},
							TypeNames:              []string{"Query"},
							SubgraphIDs:            []string{"sub123"},
							IndirectInterfaceField: true,
						},
					},
					OperationInfo: &graphqlmetricsv1.OperationInfo{
						Hash: "hash123",
						Name: "Hello",
						Type: graphqlmetricsv1.OperationType_QUERY,
					},
					SchemaInfo: &graphqlmetricsv1.SchemaInfo{
						Version: "v1",
					},
					ClientInfo: &graphqlmetricsv1.ClientInfo{
						Name:    "wundergraph",
						Version: "1.0.0",
					},
					RequestInfo: &graphqlmetricsv1.RequestInfo{
						StatusCode: 200,
						Error:      true,
					},
					Attributes: map[string]string{
						"test": "test123",
					},
				},
				RequestCount: 1,
			},
		},
	}

	pReq := connect.NewRequest[graphqlmetricsv1.PublishAggregatedGraphQLRequestMetricsRequest](req)

	ctx := utils.SetClaims(context.Background(), &utils.GraphAPITokenClaims{
		FederatedGraphID: "fed123",
		OrganizationID:   "org123",
	})

	_, err := msvc.PublishAggregatedGraphQLMetrics(
		ctx,
		pReq,
	)
	require.NoError(t, err)

	// Wait until all requests are dispatched
	time.Sleep(time.Millisecond * 100)

	// Wait for batch to be processed
	msvc.Shutdown(time.Second * 10)

	// Validate insert

	var opCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_operations
    	WHERE OperationHash = 'hash123' AND
		OperationName = 'Hello' AND
		OperationType = 'query' AND
    	OperationContent = 'query Hello { hello }'
    	GROUP BY OperationHash LIMIT 1
	`).Scan(&opCount))

	assert.Greater(t, opCount, uint64(0))

	// Validate insert

	var fieldUsageCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage
		WHERE OperationHash = 'hash123' AND
		OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		HttpStatusCode = '200' AND
		HasError = true AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCount))

	assert.Greater(t, fieldUsageCount, uint64(0))

	var indirectFieldUsageCount uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage
		WHERE OperationHash = 'hash123' AND
		OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		HttpStatusCode = '200' AND
		HasError = true AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello']) AND
		IsIndirectFieldUsage = true
	`).Scan(&indirectFieldUsageCount))

	assert.Greater(t, fieldUsageCount, uint64(0))

	// Validate materialized view

	var fieldUsageCountMv uint64
	require.NoError(t, db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gql_metrics_schema_usage_5m_90d_mv
		WHERE OperationHash = 'hash123' AND
		OrganizationID = 'org123' AND
		FederatedGraphID = 'fed123' AND
		RouterConfigVersion = 'v1' AND
		TotalErrors = 1 AND
		TotalUsages = 1 AND
		TotalClientErrors = 0 AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCountMv))

	assert.Greater(t, fieldUsageCountMv, uint64(0))
}

func TestAuthentication(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(zap.NewNop(), db, defaultConfig())

	req := &graphqlmetricsv1.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: nil,
	}

	// Request without auth context
	pReq := connect.NewRequest[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest](req)

	_, err := msvc.PublishGraphQLMetrics(
		context.Background(),
		pReq,
	)
	require.Error(t, err)
	require.Error(t, err, errNotAuthenticated)
}

func TestCalculateRequestCost(t *testing.T) {
	tests := []struct {
		name     string
		input    SchemaUsageRequestItem
		expected int
	}{
		{
			name: "single usage with 3 elements",
			input: SchemaUsageRequestItem{
				SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
					{
						ArgumentMetrics:  make([]*graphqlmetricsv1.ArgumentUsageInfo, 1),
						InputMetrics:     make([]*graphqlmetricsv1.InputUsageInfo, 1),
						TypeFieldMetrics: make([]*graphqlmetricsv1.TypeFieldUsageInfo, 1),
					},
				},
			},
			expected: 3,
		},
		{
			name: "single usage with 2 elements and 1 empty",
			input: SchemaUsageRequestItem{
				SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
					{
						ArgumentMetrics: make([]*graphqlmetricsv1.ArgumentUsageInfo, 1),
						InputMetrics:    make([]*graphqlmetricsv1.InputUsageInfo, 1),
					},
				},
			},
			expected: 2,
		},
		{
			name: "empty slice",
			input: SchemaUsageRequestItem{
				SchemaUsage: nil,
			},
			expected: 0,
		},
		{
			name: "single usage with multiple usage elements",
			input: SchemaUsageRequestItem{
				SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
					{
						ArgumentMetrics:  make([]*graphqlmetricsv1.ArgumentUsageInfo, 1),
						InputMetrics:     make([]*graphqlmetricsv1.InputUsageInfo, 1),
						TypeFieldMetrics: make([]*graphqlmetricsv1.TypeFieldUsageInfo, 1),
					},
					{
						ArgumentMetrics:  make([]*graphqlmetricsv1.ArgumentUsageInfo, 1),
						InputMetrics:     make([]*graphqlmetricsv1.InputUsageInfo, 1),
						TypeFieldMetrics: make([]*graphqlmetricsv1.TypeFieldUsageInfo, 1),
					},
					{
						ArgumentMetrics:  make([]*graphqlmetricsv1.ArgumentUsageInfo, 1),
						InputMetrics:     make([]*graphqlmetricsv1.InputUsageInfo, 1),
						TypeFieldMetrics: make([]*graphqlmetricsv1.TypeFieldUsageInfo, 1),
					},
					{
						ArgumentMetrics:  make([]*graphqlmetricsv1.ArgumentUsageInfo, 1),
						InputMetrics:     make([]*graphqlmetricsv1.InputUsageInfo, 1),
						TypeFieldMetrics: make([]*graphqlmetricsv1.TypeFieldUsageInfo, 1),
					},
				},
			},
			expected: 12,
		},
	}

	for _, tt := range tests {
		cost := calculateRequestCost([]SchemaUsageRequestItem{
			tt.input,
		})

		require.Equal(t, tt.expected, cost, tt.name)
	}
}

type mockDriver struct {
	driver.Conn
	mockPrepareBatch func(ctx context.Context, query string, opts ...driver.PrepareBatchOption) (driver.Batch, error)
}

func (m *mockDriver) PrepareBatch(ctx context.Context, query string, opts ...driver.PrepareBatchOption) (driver.Batch, error) {
	return m.mockPrepareBatch(ctx, query, opts...)
}

type mockBatch struct {
	driver.Batch
	mockAppendFunc func(v ...any) error
}

func (m *mockBatch) Append(v ...any) error {
	return m.mockAppendFunc(v...)
}

func TestPrepareClickhouseBatches(t *testing.T) {
	type input struct {
		batch []SchemaUsageRequestItem
	}
	type expected struct {
		expectedPrepareBatchCalls int
		operationBatchCreated     bool
		metricsBatchCreated       bool
	}

	tests := []struct {
		name            string
		preCachedHashes []string
		input           input
		expected        expected
	}{
		{
			name: "should call prepare batch once",
			input: input{
				batch: []SchemaUsageRequestItem{
					{
						Claims: &utils.GraphAPITokenClaims{
							OrganizationID:   "TestOrg",
							FederatedGraphID: "TestGraph",
						},
						SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
							buildSchemaUsageInfoItem("hash123", "query Hello { hello }", 0, 0, 0),
						},
					},
				},
			},
			expected: expected{
				expectedPrepareBatchCalls: 1,
				operationBatchCreated:     true,
				metricsBatchCreated:       false,
			},
		},
		{
			name: "should call prepare batch twice",
			input: input{
				batch: []SchemaUsageRequestItem{
					{
						Claims: &utils.GraphAPITokenClaims{
							OrganizationID:   "TestOrg",
							FederatedGraphID: "TestGraph",
						},
						SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
							buildSchemaUsageInfoItem("hash123", "query Hello { hello }", 1, 1, 1),
						},
					},
				},
			},
			expected: expected{
				expectedPrepareBatchCalls: 2,
				operationBatchCreated:     true,
				metricsBatchCreated:       true,
			},
		},
		{
			name: "should not call prepare batch",
			input: input{
				batch: []SchemaUsageRequestItem{
					{
						Claims: &utils.GraphAPITokenClaims{
							OrganizationID:   "TestOrg",
							FederatedGraphID: "TestGraph",
						},
						SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
							buildSchemaUsageInfoItem("hash123", "", 0, 0, 0),
						},
					},
				},
			},
			expected: expected{
				expectedPrepareBatchCalls: 0,
				operationBatchCreated:     false,
				metricsBatchCreated:       false,
			},
		},
		{
			name: "should not call prepare batch if hash is in the cache",
			input: input{
				batch: []SchemaUsageRequestItem{
					{
						Claims: &utils.GraphAPITokenClaims{
							OrganizationID:   "TestOrg",
							FederatedGraphID: "TestGraph",
						},
						SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
							buildSchemaUsageInfoItem("hash123", "", 0, 0, 0),
						},
					},
					{
						Claims: &utils.GraphAPITokenClaims{
							OrganizationID:   "TestOrg",
							FederatedGraphID: "TestGraph",
						},
						SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
							buildSchemaUsageInfoItem("hash234", "", 0, 0, 0),
						},
					},
					{
						Claims: &utils.GraphAPITokenClaims{
							OrganizationID:   "TestOrg",
							FederatedGraphID: "TestGraph",
						},
						SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
							buildSchemaUsageInfoItem("hash123", "", 0, 0, 0),
						},
					},
				},
			},
			preCachedHashes: []string{"hash123", "hash234"},
			expected: expected{
				expectedPrepareBatchCalls: 0,
				operationBatchCreated:     false,
				metricsBatchCreated:       false,
			},
		},
		{
			name: "should not call prepare batch if hash is in the cache but still send metrics",
			input: input{
				batch: []SchemaUsageRequestItem{
					{
						Claims: &utils.GraphAPITokenClaims{
							OrganizationID:   "TestOrg",
							FederatedGraphID: "TestGraph",
						},
						SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
							buildSchemaUsageInfoItem("hash123", "", 1, 2, 0),
						},
					},
				},
			},
			preCachedHashes: []string{"hash123"},
			expected: expected{
				expectedPrepareBatchCalls: 1,
				operationBatchCreated:     false,
				metricsBatchCreated:       true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			numPrepareBatchCalls := 0

			batch := &mockBatch{mockAppendFunc: func(v ...any) error {
				return nil
			}}

			db := &mockDriver{mockPrepareBatch: func(ctx context.Context, query string, opts ...driver.PrepareBatchOption) (driver.Batch, error) {
				numPrepareBatchCalls++
				return batch, nil
			}}

			msvc := NewMetricsService(zap.NewNop(), db, defaultConfig())

			for _, hash := range tt.preCachedHashes {
				msvc.opGuardCache.Set(hash, struct{}{}, 1)
			}

			opBatch, metricsBatch, err := msvc.prepareClickhouseBatches(context.Background(), time.Now(), tt.input.batch)
			require.NoError(t, err)
			require.Equal(t, tt.expected.expectedPrepareBatchCalls, numPrepareBatchCalls)

			if tt.expected.operationBatchCreated {
				require.NotNil(t, opBatch)
			} else {
				require.Nil(t, opBatch)
			}

			if tt.expected.metricsBatchCreated {
				require.NotNil(t, metricsBatch)
			} else {
				require.Nil(t, metricsBatch)
			}
		})
	}
}

func defaultConfig() ProcessorConfig {
	return ProcessorConfig{
		MaxBatchSize: 10_000,
		MaxQueueSize: 1000,
		MaxWorkers:   runtime.NumCPU(),
		Interval:     10 * time.Second,
	}
}

func buildSchemaUsageInfoItem(hash, reqDoc string, numArgMetrics, numTypeMetrics, numInputMetrics int) *graphqlmetricsv1.SchemaUsageInfo {
	argMetrics := make([]*graphqlmetricsv1.ArgumentUsageInfo, 0, numArgMetrics)
	typeMetrics := make([]*graphqlmetricsv1.TypeFieldUsageInfo, 0, numTypeMetrics)
	inputMetrics := make([]*graphqlmetricsv1.InputUsageInfo, 0, numInputMetrics)

	for i := 0; i < numArgMetrics; i++ {
		argMetrics = append(argMetrics, &graphqlmetricsv1.ArgumentUsageInfo{
			Path:     []string{"hello"},
			TypeName: "testType",
		})
	}

	for i := 0; i < numTypeMetrics; i++ {
		typeMetrics = append(typeMetrics, &graphqlmetricsv1.TypeFieldUsageInfo{
			Path:                   []string{"hello"},
			TypeNames:              []string{"Query"},
			SubgraphIDs:            []string{"sub123"},
			IndirectInterfaceField: false,
		})
	}

	for i := 0; i < numInputMetrics; i++ {
		inputMetrics = append(inputMetrics, &graphqlmetricsv1.InputUsageInfo{
			Path:       []string{"hello"},
			TypeName:   "testType",
			EnumValues: []string{"test"},
		})
	}

	return &graphqlmetricsv1.SchemaUsageInfo{
		RequestDocument:  reqDoc,
		ArgumentMetrics:  argMetrics,
		TypeFieldMetrics: typeMetrics,
		InputMetrics:     inputMetrics,
		OperationInfo: &graphqlmetricsv1.OperationInfo{
			Hash: hash,
			Name: "Hello",
			Type: graphqlmetricsv1.OperationType_QUERY,
		},
		SchemaInfo: &graphqlmetricsv1.SchemaInfo{
			Version: "v1",
		},
		ClientInfo: &graphqlmetricsv1.ClientInfo{
			Name:    "wundergraph",
			Version: "1.0.0",
		},
		RequestInfo: &graphqlmetricsv1.RequestInfo{
			StatusCode: 200,
			Error:      true,
		},
		Attributes: map[string]string{
			"test": "test123",
		},
	}
}
