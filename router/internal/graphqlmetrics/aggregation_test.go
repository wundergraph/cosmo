package graphqlmetrics

import (
	"github.com/stretchr/testify/require"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"net/http"
	"testing"
)

func TestAggregateCountWithEqualUsages(t *testing.T) {

	result := Aggregate([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
					Count:       2,
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
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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
					Count:       1,
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
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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

	require.Equal(t, 1, len(result))
	require.Equal(t, uint64(3), result[0].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(2), result[0].TypeFieldMetrics[1].Count)
	require.Equal(t, uint64(2), result[0].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(2), result[0].InputMetrics[0].Count)
}

func TestAggregateWithDifferentOperationInfo(t *testing.T) {

	result := Aggregate([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
					Count:       2,
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
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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
					Count:       1,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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

	require.Equal(t, 2, len(result))
	require.Equal(t, uint64(2), result[0].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].InputMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].InputMetrics[0].Count)
}

func TestAggregateWithDifferentClientInfo(t *testing.T) {

	result := Aggregate([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
					Count:       2,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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
					Count:       1,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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

	require.Equal(t, 2, len(result))
	require.Equal(t, uint64(2), result[0].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].InputMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].InputMetrics[0].Count)
}

func TestAggregateWithDifferentRequestInfo(t *testing.T) {

	result := Aggregate([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
					Count:       2,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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
					Count:       1,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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

	require.Equal(t, 2, len(result))
	require.Equal(t, uint64(2), result[0].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].InputMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].InputMetrics[0].Count)
}

func TestAggregateWithDifferentHash(t *testing.T) {

	result := Aggregate([]*graphqlmetricsv1.SchemaUsageInfo{
		{
			TypeFieldMetrics: []*graphqlmetricsv1.TypeFieldUsageInfo{
				{
					Path:        []string{"user", "id"},
					TypeNames:   []string{"User", "ID"},
					SubgraphIDs: []string{"1", "2"},
					Count:       2,
				},
				{
					Path:        []string{"user", "name"},
					TypeNames:   []string{"User", "String"},
					SubgraphIDs: []string{"1", "2"},
					Count:       6,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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
					Count:       1,
				},
			},
			ArgumentMetrics: []*graphqlmetricsv1.ArgumentUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
					NamedType: "ID",
				},
			},
			InputMetrics: []*graphqlmetricsv1.InputUsageInfo{
				{
					Path:      []string{"user", "id"},
					TypeName:  "User",
					Count:     1,
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

	require.Equal(t, 2, len(result))
	require.Equal(t, uint64(2), result[0].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(6), result[0].TypeFieldMetrics[1].Count)
	require.Equal(t, uint64(1), result[1].TypeFieldMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].ArgumentMetrics[0].Count)
	require.Equal(t, uint64(1), result[0].InputMetrics[0].Count)
	require.Equal(t, uint64(1), result[1].InputMetrics[0].Count)
}
