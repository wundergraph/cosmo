package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/sandbox"
	"github.com/wundergraph/cosmo/router/pkg/yokoclient"
	"go.uber.org/zap"
)

func newTestCodeModeServer(t *testing.T) *CodeModeServer {
	t.Helper()

	cfg := CodeModeServerConfig{
		ListenAddr:              "localhost:0",
		RequireMutationApproval: true,
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second, // 30s to accommodate WASM cold start on CI
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: "http://localhost:4000/graphql",
		Stateless:             true,
	}

	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)
	return srv
}

func newCodeModeServerWithSchema(t *testing.T, cfg CodeModeServerConfig) (*CodeModeServer, error) {
	t.Helper()

	srv, err := NewCodeModeServer(cfg)
	if err != nil {
		return nil, err
	}
	t.Cleanup(func() {
		srv.sandboxPool.Close()
	})

	return srv, nil
}

func callSearchTool(t *testing.T, srv *CodeModeServer, prompts ...string) *mcp.CallToolResult {
	t.Helper()
	handler := srv.handleSearch()
	req := mcp.CallToolRequest{}
	req.Params.Name = "search_graphql"
	promptsAny := make([]any, len(prompts))
	for i, p := range prompts {
		promptsAny[i] = p
	}
	req.Params.Arguments = map[string]any{"prompts": promptsAny}
	result, err := handler(context.Background(), req)
	require.NoError(t, err)
	return result
}

func callExecuteTool(t *testing.T, srv *CodeModeServer, code string) *mcp.CallToolResult {
	t.Helper()
	handler := srv.handleExecute()
	req := mcp.CallToolRequest{}
	req.Params.Name = "execute_graphql"
	req.Params.Arguments = map[string]any{"code": code}
	result, err := handler(context.Background(), req)
	require.NoError(t, err)
	return result
}

// --- NewCodeModeServer tests ---

func TestCodeModeServer_NewRequiresEndpoint(t *testing.T) {
	_, err := NewCodeModeServer(CodeModeServerConfig{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "router GraphQL endpoint is required")
}

func TestCodeModeServer_NewPrependsHTTP(t *testing.T) {
	srv, err := NewCodeModeServer(CodeModeServerConfig{
		RouterGraphQLEndpoint: "localhost:4000/graphql",
		Logger:                zap.NewNop(),
	})
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:4000/graphql", srv.config.RouterGraphQLEndpoint)
	srv.sandboxPool.Close()
}

// --- Search tool tests ---

func TestSearch_EmptyPrompts(t *testing.T) {
	srv := newTestCodeModeServer(t)
	result := callSearchTool(t, srv)
	assert.True(t, result.IsError)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "non-empty array")
}

func TestSearch_NoYokoClient(t *testing.T) {
	srv := newTestCodeModeServer(t)
	// No yokoClient set — should return error
	result := callSearchTool(t, srv, "find all users")
	assert.True(t, result.IsError)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "not available")
}

// --- Execute tool tests ---

func TestExecute_EmptyCode(t *testing.T) {
	srv := newTestCodeModeServer(t)
	result := callExecuteTool(t, srv, "")
	assert.True(t, result.IsError)
}

func TestExecute_SimpleReturn(t *testing.T) {
	srv := newTestCodeModeServer(t)
	result := callExecuteTool(t, srv, `async () => { return { hello: "world" }; }`)
	require.False(t, result.IsError)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "hello")
	assert.Contains(t, text, "world")
}

func TestExecute_GraphQL(t *testing.T) {
	// Set up a mock GraphQL server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"users":[{"id":"1","name":"Alice"}]}}`))
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	hash := srv.storeQueryHash("{ users { id name } }")
	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		const result = executeOperationByHash("%s");
		return result;
	}`, hash))
	require.False(t, result.IsError, "unexpected error: %+v", result.Content)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "data")
	assert.Contains(t, text, "users")
	assert.Contains(t, text, "Alice")
}

func TestExecute_MutationDeclined(t *testing.T) {
	srv := newTestCodeModeServer(t)

	hash := srv.storeQueryHash(`mutation { createUser(input: {name: "test", email: "test@test.com"}) { id } }`)
	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		const result = executeOperationByHash("%s");
		return result;
	}`, hash))
	require.False(t, result.IsError)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "declined")
}

func TestExecute_MutationAllowed(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"createUser":{"id":"1"}}}`))
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		RequireMutationApproval: false, // mutations allowed without approval
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	hash := srv.storeQueryHash(`mutation { createUser(input: {name: "test", email: "test@test.com"}) { id } }`)
	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		const result = executeOperationByHash("%s");
		return result;
	}`, hash))
	require.False(t, result.IsError)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "data")
	assert.Contains(t, text, "createUser")
	assert.NotContains(t, text, "declined")
}

// --- isMutation tests ---

func TestIsMutation_Query(t *testing.T) {
	assert.False(t, isMutation("{ users { id } }", ""))
	assert.False(t, isMutation("query { users { id } }", ""))
	assert.False(t, isMutation("query GetUsers { users { id } }", ""))
}

func TestIsMutation_Mutation(t *testing.T) {
	assert.True(t, isMutation("mutation { createUser(input: {}) { id } }", ""))
	assert.True(t, isMutation("mutation CreateUser { createUser(input: {}) { id } }", ""))
}

func TestIsMutation_Invalid(t *testing.T) {
	assert.False(t, isMutation("not a valid query", ""))
}

func TestIsMutation_OperationName(t *testing.T) {
	multiOp := "query GetUsers { users { id } } mutation CreateUser { createUser(input: {}) { id } }"
	// Without operationName, detects mutation in any operation
	assert.True(t, isMutation(multiOp, ""))
	// With query operationName, skips the mutation
	assert.False(t, isMutation(multiOp, "GetUsers"))
	// With mutation operationName, detects it
	assert.True(t, isMutation(multiOp, "CreateUser"))
}

// --- Header forwarding test ---

func TestExecute_HeaderForwarding(t *testing.T) {
	var receivedAuth string
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"ok":true}}`))
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		RequireMutationApproval: false,
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	hash := srv.storeQueryHash("{ ok }")
	handler := srv.handleExecute()
	req := mcp.CallToolRequest{}
	req.Params.Name = "execute_graphql"
	req.Params.Arguments = map[string]any{
		"code": fmt.Sprintf(`async () => { return executeOperationByHash("%s"); }`, hash),
	}

	// Create context with auth header
	ctx := withRequestHeaders(context.Background(), http.Header{
		"Authorization": []string{"Bearer test-token"},
	})

	result, err := handler(ctx, req)
	require.NoError(t, err)
	require.False(t, result.IsError, "unexpected error: %+v", result.Content)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "ok")
	assert.Equal(t, "Bearer test-token", receivedAuth)
}

// --- Stop test ---

func TestCodeModeServer_Stop(t *testing.T) {
	cfg := CodeModeServerConfig{
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: "http://localhost:4000/graphql",
	}
	srv, err := NewCodeModeServer(cfg)
	require.NoError(t, err)

	err = srv.Stop(context.Background())
	require.NoError(t, err)
}

// --- executeOperationByHashFunc edge cases ---

func TestExecuteOperationFunc_NoArgs(t *testing.T) {
	srv := newTestCodeModeServer(t)
	fn := srv.executeOperationByHashFunc(context.Background())
	_, err := fn(nil)
	assert.Error(t, err)
}

func TestExecuteOperationFunc_InvalidArgs(t *testing.T) {
	srv := newTestCodeModeServer(t)
	fn := srv.executeOperationByHashFunc(context.Background())
	// Pass a map instead of a string — should reject since hash must be a string
	_, err := fn([]any{map[string]any{"hash": "abc"}})
	assert.Error(t, err)
}

func TestExecuteOperationFunc_UnknownHash(t *testing.T) {
	srv := newTestCodeModeServer(t)
	fn := srv.executeOperationByHashFunc(context.Background())
	_, err := fn([]any{"nonexistent-hash"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "has expired from cache")
}

// --- Resource tests ---

func TestCodeModeServer_Resources(t *testing.T) {
	// Verify resources are registered (they're static content, so just check they exist)
	srv := newTestCodeModeServer(t)
	assert.NotNil(t, srv.mcpServer)

	// The resources are registered during NewCodeModeServer, we can't easily query them
	// through the MCP server without a client, so just verify the constants are non-empty
	assert.NotEmpty(t, executeTypeDefs)
	assert.NotEmpty(t, executeAPIResourceURI)
}

// --- Comprehensive sandbox security test ---

func TestSearch_NoGlobalLeak(t *testing.T) {
	srv := newTestCodeModeServer(t)

	// Execute should not have search functions available
	result := callExecuteTool(t, srv, `async () => {
		try { schema.queries; return "LEAKED"; } catch(e) { return "OK"; }
	}`)
	require.False(t, result.IsError)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "OK")
}

// --- generateQuery tests ---

type mockYokoClient struct {
	results   []yokoclient.QueryResult
	resultsFn func(prompt string) ([]yokoclient.QueryResult, error)
	err       error
}

func (m *mockYokoClient) Generate(_ context.Context, prompt string, _ string) ([]yokoclient.QueryResult, error) {
	if m.err != nil {
		return nil, m.err
	}
	if m.resultsFn != nil {
		return m.resultsFn(prompt)
	}
	return m.results, nil
}

func TestSearch_BasicPrompt(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		results: []yokoclient.QueryResult{
			{Query: "{ users { id name } }", Description: "Get all users"},
		},
	})

	result := callSearchTool(t, srv, "find all users")
	require.False(t, result.IsError, "expected no error, got: %+v", result)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "users")
	assert.Contains(t, text, "Get all users")
	assert.Contains(t, text, "execute")
	assert.Contains(t, text, "executeOperationByHash")
}

func TestSearch_YokoError(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		err: fmt.Errorf("yoko API unavailable"),
	})

	result := callSearchTool(t, srv, "test")
	assert.True(t, result.IsError)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "generation failed")
}

// --- Multi-call execute tests (BFF patterns) ---

func TestExecute_MultipleGraphQLCalls(t *testing.T) {
	var callCount atomic.Int32
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		query := body["query"].(string)
		if query == "{ users { id name } }" {
			_, _ = w.Write([]byte(`{"data":{"users":[{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]}}`))
		} else {
			_, _ = w.Write([]byte(`{"data":{"products":[{"id":"p1","title":"Widget"}]}}`))
		}
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	usersHash := srv.storeQueryHash("{ users { id name } }")
	prodsHash := srv.storeQueryHash("{ products { id title } }")
	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		const users = await executeOperationByHash("%s");
		const prods = await executeOperationByHash("%s");
		return {
			userCount: users.data.users.length,
			productCount: prods.data.products.length,
			combined: true
		};
	}`, usersHash, prodsHash))
	require.False(t, result.IsError, "unexpected error: %+v", result.Content)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "userCount")
	assert.Contains(t, text, "productCount")
	assert.Contains(t, text, "combined")
	assert.Equal(t, int32(2), callCount.Load(), "expected 2 GraphQL calls")
}

func TestExecute_PromiseAll(t *testing.T) {
	var callCount atomic.Int32
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := callCount.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(`{"data":{"call":%d}}`, n)))
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	usersHash := srv.storeQueryHash("{ users { id } }")
	prodsHash := srv.storeQueryHash("{ products { id } }")
	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		const [a, b, c] = await Promise.all([
			executeOperationByHash("%s"),
			executeOperationByHash("%s"),
			executeOperationByHash("%s")
		]);
		return { calls: [a.data, b.data, c.data] };
	}`, usersHash, prodsHash, usersHash))
	require.False(t, result.IsError, "unexpected error: %+v", result.Content)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "calls")
	assert.Equal(t, int32(3), callCount.Load(), "expected 3 GraphQL calls via Promise.all")
}

func TestExecute_ConditionalMutation(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		query := body["query"].(string)
		if query == "{ users { id name } }" {
			_, _ = w.Write([]byte(`{"data":{"users":[{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]}}`))
		} else {
			// mutation response
			_, _ = w.Write([]byte(`{"data":{"deleteUser":true}}`))
		}
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		RequireMutationApproval: false,
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	usersHash := srv.storeQueryHash("{ users { id name } }")
	deleteHash := srv.storeQueryHash("mutation($id: ID!) { deleteUser(id: $id) }")
	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		const users = await executeOperationByHash("%s");
		const bob = users.data.users.find(u => u.name === "Bob");
		if (bob) {
			const del = await executeOperationByHash("%s", { id: bob.id });
			return { action: "deleted", userId: bob.id, success: del.data.deleteUser };
		}
		return { action: "none" };
	}`, usersHash, deleteHash))
	require.False(t, result.IsError, "unexpected error: %+v", result.Content)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "deleted")
	assert.Contains(t, text, "userId")
}

func TestContract_ExecuteGlobalsMatchDescription(t *testing.T) {
	srv := newTestCodeModeServer(t)

	result := callExecuteTool(t, srv, `async () => {
		const errors = [];

		// executeOperationByHash must be a function
		if (typeof executeOperationByHash !== 'function') errors.push("executeOperationByHash is not a function");

		// executeOperationByHash must reject non-string arguments
		try {
			await executeOperationByHash({ hash: "abc" });
			errors.push("executeOperationByHash accepted an object, should require a hash string");
		} catch(e) {
			if (!e.message.includes("hash string")) {
				errors.push("executeOperationByHash rejection message unclear: " + e.message);
			}
		}

		// executeOperationByHash must reject unknown hashes
		try {
			await executeOperationByHash("unknown-hash");
			errors.push("executeOperationByHash accepted unknown hash");
		} catch(e) {
			if (!e.message.includes("has expired from cache")) {
				errors.push("executeOperationByHash unknown hash message unclear: " + e.message);
			}
		}

		return errors.length === 0 ? "OK" : errors;
	}`)
	require.False(t, result.IsError, "unexpected error: %+v", result.Content)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "OK")
}

// --- Query hash store tests ---

func TestQueryHashStore(t *testing.T) {
	srv := newTestCodeModeServer(t)

	hash := srv.storeQueryHash("{ users { id } }")
	assert.NotEmpty(t, hash)

	query, ok := srv.resolveQueryHash(hash)
	assert.True(t, ok)
	assert.Equal(t, "{ users { id } }", query)

	_, ok = srv.resolveQueryHash("nonexistent")
	assert.False(t, ok)
}

func TestQueryHashStore_Deterministic(t *testing.T) {
	srv := newTestCodeModeServer(t)

	h1 := srv.storeQueryHash("{ users { id } }")
	h2 := srv.storeQueryHash("{ users { id } }")
	assert.Equal(t, h1, h2)
}

func TestSearch_ReturnsHash(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		results: []yokoclient.QueryResult{
			{Query: "{ users { id name } }", Description: "Get all users"},
		},
	})

	result := callSearchTool(t, srv, "find all users")
	require.False(t, result.IsError, "expected no error, got: %+v", result)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "hash")
	assert.Contains(t, text, "users")
}

func TestExecute_GraphQLWithHash(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"users":[{"id":"1"}]}}`))
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	// Pre-store a query hash
	hash := srv.storeQueryHash("{ users { id } }")

	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		const result = await executeOperationByHash("%s");
		return result;
	}`, hash))
	require.False(t, result.IsError, "unexpected error: %+v", result.Content)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "data")
	assert.Contains(t, text, "users")
}

func TestExecute_GraphQLWithUnknownHash(t *testing.T) {
	srv := newTestCodeModeServer(t)

	result := callExecuteTool(t, srv, `async () => {
		try {
			await executeOperationByHash("deadbeef");
			return "SHOULD_FAIL";
		} catch(e) {
			return "ERROR: " + e.message;
		}
	}`)
	require.False(t, result.IsError)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "has expired from cache")
}

// --- TOON encoding tests ---

func TestFormatToolResult_TOON(t *testing.T) {
	srv := newTestCodeModeServer(t)
	raw := json.RawMessage(`{"users":[{"id":1,"name":"Alice","role":"admin"},{"id":2,"name":"Bob","role":"user"}]}`)
	result := srv.formatToolResult(raw)

	// TOON output should differ from JSON
	assert.NotEqual(t, string(raw), result)
	assert.Contains(t, result, "users")
	assert.Contains(t, result, "Alice")
	assert.Contains(t, result, "Bob")
}

func TestFormatToolResult_FallbackOnInvalidInput(t *testing.T) {
	srv := newTestCodeModeServer(t)
	raw := json.RawMessage(`not valid json`)
	result := srv.formatToolResult(raw)
	assert.Equal(t, "not valid json", result)
}

func TestExecute_TOONByDefault(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"employees":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}}`))
	}))
	defer mockServer.Close()

	cfg := CodeModeServerConfig{
		SandboxConfig: sandbox.ExecutionConfig{
			Timeout:        30 * time.Second,
			MaxMemoryMB:    16,
			MaxOutputBytes: 1024 * 1024,
		},
		Logger:                zap.NewNop(),
		RouterGraphQLEndpoint: mockServer.URL,
	}
	srv, err := newCodeModeServerWithSchema(t, cfg)
	require.NoError(t, err)

	hash := srv.storeQueryHash("{ employees { id name } }")
	// No toon parameter — TOON is now the default
	result := callExecuteTool(t, srv, fmt.Sprintf(`async () => {
		return await executeOperationByHash("%s");
	}`, hash))
	require.False(t, result.IsError)

	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "Alice")
	assert.Contains(t, text, "Bob")
	// TOON output should not be valid JSON
	var discard any
	err = json.Unmarshal([]byte(text), &discard)
	assert.Error(t, err, "expected TOON output, got valid JSON")
}

func TestSearch_TOONByDefault(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		results: []yokoclient.QueryResult{
			{Query: "{ users { id name } }", Description: "Get all users"},
		},
	})

	result := callSearchTool(t, srv, "find all users")
	require.False(t, result.IsError)

	text := result.Content[0].(mcp.TextContent).Text
	var discard any
	err := json.Unmarshal([]byte(text), &discard)
	assert.Error(t, err, "expected TOON output, got valid JSON")
	assert.Contains(t, text, "users")
}

// --- Multi-prompt search tests ---

func TestSearch_MultiplePrompts(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		resultsFn: func(prompt string) ([]yokoclient.QueryResult, error) {
			switch prompt {
			case "find users":
				return []yokoclient.QueryResult{
					{Query: "{ users { id } }", Description: "Get users"},
				}, nil
			case "find products":
				return []yokoclient.QueryResult{
					{Query: "{ products { id } }", Description: "Get products"},
				}, nil
			default:
				return nil, fmt.Errorf("unexpected prompt: %s", prompt)
			}
		},
	})

	result := callSearchTool(t, srv, "find users", "find products")
	require.False(t, result.IsError, "unexpected error: %+v", result)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "Get users")
	assert.Contains(t, text, "Get products")
}

func TestSearch_PartialFailure(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		resultsFn: func(prompt string) ([]yokoclient.QueryResult, error) {
			if prompt == "good" {
				return []yokoclient.QueryResult{
					{Query: "{ ok { id } }", Description: "OK query"},
				}, nil
			}
			return nil, fmt.Errorf("generation failed")
		},
	})

	result := callSearchTool(t, srv, "good", "bad")
	require.False(t, result.IsError, "unexpected error: %+v", result)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "OK query")
}

func TestSearch_ExecuteSnippetWithVariables(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		results: []yokoclient.QueryResult{
			{
				Query:       "query($id: ID!) { user(id: $id) { name } }",
				Variables:   map[string]any{"id": "123"},
				Description: "Get user by ID",
			},
		},
	})

	result := callSearchTool(t, srv, "get user by id")
	require.False(t, result.IsError, "unexpected error: %+v", result)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "executeOperationByHash")
	assert.Contains(t, text, "123")
}

func TestSearch_ExecuteSnippetWithoutVariables(t *testing.T) {
	srv := newTestCodeModeServer(t)
	srv.SetYokoClient(&mockYokoClient{
		results: []yokoclient.QueryResult{
			{Query: "{ users { id } }", Description: "Get users"},
		},
	})

	result := callSearchTool(t, srv, "find users")
	require.False(t, result.IsError, "unexpected error: %+v", result)
	text := result.Content[0].(mcp.TextContent).Text
	assert.Contains(t, text, "executeOperationByHash")
	// Should not contain variable object when no variables
	assert.NotContains(t, text, "variables")
}

