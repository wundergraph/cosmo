package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/server/descriptions"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/cosmo/router/internal/codemode/yoko"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestStartDisabledReturnsWithoutBinding(t *testing.T) {
	srv, err := New(Config{
		ListenAddr:       "127.0.0.1:0",
		CodeModeEnabled:  false,
		Storage:          newRecordingStorage(),
		YokoClient:       yoko.New(nil, "http://127.0.0.1", zap.NewNop()),
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.NewNop(),
		NamedOpsEnabled:  true,
		SessionStateless: false,
	})
	require.NoError(t, err)

	err = srv.Start(context.Background())

	require.NoError(t, err)
	assert.Equal(t, "", srv.addr())
	require.NoError(t, srv.Stop(context.Background()))
}

func TestListToolsReturnsCodeModeTools(t *testing.T) {
	srv := newTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	startServer(t, ctx, srv)
	defer stopServer(t, srv)

	session := connectHTTPClient(t, ctx, "http://"+srv.addr()+"/mcp")
	defer session.Close()

	got, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	require.NoError(t, err)
	require.Len(t, got.Tools, 2)
	slices.SortFunc(got.Tools, func(a, b *mcp.Tool) int {
		if a.Name < b.Name {
			return -1
		}
		if a.Name > b.Name {
			return 1
		}
		return 0
	})

	assert.Equal(t, mustJSON(t, []*mcp.Tool{
		{
			Name:        "code_mode_run_js",
			Description: descriptions.ExecuteTool,
			InputSchema: map[string]any{
				"type":     "object",
				"required": []any{"source"},
				"properties": map[string]any{
					"source": map[string]any{
						"type":        "string",
						"minLength":   float64(1),
						"description": descriptions.ExecuteSource,
					},
				},
			},
		},
		{
			Name:        "code_mode_search_tools",
			Description: descriptions.SearchTool,
			InputSchema: map[string]any{
				"type":     "object",
				"required": []any{"prompts"},
				"properties": map[string]any{
					"prompts": map[string]any{
						"type":     "array",
						"minItems": float64(1),
						"maxItems": float64(20),
						"items": map[string]any{
							"type":      "string",
							"minLength": float64(1),
						},
					},
				},
			},
		},
	}), mustJSON(t, got.Tools))
}

func TestListResourcesGating(t *testing.T) {
	tests := []struct {
		name        string
		cfg         Config
		wantPresent bool
	}{
		{
			name: "code mode disabled",
			cfg: Config{
				CodeModeEnabled:  false,
				NamedOpsEnabled:  true,
				SessionStateless: false,
			},
		},
		{
			name: "named ops disabled",
			cfg: Config{
				CodeModeEnabled:  true,
				NamedOpsEnabled:  false,
				SessionStateless: false,
			},
		},
		{
			name: "stateless disables named ops",
			cfg: Config{
				CodeModeEnabled:  true,
				NamedOpsEnabled:  true,
				SessionStateless: true,
			},
		},
		{
			name: "stateful named ops",
			cfg: Config{
				CodeModeEnabled:  true,
				NamedOpsEnabled:  true,
				SessionStateless: false,
			},
			wantPresent: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newTestServer(t, tt.cfg)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			session := connectInMemoryClient(t, ctx, srv)
			defer session.Close()

			got, err := session.ListResources(ctx, &mcp.ListResourcesParams{})
			require.NoError(t, err)
			assert.Equal(t, tt.wantPresent, hasResource(got.Resources, persistedOpsURI))
		})
	}
}

func TestStatelessNamedOpsReloadWarnsOnce(t *testing.T) {
	core, recorded := observer.New(zap.WarnLevel)
	store := newRecordingStorage()
	client := yoko.New(nil, "http://127.0.0.1", zap.NewNop())
	srv, err := New(Config{
		ListenAddr:       "127.0.0.1:0",
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: true,
		Storage:          store,
		YokoClient:       client,
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.New(core),
	})
	require.NoError(t, err)

	require.NoError(t, srv.Reload(&ast.Document{}, "schema { query: Query }"))
	require.NoError(t, srv.Reload(&ast.Document{}, "schema { query: Query }"))

	assert.Equal(t, 1, recorded.FilterMessage(statelessNamedOpsWarnMessage).Len())
}

func TestExecuteToolStubReturnsDeterministicToolError(t *testing.T) {
	srv := newTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  false,
		SessionStateless: false,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	startServer(t, ctx, srv)
	defer stopServer(t, srv)

	session := connectHTTPClient(t, ctx, "http://"+srv.addr()+"/mcp")
	defer session.Close()

	executeResult, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name:      "code_mode_run_js",
		Arguments: map[string]any{"source": "async () => null"},
	})
	require.NoError(t, err)
	assert.Equal(t, mustJSON(t, toolError("named operations are disabled")), mustJSON(t, executeResult))
}

func TestSessionIDExtraction(t *testing.T) {
	req, err := http.NewRequest(http.MethodPost, "http://example.com/mcp", nil)
	require.NoError(t, err)
	req.Header.Set("Mcp-Session-Id", "session-123")

	ctx := withSessionIDFromRequest(context.Background(), req)

	assert.Equal(t, "session-123", SessionIDFromContext(ctx))
	assert.Equal(t, "", SessionIDFromContext(context.Background()))
	assert.Equal(t, "manual", SessionIDFromContext(WithSessionID(context.Background(), "manual")))
}

func TestResourceHandlerUsesCurrentSessionID(t *testing.T) {
	store := newRecordingStorage()
	store.bundle = "declare const tools: { getUser(): R<{ id: string }> };"
	srv := newTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Storage:          store,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	startServer(t, ctx, srv)
	defer stopServer(t, srv)

	session := connectHTTPClient(t, ctx, "http://"+srv.addr()+"/mcp")
	defer session.Close()

	got, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: persistedOpsURI})
	require.NoError(t, err)

	require.NotEmpty(t, session.ID())
	assert.Equal(t, session.ID(), store.lastBundleSessionID())
	assert.Equal(t, mustJSON(t, &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{
			URI:      persistedOpsURI,
			MIMEType: "text/plain",
			Text:     store.bundle,
		}},
	}), mustJSON(t, got))
}

func TestReloadForwardsSchemaAndSDL(t *testing.T) {
	store := newRecordingStorage()
	client := yoko.New(nil, "http://127.0.0.1", zap.NewNop())
	srv, err := New(Config{
		ListenAddr:       "127.0.0.1:0",
		CodeModeEnabled:  true,
		NamedOpsEnabled:  false,
		SessionStateless: false,
		Storage:          store,
		YokoClient:       client,
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)

	schema := &ast.Document{}
	require.NoError(t, srv.Reload(schema, "schema { query: Query }"))

	assert.Equal(t, schema, store.schema)
	assert.Equal(t, 1, store.setSchemaCalls)
	assert.Equal(t, "schema { query: Query }", client.Schema())
}

func TestReloadEagerlyIndexesViaBackgroundGoroutine(t *testing.T) {
	core, recorded := observer.New(zap.InfoLevel)
	searcher := newFakeYoko()
	srv, err := New(Config{
		ListenAddr:       "127.0.0.1:0",
		CodeModeEnabled:  true,
		NamedOpsEnabled:  false,
		SessionStateless: false,
		Storage:          newRecordingStorage(),
		YokoClient:       searcher,
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.New(core),
	})
	require.NoError(t, err)

	require.NoError(t, srv.Reload(&ast.Document{}, "schema { query: Query }"))

	require.Eventually(t, func() bool {
		return searcher.ensureIndexedCallCount() == 1
	}, 2*time.Second, 5*time.Millisecond, "eager index should fire once after Reload")

	require.Eventually(t, func() bool {
		return recorded.FilterMessage("code mode eager schema index started").Len() == 1 &&
			recorded.FilterMessage("code mode eager schema index completed").Len() == 1
	}, 2*time.Second, 5*time.Millisecond, "expected start+completed info logs")
}

func TestReloadEagerIndexLogsWarnOnFailure(t *testing.T) {
	core, recorded := observer.New(zap.InfoLevel)
	searcher := newFakeYoko()
	searcher.ensureIndexedErr = errors.New("yoko unreachable")
	srv, err := New(Config{
		ListenAddr:       "127.0.0.1:0",
		CodeModeEnabled:  true,
		NamedOpsEnabled:  false,
		SessionStateless: false,
		Storage:          newRecordingStorage(),
		YokoClient:       searcher,
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.New(core),
	})
	require.NoError(t, err)

	require.NoError(t, srv.Reload(&ast.Document{}, "schema { query: Query }"))

	require.Eventually(t, func() bool {
		return recorded.FilterMessage("code mode eager schema index started").Len() == 1 &&
			recorded.FilterMessage("code mode eager schema index failed").Len() == 1 &&
			recorded.FilterMessage("code mode eager schema index completed").Len() == 0
	}, 2*time.Second, 5*time.Millisecond, "expected start+failed logs without completed log")
}

func TestReloadEagerIndexSkippedWhenSDLEmpty(t *testing.T) {
	searcher := newFakeYoko()
	srv, err := New(Config{
		ListenAddr:       "127.0.0.1:0",
		CodeModeEnabled:  true,
		NamedOpsEnabled:  false,
		SessionStateless: false,
		Storage:          newRecordingStorage(),
		YokoClient:       searcher,
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)

	require.NoError(t, srv.Reload(&ast.Document{}, ""))

	// Give the goroutine that EnsureIndexed *would* have launched a chance to
	// run; assert it never did.
	time.Sleep(50 * time.Millisecond)
	assert.Equal(t, 0, searcher.ensureIndexedCallCount())
}

func TestReloadDisabledIsNoOp(t *testing.T) {
	store := newRecordingStorage()
	client := yoko.New(nil, "http://127.0.0.1", zap.NewNop())
	srv, err := New(Config{
		ListenAddr:       "127.0.0.1:0",
		CodeModeEnabled:  false,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Storage:          store,
		YokoClient:       client,
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)

	require.NoError(t, srv.Reload(&ast.Document{}, "schema { query: Query }"))

	assert.Equal(t, 0, store.setSchemaCalls)
	assert.Equal(t, "", client.Schema())
}

func newTestServer(t *testing.T, cfg Config) *Server {
	t.Helper()
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = "127.0.0.1:0"
	}
	if cfg.Storage == nil {
		cfg.Storage = newRecordingStorage()
	}
	if cfg.YokoClient == nil {
		cfg.YokoClient = yoko.New(nil, "http://127.0.0.1", zap.NewNop())
	}
	if cfg.BundleRenderer == nil {
		cfg.BundleRenderer = storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil })
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}
	srv, err := New(cfg)
	require.NoError(t, err)
	return srv
}

func startServer(t *testing.T, ctx context.Context, srv *Server) {
	t.Helper()
	errs := make(chan error, 1)
	go func() {
		errs <- srv.Start(ctx)
	}()
	deadline := time.After(5 * time.Second)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	bound := false
	for {
		select {
		case err := <-errs:
			if isBindPermissionError(err) {
				t.Skipf("local listener bind is not permitted in this environment: %v", err)
			}
			require.NoError(t, err)
		case <-deadline:
			require.FailNow(t, "server listener was not bound")
		case <-tick.C:
			if srv.addr() != "" {
				bound = true
			}
		}
		if bound {
			break
		}
	}
	t.Cleanup(func() {
		select {
		case err := <-errs:
			require.NoError(t, err)
		case <-time.After(5 * time.Second):
			require.FailNow(t, "server did not stop")
		}
	})
}

func isBindPermissionError(err error) bool {
	return errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM)
}

func stopServer(t *testing.T, srv *Server) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, srv.Stop(ctx))
}

func connectHTTPClient(t *testing.T, ctx context.Context, endpoint string) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "code-mode-test-client", Version: "test"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:             endpoint,
		DisableStandaloneSSE: true,
	}, nil)
	require.NoError(t, err)
	return session
}

func connectInMemoryClient(t *testing.T, ctx context.Context, srv *Server) *mcp.ClientSession {
	t.Helper()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	errs := make(chan error, 1)
	go func() {
		errs <- srv.mcpServer.Run(ctx, serverTransport)
	}()
	t.Cleanup(func() {
		select {
		case err := <-errs:
			if err != nil && !errors.Is(err, context.Canceled) {
				require.NoError(t, err)
			}
		default:
		}
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "code-mode-test-client", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	require.NoError(t, err)
	return session
}

func hasResource(resources []*mcp.Resource, uri string) bool {
	return slices.ContainsFunc(resources, func(resource *mcp.Resource) bool {
		return resource.URI == uri
	})
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return string(data)
}

func toolError(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: message}},
		IsError: true,
	}
}

type recordingStorage struct {
	mu              sync.Mutex
	schema          *ast.Document
	setSchemaCalls  int
	bundle          string
	bundleSessionID string
}

func newRecordingStorage() *recordingStorage {
	return &recordingStorage{bundle: "declare const tools: {};"}
}

func (s *recordingStorage) Append(_ context.Context, _ string, ops []storage.SessionOp) ([]storage.SessionOp, error) {
	return ops, nil
}

func (s *recordingStorage) GetOp(context.Context, string, string) (storage.SessionOp, bool, error) {
	return storage.SessionOp{}, false, nil
}

func (s *recordingStorage) ListNames(context.Context, string) ([]string, error) {
	return nil, nil
}

func (s *recordingStorage) Bundle(_ context.Context, sessionID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bundleSessionID = sessionID
	return s.bundle, nil
}

func (s *recordingStorage) Reset(context.Context, string) error {
	return nil
}

func (s *recordingStorage) SetSchema(schema *ast.Document) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.schema = schema
	s.setSchemaCalls++
}

func (s *recordingStorage) Schema() *ast.Document {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.schema
}

func (s *recordingStorage) Start(context.Context) error {
	return nil
}

func (s *recordingStorage) Stop() error {
	return nil
}

func (s *recordingStorage) lastBundleSessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bundleSessionID
}
