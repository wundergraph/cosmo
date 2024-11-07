package core

import (
	"context"

	"os"
	"testing"
	"time"

	"connectrpc.com/connect"
	_ "github.com/amacneil/dbmate/v2/pkg/driver/clickhouse"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/pkg/batch"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"github.com/wundergraph/cosmo/graphqlmetrics/test"
	"go.uber.org/zap"
)

func TestPublishGraphQLMetrics(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(context.Background(), zap.NewNop(), db, defaultConfig())

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

	// Wait for batch to be processed
	msvc.Shutdown()

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

func TestPublishGraphQLMetricsSmallBatches(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(context.Background(), zap.NewNop(), db, defaultConfig())

	count := 200000

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

	// Wait for batch to be processed
	msvc.Shutdown()

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

	msvc := NewMetricsService(context.Background(), zap.NewNop(), db, defaultConfig())

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

	// Wait for batch to be processed
	msvc.Shutdown()

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

	msvc := NewMetricsService(context.Background(), zap.NewNop(), db, defaultConfig())

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

func defaultConfig() batch.ProcessorConfig {
	return batch.ProcessorConfig{
		MaxCostThreshold: 100000,
		MaxQueueSize:     200,
		Interval:         time.Second * 10,
	}
}
