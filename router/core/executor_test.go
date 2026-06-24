package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func TestExecutorCloseReleasesSchemaReferences(t *testing.T) {
	t.Parallel()

	executor := &Executor{
		ClientSchema:    &ast.Document{},
		RouterSchema:    &ast.Document{},
		PlanConfig:      plan.Configuration{DataSources: []plan.DataSource{nil}},
		RenameTypeNames: nil,
	}

	executor.Close()

	require.Nil(t, executor.ClientSchema)
	require.Nil(t, executor.RouterSchema)
	require.Empty(t, executor.PlanConfig.DataSources)
	require.Nil(t, executor.RenameTypeNames)
	require.Nil(t, executor.Resolver)
}

func TestExecutorCloseNilSafe(t *testing.T) {
	t.Parallel()

	var executor *Executor
	require.NotPanics(t, func() {
		executor.Close()
	})
}
