package mcpserver

import (
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestOperationsManager(t *testing.T) {
	t.Parallel()

	t.Run("compute tool scopes drops an operation over the combination limit and keeps the others", func(t *testing.T) {
		t.Parallel()

		schemaDoc := testSchemaDoc(t)
		core, logs := observer.New(zap.ErrorLevel)
		om := NewOperationsManager(&schemaDoc, zap.New(core), false)

		// ListEmployees touches two scoped fields (2 x 2 = 4 groups), which
		// exceeds a limit of 2. Ids touches one scoped field (2 groups).
		om.LoadOperationsFromManifest(map[string]string{
			"all": listEmployeesOp,
			"ids": `query Ids { employees { id } }`,
		})
		require.Len(t, om.GetOperations(), 2)

		twoGroups := &nodev1.AuthorizationConfiguration{
			RequiredOrScopes: []*nodev1.Scopes{
				{RequiredAndScopes: []string{"read:a"}},
				{RequiredAndScopes: []string{"read:b"}},
			},
		}
		om.ComputeToolScopes([]*nodev1.FieldConfiguration{
			{TypeName: "Employee", FieldName: "id", AuthorizationConfiguration: twoGroups},
			{TypeName: "Employee", FieldName: "name", AuthorizationConfiguration: twoGroups},
		}, 2)

		ops := om.GetOperations()
		require.Len(t, ops, 1)
		require.Equal(t, "Ids", ops[0].Name)
		require.Equal(t, [][]string{{"read:a"}, {"read:b"}}, ops[0].RequiredScopes)

		dropped := logs.FilterMessage("Skipping MCP operation because its scopes cannot be computed")
		require.Equal(t, 1, dropped.Len())
		require.Equal(t, "ListEmployees", dropped.All()[0].ContextMap()["operation"])
	})
}
