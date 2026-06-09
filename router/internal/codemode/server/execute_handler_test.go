package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/harness"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/cosmo/router/internal/codemode/tsgen"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

func TestHandleExecuteValidatesSource(t *testing.T) {
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Pipeline:         &recordingPipeline{},
	}, newExecuteTestStorage())

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "",
	}))

	require.NoError(t, err)
	assert.Equal(t, toolError("code_mode_run_js: source must be a non-empty string"), got)
}

func TestHandleExecuteNamedOpsDisabled(t *testing.T) {
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  false,
		SessionStateless: false,
		Pipeline:         &recordingPipeline{},
	}, newExecuteTestStorage())

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "async () => null",
	}))

	require.NoError(t, err)
	assert.Equal(t, toolError("named operations are disabled"), got)
}

func TestHandleExecuteStatelessDisablesNamedOps(t *testing.T) {
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: true,
		Pipeline:         &recordingPipeline{},
	}, newExecuteTestStorage())

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "async () => null",
	}))

	require.NoError(t, err)
	assert.Equal(t, toolError("named operations are disabled"), got)
}

func TestHandleExecuteStatefulHappyPathReturnsEncodedEnvelope(t *testing.T) {
	store := newExecuteTestStorage()
	store.ops["session-1"] = []storage.SessionOp{{
		Name: "someName",
		Body: "query SomeName { orders { id total } }",
		Kind: storage.OperationKindQuery,
	}}
	pipeline := &recordingPipeline{
		response: pipelineResponse(t, harness.ResultEnvelope{
			Result:    json.RawMessage(`{"orders":[{"id":"o1","total":12.5}]}`),
			Truncated: false,
			Error:     nil,
		}),
	}
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Pipeline:         pipeline,
		ApprovalGate:     sandbox.AutoApprove,
	}, store)

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "async () => { const r = await tools.someName({}); return r.data; }",
	}))

	require.NoError(t, err)
	assert.Equal(t, textToolResult(string(pipeline.response.Encoded)), got)
	assert.Equal(t, harness.PipelineRequest{
		SessionID: "session-1",
		ToolNames: []string{
			"someName",
		},
		Source: "async () => { const r = await tools.someName({}); return r.data; }",
		RequestHeaders: http.Header{
			mcpSessionIDHeader: []string{"session-1"},
			"X-Test":           []string{"yes"},
		},
		ApprovalGate: sandbox.AutoApprove,
	}, pipeline.lastRequest())

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(pipeline.response.Encoded, &decoded))
	assert.Equal(t, map[string]any{
		"result": map[string]any{
			"orders": []any{
				map[string]any{"id": "o1", "total": 12.5},
			},
		},
	}, decoded)
}

func TestHandleExecuteSandboxErrorEnvelopeReturnsAsText(t *testing.T) {
	store := newExecuteTestStorage()
	store.ops["session-1"] = []storage.SessionOp{{Name: "someName", Body: "query SomeName { orders { id } }", Kind: storage.OperationKindQuery}}
	pipeline := &recordingPipeline{
		response: pipelineResponse(t, harness.ResultEnvelope{
			Result:    json.RawMessage("null"),
			Truncated: false,
			Error:     &harness.ErrorEnvelope{Name: "RuntimeError", Message: "boom", Stack: "stack"},
		}),
	}
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Pipeline:         pipeline,
	}, store)

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "async () => { throw new Error('boom'); }",
	}))

	require.NoError(t, err)
	assert.Equal(t, textToolResult(string(pipeline.response.Encoded)), got)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(pipeline.response.Encoded, &decoded))
	assert.Equal(t, map[string]any{
		"result": nil,
		"error": map[string]any{
			"name":    "RuntimeError",
			"message": "boom",
			"stack":   "stack",
		},
	}, decoded)
}

func TestHandleExecutePerCallTimeoutRoutesEnvelope(t *testing.T) {
	store := newExecuteTestStorage()
	store.ops["session-1"] = []storage.SessionOp{{Name: "someName", Body: "query SomeName { orders { id } }", Kind: storage.OperationKindQuery}}
	pipeline := &recordingPipeline{sleep: 100 * time.Millisecond}
	pipeline.onCancel = pipelineResponse(t, harness.ResultEnvelope{
		Result:    json.RawMessage("null"),
		Truncated: false,
		Error:     &harness.ErrorEnvelope{Name: "Timeout", Message: "context deadline exceeded", Stack: ""},
	})
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		ExecuteTimeout:   10 * time.Millisecond,
		Pipeline:         pipeline,
	}, store)

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "async () => tools.someName({})",
	}))

	require.NoError(t, err)
	assert.Equal(t, textToolResult(string(pipeline.onCancel.Encoded)), got)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(pipeline.onCancel.Encoded, &decoded))
	assert.Equal(t, map[string]any{
		"result": nil,
		"error": map[string]any{
			"name":    "Timeout",
			"message": "context deadline exceeded",
			"stack":   "",
		},
	}, decoded)
}

func TestHandleExecuteTranspileErrorEnvelopeReturnsAsText(t *testing.T) {
	store := newExecuteTestStorage()
	store.ops["session-1"] = []storage.SessionOp{{Name: "someName", Body: "query SomeName { orders { id } }", Kind: storage.OperationKindQuery}}
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Pipeline:         &harness.Pipeline{},
	}, store)

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "async () => { let x = ; }",
	}))

	require.NoError(t, err)
	require.Len(t, got.Content, 1)
	text, ok := got.Content[0].(*mcp.TextContent)
	require.True(t, ok)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal([]byte(text.Text), &decoded))
	assert.Equal(t, map[string]any{
		"result": nil,
		"error": map[string]any{
			"name":    "TranspileError",
			"message": "transpile failed: Unexpected \";\"",
			"stack":   "",
		},
	}, decoded)
}

func TestPersistedOpsResourceReturnsCumulativeBundle(t *testing.T) {
	schema := searchHandlerTestSchema(t)
	store := storage.NewMemoryBackend(storage.MemoryConfig{Renderer: tsgen.Adapter(schema, 0)})
	store.SetSchema(schema)
	_, err := store.Append(context.Background(), "session-1", []storage.SessionOp{{
		Name:        "getOrders",
		Body:        "query GetOrders($limit: Int) { orders(limit: $limit) { id total } }",
		Kind:        storage.OperationKindQuery,
		Description: "Fetch orders.",
	}})
	require.NoError(t, err)
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Storage:          store,
		Pipeline:         &recordingPipeline{},
	}, nil)

	got, err := srv.handlePersistedOpsResource(context.Background(), resourceRequest("session-1"))

	require.NoError(t, err)
	wantBundle, err := tsgen.RenderBundle([]storage.SessionOp{{
		Name:        "getOrders",
		Body:        "query GetOrders($limit: Int) { orders(limit: $limit) { id total } }",
		Kind:        storage.OperationKindQuery,
		Description: "Fetch orders.",
	}}, schema, 0)
	require.NoError(t, err)
	assert.Equal(t, &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{
			URI:      persistedOpsURI,
			MIMEType: "text/plain",
			Text:     wantBundle,
		}},
	}, got)
}

func TestPersistedOpsResourceWithoutSessionReturnsEmptyBundle(t *testing.T) {
	schema := searchHandlerTestSchema(t)
	store := storage.NewMemoryBackend(storage.MemoryConfig{Renderer: tsgen.Adapter(schema, 0)})
	store.SetSchema(schema)
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Storage:          store,
		Pipeline:         &recordingPipeline{},
	}, nil)

	got, err := srv.handlePersistedOpsResource(context.Background(), resourceRequest(""))

	require.NoError(t, err)
	wantBundle, err := tsgen.RenderBundle(nil, schema, 0)
	require.NoError(t, err)
	assert.Equal(t, &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{
			URI:      persistedOpsURI,
			MIMEType: "text/plain",
			Text:     wantBundle,
		}},
	}, got)
}

type recordingPipeline struct {
	mu       sync.Mutex
	requests []harness.PipelineRequest
	response harness.PipelineResponse
	onCancel harness.PipelineResponse
	sleep    time.Duration
	err      error
	lastSpan trace.SpanContext
}

func (p *recordingPipeline) Execute(ctx context.Context, req harness.PipelineRequest) (harness.PipelineResponse, error) {
	p.mu.Lock()
	p.requests = append(p.requests, req)
	p.lastSpan = trace.SpanFromContext(ctx).SpanContext()
	p.mu.Unlock()

	if p.sleep > 0 {
		select {
		case <-ctx.Done():
			return p.onCancel, nil
		case <-time.After(p.sleep):
		}
	}
	if p.err != nil {
		return harness.PipelineResponse{}, p.err
	}
	return p.response, nil
}

func (p *recordingPipeline) lastRequest() harness.PipelineRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.requests) == 0 {
		return harness.PipelineRequest{}
	}
	return p.requests[len(p.requests)-1]
}

func (p *recordingPipeline) lastSpanContext() trace.SpanContext {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.lastSpan
}

type executeTestStorage struct {
	mu  sync.Mutex
	ops map[string][]storage.SessionOp
}

func newExecuteTestStorage() *executeTestStorage {
	return &executeTestStorage{ops: make(map[string][]storage.SessionOp)}
}

func (s *executeTestStorage) Append(_ context.Context, sessionID string, ops []storage.SessionOp) ([]storage.SessionOp, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ops[sessionID] = append(s.ops[sessionID], ops...)
	return ops, nil
}

func (s *executeTestStorage) GetOp(_ context.Context, sessionID string, name string) (storage.SessionOp, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, op := range s.ops[sessionID] {
		if op.Name == name {
			return op, true, nil
		}
	}
	return storage.SessionOp{}, false, nil
}

func (s *executeTestStorage) ListNames(_ context.Context, sessionID string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.ops[sessionID]))
	for _, op := range s.ops[sessionID] {
		names = append(names, op.Name)
	}
	return names, nil
}

func (s *executeTestStorage) Bundle(context.Context, string) (string, error) {
	return "", nil
}

func (s *executeTestStorage) Reset(_ context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.ops, sessionID)
	return nil
}

func (s *executeTestStorage) SetSchema(*ast.Document) {}

func (s *executeTestStorage) Schema() *ast.Document { return nil }

func (s *executeTestStorage) Start(context.Context) error { return nil }

func (s *executeTestStorage) Stop() error { return nil }

func pipelineResponse(t *testing.T, envelope harness.ResultEnvelope) harness.PipelineResponse {
	t.Helper()
	encoded, err := json.Marshal(envelope)
	require.NoError(t, err)
	return harness.PipelineResponse{Envelope: envelope, Encoded: encoded}
}

func executeToolRequest(t *testing.T, sessionID string, arguments map[string]any) *mcp.CallToolRequest {
	t.Helper()
	body, err := json.Marshal(arguments)
	require.NoError(t, err)
	return &mcp.CallToolRequest{
		Params: &mcp.CallToolParamsRaw{
			Name:      "code_mode_run_js",
			Arguments: body,
		},
		Extra: &mcp.RequestExtra{Header: http.Header{
			mcpSessionIDHeader: []string{sessionID},
			"X-Test":           []string{"yes"},
		}},
	}
}

func resourceRequest(sessionID string) *mcp.ReadResourceRequest {
	return &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: persistedOpsURI},
		Extra:  &mcp.RequestExtra{Header: http.Header{mcpSessionIDHeader: []string{sessionID}}},
	}
}

func newExecuteTestServer(t *testing.T, cfg Config, store storage.SessionStorage) *Server {
	t.Helper()
	if store != nil {
		cfg.Storage = store
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}
	srv, err := New(cfg)
	require.NoError(t, err)
	return srv
}
