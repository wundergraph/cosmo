package graphqlmetrics

import (
	"connectrpc.com/connect"
	"context"
	"errors"
	"fmt"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/golang-jwt/jwt/v5"
	lru "github.com/hashicorp/golang-lru/v2"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"go.uber.org/zap"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	errJWTInvalid                        = errors.New("the JWT is invalid")
	errInvalidAuthenticationHeaderFormat = errors.New("invalid authorization header format")
	errNotAuthenticated                  = errors.New("authentication didn't succeed")
	errMetricWriteFailed                 = errors.New("failed to write metrics")
	errOperationWriteFailed              = errors.New("operation write failed")
)

type GraphAPITokenClaims struct {
	OrganizationID   string `json:"organization_id"`
	FederatedGraphID string `json:"federated_graph_id"`
	jwt.RegisteredClaims
}

type MetricsService struct {
	logger *zap.Logger

	// conn is the clickhouse connection
	conn clickhouse.Conn

	// opGuardCache is used to prevent duplicate writes of the same operation
	opGuardCache *lru.Cache[string, struct{}]

	// jwtSecret is the secret used to validate the JWT
	jwtSecret []byte
}

// NewMetricsService creates a new metrics service
func NewMetricsService(logger *zap.Logger, chConn clickhouse.Conn, jwtSecret []byte) *MetricsService {
	c, err := lru.New[string, struct{}](25000)
	if err != nil {
		panic(err)
	}
	return &MetricsService{
		logger:       logger,
		conn:         chConn,
		opGuardCache: c,
		jwtSecret:    jwtSecret,
	}
}

func (s *MetricsService) PublishGraphQLMetrics(
	ctx context.Context,
	req *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest],
) (*connect.Response[graphqlmetricsv1.PublishOperationCoverageReportResponse], error) {
	res := connect.NewResponse(&graphqlmetricsv1.PublishOperationCoverageReportResponse{})

	parts := strings.Split(req.Header().Get("Authorization"), " ")
	if len(parts) != 2 {
		return nil, errInvalidAuthenticationHeaderFormat
	}

	token, err := jwt.ParseWithClaims(parts[1], &GraphAPITokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		s.logger.Debug("Failed to parse token", zap.Error(err))
		return nil, errNotAuthenticated
	}

	if !token.Valid {
		s.logger.Debug("Token is invalid", zap.Bool("valid", token.Valid))
		return nil, errJWTInvalid
	}

	claims, ok := token.Claims.(*GraphAPITokenClaims)
	if !ok {
		return nil, errJWTInvalid
	}

	insertTime := time.Now()

	// TODO: Do async batching once it is supported by native protocol in clickhouse-go
	// We don't use std HTTP async batching because it hasn't been proven to be stable yet
	// We see bad connection errors regularly without recovery

	for _, schemaUsage := range req.Msg.SchemaUsage {

		operationType := strings.ToLower(schemaUsage.OperationInfo.Type.String())

		// If the operation is already in the cache, we can skip it and don't write it again
		if _, ok := s.opGuardCache.Get(schemaUsage.OperationInfo.Hash); !ok {
			err := s.conn.AsyncInsert(ctx, `INSERT INTO gql_metrics_operations VALUES (
				?, ?, ?, ?, ?
			)`, true,
				insertTime,
				schemaUsage.OperationInfo.Name,
				schemaUsage.OperationInfo.Hash,
				operationType,
				schemaUsage.RequestDocument,
			)
			if err != nil {
				s.logger.Error("Failed to write operation", zap.Error(err))
				return nil, errOperationWriteFailed
			}

			// Add the operation to the cache once it has been written
			s.opGuardCache.Add(schemaUsage.OperationInfo.Hash, struct{}{})
		}

		for _, fieldUsage := range schemaUsage.TypeFieldMetrics {

			// Sort stable for fields where the order doesn't matter
			// This reduce cardinality and improves compression

			sort.SliceStable(fieldUsage.SubgraphIDs, func(i, j int) bool {
				return fieldUsage.SubgraphIDs[i] < fieldUsage.SubgraphIDs[j]
			})
			sort.SliceStable(fieldUsage.TypeNames, func(i, j int) bool {
				return fieldUsage.TypeNames[i] < fieldUsage.TypeNames[j]
			})

			err := s.conn.AsyncInsert(ctx, `INSERT INTO gql_metrics_schema_usage VALUES (
				?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
			)`, true,
				insertTime,
				claims.OrganizationID,
				claims.FederatedGraphID,
				schemaUsage.SchemaInfo.Version,
				schemaUsage.OperationInfo.Hash,
				schemaUsage.OperationInfo.Name,
				operationType,
				fieldUsage.Count,
				fieldUsage.Path,
				fieldUsage.TypeNames,
				fieldUsage.NamedType,
				schemaUsage.ClientInfo.Name,
				schemaUsage.ClientInfo.Version,
				strconv.FormatInt(int64(schemaUsage.RequestInfo.StatusCode), 10),
				schemaUsage.RequestInfo.Error,
				fieldUsage.SubgraphIDs,
				schemaUsage.Attributes,
			)
			if err != nil {
				s.logger.Error("Failed to write metrics", zap.Error(err))
				return nil, errMetricWriteFailed
			}
		}
	}

	return res, nil
}
