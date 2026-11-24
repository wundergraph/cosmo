package mcpserver

import (
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
)

func TestOperationsManager(t *testing.T) {
	t.Parallel()

	t.Run("compute tool scopes returns an error when a manifest operation exceeds the combination limit", func(t *testing.T) {
		t.Parallel()

		schemaDoc := testSchemaDoc(t)
		om := NewOperationsManager(&schemaDoc, zap.NewNop(), false)

		// ListEmployees touches two scoped fields (2 x 2 = 4 groups), which
		// exceeds a limit of 2. Ids touches one scoped field (2 groups).
		require.NoError(t, om.LoadOperationsFromManifest(map[string]string{
			"all": listEmployeesOp,
			"ids": `query Ids { employees { id } }`,
		}))
		require.Len(t, om.GetOperations(), 2)

		twoGroups := &nodev1.AuthorizationConfiguration{
			RequiredOrScopes: []*nodev1.Scopes{
				{RequiredAndScopes: []string{"read:a"}},
				{RequiredAndScopes: []string{"read:b"}},
			},
		}
		err := om.ComputeToolScopes([]*nodev1.FieldConfiguration{
			{TypeName: "Employee", FieldName: "id", AuthorizationConfiguration: twoGroups},
			{TypeName: "Employee", FieldName: "name", AuthorizationConfiguration: twoGroups},
		}, 2)

		require.ErrorContains(t, err, `operation "ListEmployees"`)
	})
}
