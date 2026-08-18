package mcpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(true),
	)
	require.NoError(t, err)

	// First load
	err = srv.Reload(&schemaDoc, nil)
	require.NoError(t, err)

	firstLoadTools := make([]string, len(srv.registeredTools))
	copy(firstLoadTools, srv.registeredTools)

	// Second load (simulates config reload)
	err = srv.Reload(&schemaDoc, nil)
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
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(true),
	)
	require.NoError(t, err)

	err = srv.Reload(&schemaDoc, nil)
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
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(false),
	)
	require.NoError(t, err)

	err = srv.Reload(&schemaDoc, nil)
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

func TestRegisterTools_OutputSchemaFailureRegistersToolWithoutSchema(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(core)

	tempDir := t.TempDir()
	writeOperationFiles(t, tempDir, map[string]string{
		"ListEmployees.graphql": listEmployeesOp,
	})

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	srv, err := NewGraphQLSchemaServer(
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(true),
		WithOutputSchemaEnabled(true),
	)
	require.NoError(t, err)

	err = srv.Reload(&schemaDoc, nil)
	require.NoError(t, err)
	require.Contains(t, srv.registeredTools, "list_employees")
	require.Equal(t, 0, logs.FilterMessage("failed to build output schema for operation; registering tool without output schema").Len(),
		"no output schema warning expected for a valid operation")

	// Replace the loaded operation with one selecting a field missing from the
	// schema and re-register: the tool must still be registered, just without
	// an output schema.
	brokenDoc, report := astparser.ParseGraphqlDocumentString(`query ListEmployees { bogus }`)
	require.False(t, report.HasErrors())

	operations := srv.operationsManager.GetOperations()
	require.Len(t, operations, 1)
	operations[0].Document = brokenDoc

	srv.registeredTools = nil
	require.NoError(t, srv.registerTools())

	assert.Contains(t, srv.registeredTools, "list_employees")
	assert.Equal(t, 1, logs.FilterMessage("failed to build output schema for operation; registering tool without output schema").Len(),
		"expected a warning about the failed output schema")
}

func TestRegisterTools_NoOutputSchemaBuildWhenDisabled(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(core)

	tempDir := t.TempDir()
	writeOperationFiles(t, tempDir, map[string]string{
		"ListEmployees.graphql": listEmployeesOp,
	})

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	srv, err := NewGraphQLSchemaServer(
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(logger),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(true),
	)
	require.NoError(t, err)

	require.NoError(t, srv.Reload(&schemaDoc, nil))
	require.Contains(t, srv.registeredTools, "list_employees")

	// With the flag disabled (default), a broken operation must not produce an
	// output schema warning because no schema is built at all.
	brokenDoc, report := astparser.ParseGraphqlDocumentString(`query ListEmployees { bogus }`)
	require.False(t, report.HasErrors())

	operations := srv.operationsManager.GetOperations()
	require.Len(t, operations, 1)
	operations[0].Document = brokenDoc

	srv.registeredTools = nil
	require.NoError(t, srv.registerTools())

	assert.Contains(t, srv.registeredTools, "list_employees")
	assert.Equal(t, 0, logs.FilterMessage("failed to build output schema for operation; registering tool without output schema").Len(),
		"no output schema is built when the flag is disabled")
}

// TestExecuteGraphQLQueryResultBoundary pins the result semantics of
// executeGraphQLQuery with structured output enabled:
//   - transport-level breakage (non-JSON, empty, or literal null body) is a
//     tool error, unconditionally
//   - spec-valid GraphQL error envelopes keep their existing IsError semantics
//   - successful responses carry structured content mirroring the text content
func TestExecuteGraphQLQueryResultBoundary(t *testing.T) {
	testCases := []struct {
		name                  string
		responseBody          string
		wantIsError           bool
		wantStructuredContent bool
	}{
		{"data object succeeds with structured content", `{"data":{"hello":"world"}}`, false, true},
		{"null data without errors succeeds with structured content", `{"data":null}`, false, true},
		{"empty object succeeds with structured content", `{}`, false, true},
		{"errors without data keep returning a tool error", `{"errors":[{"message":"boom"}],"data":null}`, true, false},
		{"errors with partial data keep returning a tool error", `{"errors":[{"message":"boom"}],"data":{"hello":null}}`, true, false},
		{"non-JSON body returns a tool error", `<html>bad gateway</html>`, true, false},
		{"empty body returns a tool error", ``, true, false},
		{"null body returns a tool error", `null`, true, false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.responseBody))
			}))
			defer upstream.Close()

			srv, err := NewGraphQLSchemaServer(
				t.Context(),
				upstream.URL,
				WithLogger(zap.NewNop()),
				WithOperationsDir(t.TempDir()),
				WithOutputSchemaEnabled(true),
			)
			require.NoError(t, err)

			result, err := srv.executeGraphQLQuery(t.Context(), "query { hello }", nil)
			require.NoError(t, err)

			assert.Equal(t, tc.wantIsError, result.IsError)
			if tc.wantStructuredContent {
				// Structured content must accompany every success result and mirror the text content
				assert.Equal(t, json.RawMessage(tc.responseBody), result.StructuredContent)
			} else {
				assert.Nil(t, result.StructuredContent)
			}
		})
	}
}

// TestExecuteGraphQLQueryStructuredContentDisabled proves that the flag only
// gates structured content: the transport-level error boundary applies
// unconditionally, and successful results stay text-only.
func TestExecuteGraphQLQueryStructuredContentDisabled(t *testing.T) {
	testCases := []struct {
		name         string
		responseBody string
		wantIsError  bool
	}{
		{"data object stays text-only", `{"data":{"hello":"world"}}`, false},
		{"non-JSON body is still a tool error", `<html>bad gateway</html>`, true},
		{"null body is still a tool error", `null`, true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.responseBody))
			}))
			defer upstream.Close()

			srv, err := NewGraphQLSchemaServer(
				t.Context(),
				upstream.URL,
				WithLogger(zap.NewNop()),
				WithOperationsDir(t.TempDir()),
			)
			require.NoError(t, err)

			result, err := srv.executeGraphQLQuery(t.Context(), "query { hello }", nil)
			require.NoError(t, err)

			assert.Equal(t, tc.wantIsError, result.IsError)
			assert.Nil(t, result.StructuredContent)
		})
	}
}
