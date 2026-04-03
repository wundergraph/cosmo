package mcpserver

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

const testSchema = `
schema {
  query: Query
}

type Query {
  employee(id: ID!): Employee
  employees: [Employee!]!
}

type Employee {
  id: ID!
  name: String!
}
`

const findEmployeeOp = `
query FindEmployee($id: ID!) {
  employee(id: $id) {
    id
    name
  }
}
`

const listEmployeesOp = `
query ListEmployees {
  employees {
    id
    name
  }
}
`

const getOperationInfoOp = `
query GetOperationInfo {
  employees {
    id
    name
  }
}
`

func writeOperationFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for filename, content := range files {
		err := os.WriteFile(filepath.Join(dir, filename), []byte(content), 0644)
		require.NoError(t, err)
	}
}

func TestReload_NoToolDuplication(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(core)

	tempDir := t.TempDir()
	writeOperationFiles(t, tempDir, map[string]string{
		"FindEmployee.graphql":  findEmployeeOp,
		"ListEmployees.graphql": listEmployeesOp,
	})

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	srv, err := NewGraphQLSchemaServer(
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(true),
	)
	require.NoError(t, err)

	// First load
	err = srv.Reload(&schemaDoc)
	require.NoError(t, err)

	firstLoadTools := make([]string, len(srv.registeredTools))
	copy(firstLoadTools, srv.registeredTools)

	// Second load (simulates config reload)
	err = srv.Reload(&schemaDoc)
	require.NoError(t, err)

	// registeredTools should be identical after reload — no duplicates
	assert.Equal(t, firstLoadTools, srv.registeredTools,
		"registered tools should be identical after reload, no duplicates")

	// Verify no collision errors were logged
	collisionLogs := logs.FilterMessage("Skipping operation due to tool name collision")
	assert.Equal(t, 0, collisionLogs.Len(),
		"no tool name collision errors should be logged on reload")
}

func TestReload_ReservedToolNameCollision(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(core)

	// Create an operation whose snake_case name will be "get_operation_info",
	// which collides with the reserved tool name.
	tempDir := t.TempDir()
	writeOperationFiles(t, tempDir, map[string]string{
		"GetOperationInfo.graphql": getOperationInfoOp,
		"ListEmployees.graphql":    listEmployeesOp,
	})

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	srv, err := NewGraphQLSchemaServer(
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(true),
	)
	require.NoError(t, err)

	err = srv.Reload(&schemaDoc)
	require.NoError(t, err)

	// The operation "GetOperationInfo" (snake: "get_operation_info") should be skipped
	// because it collides with the reserved tool name.
	collisionLogs := logs.FilterMessage("Skipping operation due to tool name collision")
	assert.Equal(t, 1, collisionLogs.Len(),
		"expected exactly one collision error for reserved tool name")

	if collisionLogs.Len() > 0 {
		entry := collisionLogs.All()[0]
		assert.Equal(t, zapcore.ErrorLevel, entry.Level)
		assert.Equal(t, "get_operation_info", entry.ContextMap()["conflicting_tool"])
	}

	assert.ElementsMatch(t, []string{"get_schema", "list_employees", "get_operation_info"}, srv.registeredTools)
}

func TestReload_PrefixModeAvoidsReservedNameCollision(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(core)

	// "GetOperationInfo" snake_cases to "get_operation_info" which is a reserved name.
	// With the prefix enabled, it becomes "execute_operation_get_operation_info" and no collision occurs.
	tempDir := t.TempDir()
	writeOperationFiles(t, tempDir, map[string]string{
		"GetOperationInfo.graphql": getOperationInfoOp,
		"ListEmployees.graphql":    listEmployeesOp,
	})

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	srv, err := NewGraphQLSchemaServer(
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(false),
	)
	require.NoError(t, err)

	err = srv.Reload(&schemaDoc)
	require.NoError(t, err)

	// No collisions because the prefix disambiguates from the reserved name
	collisionLogs := logs.FilterMessage("Skipping operation due to tool name collision")
	assert.Equal(t, 0, collisionLogs.Len(),
		"no collisions expected with tool name prefix enabled")

	assert.ElementsMatch(t, []string{
		"get_schema",
		"execute_operation_get_operation_info",
		"execute_operation_list_employees",
		"get_operation_info",
	}, srv.registeredTools)
}
