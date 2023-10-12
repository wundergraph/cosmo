package graphqlmetrics

import (
	"context"
	"github.com/bufbuild/connect-go"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/test"
	"go.uber.org/zap"
	"testing"
)

var jwtSecret = []byte("secret")

func TestName(t *testing.T) {
	db := test.GetTestDatabase()

	msvc := NewMetricsService(zap.NewNop(), db, jwtSecret)

	req := &graphqlmetricsv1.PublishGraphQLRequestMetricsRequest{
		SchemaUsage: []*graphqlmetricsv1.SchemaUsageInfo{
			{
				OperationDocument: "query Hello { hello }",
				TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
					{
						Path:      []string{"hello"},
						TypeNames: []string{"Query"},
						Source:    nil,
						Count:     1,
					},
				},
				OperationInfo: &graphqlmetricsv1.OperationInfo{
					OperationHash: "hash123",
					OperationName: "Hello",
					OperationType: "query",
				},
				RequestInfo: &graphqlmetricsv1.RequestInfo{
					RouterConfigVersion: "v1",
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
	assert.Nil(t, err)

	pReq := connect.NewRequest[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest](req)
	pReq.Header().Set("Authorization", "Bearer "+tokenString)

	_, err = msvc.PublishGraphQLMetrics(
		context.Background(),
		pReq,
	)
	assert.Nil(t, err)

	var opCount int
	db.QueryRow(`
		SELECT COUNT(*) FROM cosmo.graphql_operations
    	WHERE OperationHash = 'hash123' AND
    	OperationContent = 'query Hello { hello }'
    	GROUP BY OperationHash LIMIT 1
	`).Scan(&opCount)

	assert.Greater(t, opCount, 0)

	var fieldUsageCount int
	db.QueryRow(`
		SELECT COUNT(*) FROM cosmo.graphql_schema_field_usage_reports
		WHERE OperationHash = 'hash123' AND
		RouterConfigVersion = 'v1' AND
		Attributes['test'] = 'test123' AND
		hasAny(TypeNames, ['Query']) AND
		startsWith(Path, ['hello'])
	`).Scan(&fieldUsageCount)

	assert.Greater(t, fieldUsageCount, 0)
}
