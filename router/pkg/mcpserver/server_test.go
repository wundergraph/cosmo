package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

type fakePromptToQueryClient struct {
	response        *nodev1.GenerateQueryResponse
	err             error
	schemaVersionID string
	prompt          string
}

func stringPointer(value string) *string {
	return &value
}

func (f *fakePromptToQueryClient) GenerateQuery(_ context.Context, schemaVersionID, prompt string) (*nodev1.GenerateQueryResponse, error) {
	f.schemaVersionID = schemaVersionID
	f.prompt = prompt
	return f.response, f.err
}

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
	err = srv.Reload(&schemaDoc, nil, "schema-version-test")
	require.NoError(t, err)

	firstLoadTools := make([]string, len(srv.registeredTools))
	copy(firstLoadTools, srv.registeredTools)

	// Second load (simulates config reload)
	err = srv.Reload(&schemaDoc, nil, "schema-version-test")
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

	err = srv.Reload(&schemaDoc, nil, "schema-version-test")
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

	err = srv.Reload(&schemaDoc, nil, "schema-version-test")
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

func TestGenerateQueryTool(t *testing.T) {
	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	client := &fakePromptToQueryClient{
		response: &nodev1.GenerateQueryResponse{
			Response: &nodev1.Response{Code: common.EnumStatusCode_OK},
			Query: &nodev1.SatisfiedQuery{
				Description:     "Lists employees",
				Document:        "query ListEmployees { employees { id name } }",
				OperationName:   "ListEmployees",
				OperationType:   nodev1.SatisfiedOperationType_QUERY,
				VariablesSchema: `{"type":"object"}`,
			},
		},
	}
	srv, err := NewGraphQLSchemaServer(
		t.Context(),
		"http://localhost:4000/graphql",
		WithPromptToQueryClient(client),
		WithOperationsDir(""),
	)
	require.NoError(t, err)
	require.NoError(t, srv.Reload(&schemaDoc, nil, "schema-version-first"))
	require.Contains(t, srv.registeredTools, "generate_query")

	result, err := srv.handleGenerateQuery()(t.Context(), &mcp.CallToolRequest{
		Params: &mcp.CallToolParamsRaw{Arguments: json.RawMessage(`{"prompt":"  List all employees  "}`)},
	})

	require.NoError(t, err)
	require.False(t, result.IsError)
	require.Equal(t, "schema-version-first", client.schemaVersionID)
	require.Equal(t, "List all employees", client.prompt)
	require.Len(t, result.Content, 1)
	textContent, ok := result.Content[0].(*mcp.TextContent)
	require.True(t, ok)
	require.JSONEq(t, `{
		"description":"Lists employees",
		"document":"query ListEmployees { employees { id name } }",
		"operationName":"ListEmployees",
		"operationType":"query",
		"variablesSchema":"{\"type\":\"object\"}"
	}`, textContent.Text)

	require.NoError(t, srv.Reload(&schemaDoc, nil, "schema-version-second"))
	_, err = srv.handleGenerateQuery()(t.Context(), &mcp.CallToolRequest{
		Params: &mcp.CallToolParamsRaw{Arguments: json.RawMessage(`{"prompt":"List employees again"}`)},
	})
	require.NoError(t, err)
	require.Equal(t, "schema-version-second", client.schemaVersionID)
}

func TestGenerateQueryToolErrors(t *testing.T) {
	tests := []struct {
		name            string
		client          *fakePromptToQueryClient
		schemaVersionID string
		arguments       string
		wantText        string
	}{
		{
			name:            "blank prompt",
			client:          &fakePromptToQueryClient{},
			schemaVersionID: "schema-version-test",
			arguments:       `{"prompt":"   "}`,
			wantText:        "prompt is required",
		},
		{
			name:      "schema unavailable",
			client:    &fakePromptToQueryClient{},
			arguments: `{"prompt":"List employees"}`,
			wantText:  "schema version is not available",
		},
		{
			name: "control plane rejection",
			client: &fakePromptToQueryClient{response: &nodev1.GenerateQueryResponse{
				Response: &nodev1.Response{Code: common.EnumStatusCode_ERR_UPGRADE_PLAN, Details: stringPointer("Prompt to Query not available with your current plan")},
			}},
			schemaVersionID: "schema-version-test",
			arguments:       `{"prompt":"List employees"}`,
			wantText:        "Prompt to Query not available with your current plan",
		},
		{
			name:            "transport failure",
			client:          &fakePromptToQueryClient{err: errors.New("control plane unavailable")},
			schemaVersionID: "schema-version-test",
			arguments:       `{"prompt":"List employees"}`,
			wantText:        "Failed to generate a GraphQL operation",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, err := NewGraphQLSchemaServer(
				t.Context(),
				"http://localhost:4000/graphql",
				WithPromptToQueryClient(tt.client),
			)
			require.NoError(t, err)
			srv.setSchemaVersionID(tt.schemaVersionID)

			result, err := srv.handleGenerateQuery()(t.Context(), &mcp.CallToolRequest{
				Params: &mcp.CallToolParamsRaw{Arguments: json.RawMessage(tt.arguments)},
			})

			require.NoError(t, err)
			require.True(t, result.IsError)
			textContent, ok := result.Content[0].(*mcp.TextContent)
			require.True(t, ok)
			require.Contains(t, textContent.Text, tt.wantText)
		})
	}
}

func TestGenerateQueryScopeIncludedInProtectedResourceMetadata(t *testing.T) {
	srv := &GraphQLSchemaServer{
		oauthConfig: &config.MCPOAuthConfiguration{
			AuthorizationServerURL: "https://auth.example.com",
			Scopes: config.MCPOAuthScopesConfiguration{
				ToolsCall:     []string{"mcp:tools:call"},
				GenerateQuery: []string{"mcp:query:generate"},
			},
		},
		promptToQueryClient: &fakePromptToQueryClient{},
		serverBaseURL:       "https://mcp.example.com",
		logger:              zap.NewNop(),
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource/mcp", nil)
	srv.handleProtectedResourceMetadata(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	var metadata ProtectedResourceMetadata
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &metadata))
	require.Equal(t, []string{"mcp:query:generate", "mcp:tools:call"}, metadata.ScopesSupported)
}
