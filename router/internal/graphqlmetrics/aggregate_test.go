package graphqlmetrics

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

func TestAggregateCountWithEqualUsages(t *testing.T) {

	result := AggregateSchemaUsageInfoBatch([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
				{
					Path:        []string{"user", "name"},
					TypeNames:   []string{"User", "String"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{
				"foo": "bar",
			},
		},
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
				{
					Path:        []string{"user", "name"},
					TypeNames:   []string{"User", "String"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{
				"foo": "bar",
			},
		},
	})

	require.Equal(t, 1, len(result.Aggregation))
	require.Equal(t, 2, int(result.Aggregation[0].RequestCount))
}

func TestAggregateCountWithDifferentInputs(t *testing.T) {

	result := AggregateSchemaUsageInfoBatch([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
				{
					Path:        []string{"user", "name"},
					TypeNames:   []string{"User", "String"},
					SubgraphIDs: []string{"1", "2"},
					Count:       1,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{
				"foo": "bar",
			},
		},
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
				{
					Path:        []string{"user", "name"},
					TypeNames:   []string{"User", "String"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
				{
					Path:      []string{"user", "name"},
					TypeName:  "User",
					NamedType: "String",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{
				"foo": "bar",
			},
		},
	})

	require.Equal(t, 2, len(result.Aggregation))
	require.Equal(t, 1, int(result.Aggregation[0].RequestCount))
	require.Equal(t, 1, int(result.Aggregation[1].RequestCount))
}

func TestAggregateWithDifferentOperationInfo(t *testing.T) {

	result := AggregateSchemaUsageInfoBatch([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123456", // different hash
				Name: "user",
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{},
		},
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{},
		},
	})

	require.Equal(t, 2, len(result.Aggregation))
	require.Equal(t, 1, int(result.Aggregation[0].RequestCount))
	require.Equal(t, 1, int(result.Aggregation[1].RequestCount))
}

func TestAggregateWithDifferentClientInfo(t *testing.T) {

	result := AggregateSchemaUsageInfoBatch([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{},
		},
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.1", // different client version
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{},
		},
	})

	require.Equal(t, 2, len(result.Aggregation))
	require.Equal(t, 1, int(result.Aggregation[0].RequestCount))
	require.Equal(t, 1, int(result.Aggregation[1].RequestCount))
}

func TestAggregateWithDifferentRequestInfo(t *testing.T) {

	result := AggregateSchemaUsageInfoBatch([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      false,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{},
		},
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.1", // different client version
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				Error:      true,
				StatusCode: http.StatusOK,
			},
			Attributes: map[string]string{},
		},
	})

	require.Equal(t, 2, len(result.Aggregation))
	require.Equal(t, 1, int(result.Aggregation[0].RequestCount))
	require.Equal(t, 1, int(result.Aggregation[1].RequestCount))
}

func TestAggregateWithDifferentHash(t *testing.T) {

	result := AggregateSchemaUsageInfoBatch([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
				{
					Path:        []string{"user", "name"},
					TypeNames:   []string{"User", "String"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123456", // emulate different hash because of different fields
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			Attributes: map[string]string{},
		},
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					NamedType: "ID",
				},
			},
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				Type: graphqlmetricsv1.OperationType_QUERY,
				Hash: "123",
				Name: "user",
			},
			SchemaInfo: &graphqlmetricsv1.SchemaInfo{
				Version: "1",
			},
			ClientInfo: &graphqlmetricsv1.ClientInfo{
				Name:    "wundergraph",
				Version: "1.0.0",
			},
			Attributes: map[string]string{},
		},
	})

	require.Equal(t, 2, len(result.Aggregation))
	require.Equal(t, 1, int(result.Aggregation[0].RequestCount))
	require.Equal(t, 1, int(result.Aggregation[1].RequestCount))
}
