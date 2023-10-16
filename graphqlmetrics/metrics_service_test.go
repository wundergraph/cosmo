package graphqlmetrics

import (
	"connectrpc.com/connect"
	"context"
	_ "github.com/amacneil/dbmate/v2/pkg/driver/clickhouse"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/test"
	"go.uber.org/zap"
	"os"
	"testing"
)

var jwtSecret = []byte("secret")

func TestPublishGraphQLMetrics(t *testing.T) {

	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(zap.NewNop(), db, jwtSecret)

	req := &graphqlmetricsv1.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
			{
				RequestDocument: "query Hello { hello }",
				TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
					{
						Path:        []string{"hello"},
						TypeNames:   []string{"Query"},
						SubgraphIDs: []string{"sub123"},
						Count:       1,
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
				Attributes: map[string]string{
					"test": "test123",
				},
			},
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, GraphAPITokenClaims{
		FederatedGraphID: "fed123",
		OrganizationID:   "org123",
	})
	tokenString, err := token.SignedString(jwtSecret)
	require.NoError(t, err)

	pReq := connect.NewRequest[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest](req)
	pReq.Header().Set("Authorization", "Bearer "+tokenString)

	_, err = msvc.PublishGraphQLMetrics(
		context.Background(),
		pReq,
	)
	require.NoError(t, err)

	var opCount int
	require.NoError(t, db.QueryRow(`
		SELECT COUNT(*) FROM gql_metrics_operations
    	WHERE OperationHash = 'hash123' AND
		OperationName = 'Hello' AND
		OperationType = 'query' AND
    	OperationContent = 'query Hello { hello }'
    	GROUP BY OperationHash LIMIT 1
	`).Scan(&opCount))

	assert.Greater(t, opCount, 0)

	var fieldUsageCount int
	require.NoError(t, db.QueryRow(`
		SELECT COUNT(*) FROM gql_metrics_schema_usage
		WHERE OperationHash = 'hash123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		ClientName = 'wundergraph' AND
		ClientVersion = '1.0.0' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCount))

	assert.Greater(t, fieldUsageCount, 0)
}

func TestAuthentication(t *testing.T) {
	if os.Getenv("INT_TESTS") != "true" {
		t.Skip("Skipping integration tests")
	}

	db := test.GetTestDatabase(t)

	msvc := NewMetricsService(zap.NewNop(), db, jwtSecret)

	req := &graphqlmetricsv1.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: nil,
	}

	// Request without jwt token
	pReq := connect.NewRequest[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest](req)

	_, err := msvc.PublishGraphQLMetrics(
		context.Background(),
		pReq,
	)
	require.Error(t, err)
	require.Error(t, err, errNotAuthenticated)
}
