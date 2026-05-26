package core

import (
	"testing"

	"github.com/stretchr/testify/assert"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func TestDataSourceMetaData_RequestScopedFields(t *testing.T) {
	l := &Loader{}

	in := &nodev1.DataSourceConfiguration{
		RequestScopedFields: []*nodev1.RequestScopedFieldConfiguration{
			{
				FieldName: "currentUser",
				TypeName:  "Query",
				L1Key:     "viewer.user",
			},
			{
				FieldName: "currentUser",
				TypeName:  "Personalized",
				L1Key:     "viewer.user",
			},
		},
	}

	out := l.dataSourceMetaData(in, "test-subgraph")

	assert.Len(t, out.FederationMetaData.RequestScopedFields, 2)

	assert.Equal(t, plan.RequestScopedField{
		FieldName: "currentUser",
		TypeName:  "Query",
		L1Key:     "viewer.user",
	}, out.FederationMetaData.RequestScopedFields[0])

	assert.Equal(t, plan.RequestScopedField{
		FieldName: "currentUser",
		TypeName:  "Personalized",
		L1Key:     "viewer.user",
	}, out.FederationMetaData.RequestScopedFields[1])
}

func TestDataSourceMetaData_RequestScopedFields_Empty(t *testing.T) {
	l := &Loader{}

	in := &nodev1.DataSourceConfiguration{}

	out := l.dataSourceMetaData(in, "test-subgraph")

	assert.Nil(t, out.FederationMetaData.RequestScopedFields)
}
