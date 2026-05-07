package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	miniredis "github.com/alicebob/miniredis/v2"
	mark3mcp "github.com/mark3labs/mcp-go/mcp"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
	yokoconnect "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1/yokov1connect"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
)

const codeModePersistedOpsURI = "yoko://persisted-ops.d.ts"

const (
	firstEmployeeOpName = "firstEmployee"
	employeeByIDOpName  = "employeeByID"
	updateTagOpName     = "updateEmployeeTag"

	firstEmployeeQuery = `query firstEmployee { firstEmployee { id details { forename surname } } }`
	employeeByIDQuery  = `query employeeByID($id: Int!) { employee(id: $id) { id details { forename surname } } }`
	updateTagMutation  = `mutation updateEmployeeTag($id: Int!, $tag: String!) { updateEmployeeTag(id: $id, tag: $tag) { id tag } }`
)

const firstEmployeeTS = `/** Fetch the first employee. */
firstEmployee(): R<{ firstEmployee: { id: number; details: { forename: string; surname: string } | null } }>;`

const employeeByIDTS = `/** Fetch employee by id. */
employeeByID(vars: { id: number }): R<{ employee: { id: number; details: { forename: string; surname: string } | null } | null }>;`

const updateTagTS = `/** Update employee tag. */
updateEmployeeTag(vars: { id: number; tag: string }): R<{ updateEmployeeTag: { id: number; tag: string } | null }>;`

const twoOpsFragment = firstEmployeeTS + "\n\n" + employeeByIDTS

// indentBundleEntry mirrors tsgen's behavior: every line of a per-op block
// (JSDoc + signature) is indented by 2 spaces inside the tools object.
func indentBundleEntry(s string) string {
	return "  " + strings.ReplaceAll(s, "\n", "\n  ")
}

const emptyOpsBundle = `type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };
type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;
// Known limitation: union and interface selections are typed as unknown.

declare const tools: {};

declare function notNull<T>(value: T | null | undefined, message?: string): T;
declare function compact<T>(value: T): T;`

var firstEmployeeBundle = `type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };
type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;
// Known limitation: union and interface selections are typed as unknown.

declare const tools: {
` + indentBundleEntry(firstEmployeeTS) + `
};

declare function notNull<T>(value: T | null | undefined, message?: string): T;
declare function compact<T>(value: T): T;`

var employeeByIDBundle = `type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };
type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;
// Known limitation: union and interface selections are typed as unknown.

declare const tools: {
` + indentBundleEntry(employeeByIDTS) + `
};

declare function notNull<T>(value: T | null | undefined, message?: string): T;
declare function compact<T>(value: T): T;`

var twoOpsBundle = `type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };
type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;
// Known limitation: union and interface selections are typed as unknown.

declare const tools: {
` + indentBundleEntry(firstEmployeeTS) + `

` + indentBundleEntry(employeeByIDTS) + `
};

declare function notNull<T>(value: T | null | undefined, message?: string): T;
declare function compact<T>(value: T): T;`

type codeModeBackend struct {
	name       string
	providerID string
	redisURL   string
}

func TestCodeModeNamedOpsMemoryBackendStatefulSearchExecuteAndResource(t *testing.T) {
	withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{}, func(ctx context.Context, _ string, xEnv *testenv.Environment, yoko *fakeCodeModeYoko, session *mcp.ClientSession) {
		searchText := callCodeModeToolText(t, ctx, session, "code_mode_search_tools", map[string]any{
			"prompts": []string{"first employee", "employee by id"},
		})
		assert.Equal(t, twoOpsFragment, searchText)
		assert.Equal(t, []*yokov1.IndexRequest{{SchemaSdl: yoko.indexRequests()[0].GetSchemaSdl()}}, yoko.indexRequests())
		assert.Equal(t, []*yokov1.SearchRequest{{
			Prompts:   []string{"first employee", "employee by id"},
			SchemaId:  "schema-1",
			SessionId: yoko.searchRequests()[0].GetSessionId(),
		}}, yoko.searchRequests())

		resource := readPersistedOpsResource(t, ctx, session)
		assert.Equal(t, &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI:      codeModePersistedOpsURI,
			MIMEType: "text/plain",
			Text:     twoOpsBundle,
		}}}, resource)

		executeText := callCodeModeToolText(t, ctx, session, "code_mode_run_js", map[string]any{
			"source": `async () => { return await tools.employeeByID({ id: 1 }); }`,
		})
		assert.Equal(t, map[string]any{
			"result": map[string]any{
				"data": map[string]any{
					"employee": map[string]any{
						"id": float64(1),
						"details": map[string]any{
							"forename": "Jens",
							"surname":  "Neuse",
						},
					},
				},
			},
		}, decodeJSON(t, executeText))

		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employee(id: 1) { id details { forename surname } } }`})
		assert.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
	})
}

func TestCodeModeNamedOpsConcurrentSessions(t *testing.T) {
	withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{}, func(ctx context.Context, endpoint string, _ *testenv.Environment, _ *fakeCodeModeYoko, sessionA *mcp.ClientSession) {
		searchText := callCodeModeToolText(t, ctx, sessionA, "code_mode_search_tools", map[string]any{
			"prompts": []string{"first employee"},
		})
		assert.Equal(t, firstEmployeeTS, searchText)

		sessionB := newCodeModeMCPClient(t, ctx, endpoint, nil)
		resourceA := readPersistedOpsResource(t, ctx, sessionA)
		resourceB := readPersistedOpsResource(t, ctx, sessionB)

		assert.Equal(t, &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI:      codeModePersistedOpsURI,
			MIMEType: "text/plain",
			Text:     firstEmployeeBundle,
		}}}, resourceA)
		assert.Equal(t, &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI:      codeModePersistedOpsURI,
			MIMEType: "text/plain",
			Text:     emptyOpsBundle,
		}}}, resourceB)
	})
}

func TestCodeModeNamedOpsSchemaReloadEvictsSession(t *testing.T) {
	poller := &codeModeConfigPoller{ready: make(chan struct{})}
	withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{poller: poller}, func(ctx context.Context, _ string, _ *testenv.Environment, _ *fakeCodeModeYoko, session *mcp.ClientSession) {
		searchText := callCodeModeToolText(t, ctx, session, "code_mode_search_tools", map[string]any{
			"prompts": []string{"employee by id"},
		})
		assert.Equal(t, employeeByIDTS, searchText)

		<-poller.ready
		poller.initConfig.Version = "code-mode-reload"
		require.NoError(t, poller.updateConfig(poller.initConfig, "before-code-mode-reload"))

		executeText := callCodeModeToolText(t, ctx, session, "code_mode_run_js", map[string]any{
			"source": `async () => { return await tools.employeeByID({ id: 1 }); }`,
		})
		assert.Equal(t, map[string]any{
			"result": nil,
			"error": map[string]any{
				"name":    "TypeError",
				"message": "tools.employeeByID is not a function",
				"stack":   "    at __agentMain (codemode_agent.js:agent.ts:1:34)\n    at <anonymous> (codemode_agent.js:73:42)\n    at <eval> (codemode_agent.js:77:1)\n",
			},
		}, decodeJSON(t, executeText))
	})
}

func TestCodeModeNamedOpsMutationElicitationRejection(t *testing.T) {
	decline := func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		return &mcp.ElicitResult{Action: "accept", Content: map[string]any{
			"approved": false,
			"reason":   "policy forbids",
		}}, nil
	}
	withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{elicitationHandler: decline}, func(ctx context.Context, _ string, _ *testenv.Environment, _ *fakeCodeModeYoko, session *mcp.ClientSession) {
		searchText := callCodeModeToolText(t, ctx, session, "code_mode_search_tools", map[string]any{
			"prompts": []string{"update employee tag"},
		})
		assert.Equal(t, updateTagTS, searchText)

		executeText := callCodeModeToolText(t, ctx, session, "code_mode_run_js", map[string]any{
			"source": `async () => { return await tools.updateEmployeeTag({ id: 1, tag: "x" }); }`,
		})
		assert.Equal(t, map[string]any{
			"result": map[string]any{
				"data": nil,
				"declined": map[string]any{
					"reason": "policy forbids",
				},
				"errors": []any{
					map[string]any{"message": "Mutation declined by operator: policy forbids"},
				},
			},
		}, decodeJSON(t, executeText))
	})
}

func TestCodeModeNamedOpsTranspileError(t *testing.T) {
	withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{}, func(ctx context.Context, _ string, _ *testenv.Environment, _ *fakeCodeModeYoko, session *mcp.ClientSession) {
		searchText := callCodeModeToolText(t, ctx, session, "code_mode_search_tools", map[string]any{
			"prompts": []string{"employee by id"},
		})
		assert.Equal(t, employeeByIDTS, searchText)

		executeText := callCodeModeToolText(t, ctx, session, "code_mode_run_js", map[string]any{
			"source": `async () => { let x = ; }`,
		})
		assert.Equal(t, map[string]any{
			"result": nil,
			"error": map[string]any{
				"name":    "TranspileError",
				"message": "transpile failed: Unexpected \";\"",
				"stack":   "",
			},
		}, decodeJSON(t, executeText))
	})
}

func TestCodeModeNamedOpsListResourcesGating(t *testing.T) {
	t.Run("code mode disabled does not advertise persisted ops on main MCP server", func(t *testing.T) {
		yoko := newFakeCodeModeYoko()
		yokoServer := startFakeCodeModeYoko(t, yoko)
		cfg := baseCodeModeTestConfig(t, yokoServer.URL, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{})
		cfg.MCP.CodeMode.Enabled = false

		testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
			resources, err := xEnv.MCPClient.ListResources(ctxWithTimeout(t), mark3mcp.ListResourcesRequest{})
			require.NoError(t, err)
			assert.Equal(t, false, mark3ResourcesContain(resources.Resources, codeModePersistedOpsURI))
		})
	})

	t.Run("named ops disabled does not advertise persisted ops", func(t *testing.T) {
		withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{namedOpsEnabled: boolPtr(false)}, func(ctx context.Context, _ string, _ *testenv.Environment, _ *fakeCodeModeYoko, session *mcp.ClientSession) {
			resources, err := session.ListResources(ctx, &mcp.ListResourcesParams{})
			require.NoError(t, err)
			assert.Equal(t, []*mcp.Resource{}, resources.Resources)
		})
	})

	t.Run("stateless does not advertise persisted ops and warns once", func(t *testing.T) {
		withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{sessionStateless: boolPtr(true), observeLogs: true}, func(ctx context.Context, _ string, xEnv *testenv.Environment, _ *fakeCodeModeYoko, session *mcp.ClientSession) {
			resources, err := session.ListResources(ctx, &mcp.ListResourcesParams{})
			require.NoError(t, err)
			assert.Equal(t, []*mcp.Resource{}, resources.Resources)

			logs := xEnv.Observer().FilterMessage("code mode named operations are disabled because MCP session stateless mode is enabled").All()
			assert.Equal(t, 1, len(logs))
		})
	})

	t.Run("all gates on advertises persisted ops and read returns bundle", func(t *testing.T) {
		withCodeModeNamedOps(t, codeModeBackend{name: "memory"}, codeModeNamedOpsOptions{}, func(ctx context.Context, _ string, _ *testenv.Environment, _ *fakeCodeModeYoko, session *mcp.ClientSession) {
			searchText := callCodeModeToolText(t, ctx, session, "code_mode_search_tools", map[string]any{
				"prompts": []string{"employee by id"},
			})
			assert.Equal(t, employeeByIDTS, searchText)

			resources, err := session.ListResources(ctx, &mcp.ListResourcesParams{})
			require.NoError(t, err)
			assert.Equal(t, []*mcp.Resource{{
				URI:         codeModePersistedOpsURI,
				Name:        "persisted-ops.d.ts",
				Title:       "Persisted operations TypeScript definitions",
				Description: "Cumulative TypeScript definitions for the current Code Mode MCP session's named operations.",
				MIMEType:    "text/plain",
			}}, resources.Resources)

			resource := readPersistedOpsResource(t, ctx, session)
			assert.Equal(t, &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
				URI:      codeModePersistedOpsURI,
				MIMEType: "text/plain",
				Text:     employeeByIDBundle,
			}}}, resource)
		})
	})
}

func TestCodeModeNamedOpsRedisBackendTransparent(t *testing.T) {
	redisServer, err := miniredis.Run()
	if err != nil {
		t.Skipf("miniredis unavailable: %v", err)
	}
	t.Cleanup(redisServer.Close)

	backend := codeModeBackend{
		name:       "redis",
		providerID: "code_mode_redis",
		redisURL:   "redis://" + redisServer.Addr(),
	}
	withCodeModeNamedOps(t, backend, codeModeNamedOpsOptions{}, func(ctx context.Context, _ string, _ *testenv.Environment, _ *fakeCodeModeYoko, session *mcp.ClientSession) {
		searchText := callCodeModeToolText(t, ctx, session, "code_mode_search_tools", map[string]any{
			"prompts": []string{"first employee", "employee by id"},
		})
		assert.Equal(t, twoOpsFragment, searchText)

		resource := readPersistedOpsResource(t, ctx, session)
		assert.Equal(t, twoOpsBundle, resource.Contents[0].Text)

		executeText := callCodeModeToolText(t, ctx, session, "code_mode_run_js", map[string]any{
			"source": `async () => { return await tools.employeeByID({ id: 1 }); }`,
		})
		assert.Equal(t, map[string]any{
			"result": map[string]any{
				"data": map[string]any{
					"employee": map[string]any{
						"id": float64(1),
						"details": map[string]any{
							"forename": "Jens",
							"surname":  "Neuse",
						},
					},
				},
			},
		}, decodeJSON(t, executeText))
	})
}

type codeModeNamedOpsOptions struct {
	namedOpsEnabled    *bool
	sessionStateless   *bool
	observeLogs        bool
	poller             *codeModeConfigPoller
	elicitationHandler func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error)
}

func withCodeModeNamedOps(t *testing.T, backend codeModeBackend, opts codeModeNamedOpsOptions, f func(context.Context, string, *testenv.Environment, *fakeCodeModeYoko, *mcp.ClientSession)) {
	t.Helper()

	yoko := newFakeCodeModeYoko()
	yokoServer := startFakeCodeModeYoko(t, yoko)
	cfg := baseCodeModeTestConfig(t, yokoServer.URL, backend, opts)

	testenv.Run(t, cfg, func(t *testing.T, xEnv *testenv.Environment) {
		ctx := ctxWithTimeout(t)
		endpoint := "http://" + cfg.MCP.CodeMode.Server.ListenAddr + "/mcp"
		session := newCodeModeMCPClient(t, ctx, endpoint, opts.elicitationHandler)
		f(ctx, endpoint, xEnv, yoko, session)
	})
}

func baseCodeModeTestConfig(t *testing.T, yokoURL string, backend codeModeBackend, opts codeModeNamedOpsOptions) *testenv.Config {
	t.Helper()

	ports := freeport.GetN(t, 2)
	namedOpsEnabled := true
	if opts.namedOpsEnabled != nil {
		namedOpsEnabled = *opts.namedOpsEnabled
	}
	sessionStateless := false
	if opts.sessionStateless != nil {
		sessionStateless = *opts.sessionStateless
	}

	mcpCfg := config.MCPConfiguration{
		Enabled: true,
		Server: config.MCPServer{
			ListenAddr: fmt.Sprintf("127.0.0.1:%d", ports[0]),
		},
		Session: config.MCPSessionConfig{Stateless: sessionStateless},
		CodeMode: config.MCPCodeModeConfiguration{
			Enabled:                 true,
			RequireMutationApproval: true,
			ExecuteTimeout:          30 * time.Second,
			MaxResultBytes:          32 << 10,
			Server: config.MCPCodeModeServerConfig{
				ListenAddr: fmt.Sprintf("127.0.0.1:%d", ports[1]),
			},
			QueryGeneration: config.MCPCodeModeQueryGenConfig{
				Enabled:  true,
				Endpoint: yokoURL,
				Timeout:  5 * time.Second,
			},
			NamedOps: config.MCPCodeModeNamedOpsConfig{
				Enabled:        namedOpsEnabled,
				SessionTTL:     30 * time.Minute,
				MaxSessions:    100,
				MaxBundleBytes: 256 << 10,
				Storage: config.MCPCodeModeNamedOpsStorageConfig{
					ProviderID: backend.providerID,
					KeyPrefix:  "router_tests_code_mode",
				},
			},
		},
	}

	cfg := &testenv.Config{
		MCP:               mcpCfg,
		MCPOperationsPath: "protocol/testdata/mcp_operations_collision",
		CodeModeRedisURL:  backend.redisURL,
	}
	if opts.observeLogs {
		cfg.LogObservation = testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.WarnLevel}
	}
	if opts.poller != nil {
		cfg.RouterConfig = &testenv.RouterConfig{
			ConfigPollerFactory: func(routerConfig *nodev1.RouterConfig) configpoller.ConfigPoller {
				opts.poller.initConfig = routerConfig
				return opts.poller
			},
		}
	}
	return cfg
}

func newCodeModeMCPClient(t *testing.T, ctx context.Context, endpoint string, elicitation func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error)) *mcp.ClientSession {
	t.Helper()

	client := mcp.NewClient(&mcp.Implementation{Name: "router-tests", Version: "v0.0.0"}, &mcp.ClientOptions{
		ElicitationHandler: elicitation,
	})
	transport := &mcp.StreamableClientTransport{
		Endpoint:             endpoint,
		DisableStandaloneSSE: true,
		MaxRetries:           -1,
	}
	session, err := client.Connect(ctx, transport, nil)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, session.Close())
	})
	return session
}

func callCodeModeToolText(t *testing.T, ctx context.Context, session *mcp.ClientSession, name string, args map[string]any) string {
	t.Helper()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	require.NoError(t, err)
	require.False(t, result.IsError)
	require.Len(t, result.Content, 1)
	text, ok := result.Content[0].(*mcp.TextContent)
	require.True(t, ok)
	return text.Text
}

func readPersistedOpsResource(t *testing.T, ctx context.Context, session *mcp.ClientSession) *mcp.ReadResourceResult {
	t.Helper()
	result, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: codeModePersistedOpsURI})
	require.NoError(t, err)
	return result
}

func decodeJSON(t *testing.T, text string) map[string]any {
	t.Helper()
	var decoded map[string]any
	require.NoError(t, json.Unmarshal([]byte(text), &decoded))
	return decoded
}

func ctxWithTimeout(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func boolPtr(v bool) *bool {
	return &v
}

func mark3ResourcesContain(resources []mark3mcp.Resource, uri string) bool {
	for _, resource := range resources {
		if resource.URI == uri {
			return true
		}
	}
	return false
}

type fakeCodeModeYoko struct {
	mu               sync.Mutex
	indexCounter     int
	indexRequestLog  []*yokov1.IndexRequest
	searchRequestLog []*yokov1.SearchRequest
	opsByPrompt      map[string]*yokov1.GeneratedOperation
}

func newFakeCodeModeYoko() *fakeCodeModeYoko {
	return &fakeCodeModeYoko{
		opsByPrompt: map[string]*yokov1.GeneratedOperation{
			"first employee": {
				Name:        firstEmployeeOpName,
				Body:        firstEmployeeQuery,
				Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
				Description: "Fetch the first employee.",
			},
			"employee by id": {
				Name:        employeeByIDOpName,
				Body:        employeeByIDQuery,
				Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
				Description: "Fetch employee by id.",
			},
			"update employee tag": {
				Name:        updateTagOpName,
				Body:        updateTagMutation,
				Kind:        yokov1.OperationKind_OPERATION_KIND_MUTATION,
				Description: "Update employee tag.",
			},
		},
	}
}

func startFakeCodeModeYoko(t *testing.T, svc *fakeCodeModeYoko) *httptest.Server {
	t.Helper()
	path, handler := yokoconnect.NewYokoServiceHandler(svc)
	mux := http.NewServeMux()
	mux.Handle(path, handler)
	ports := freeport.GetN(t, 1)
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", ports[0]))
	require.NoError(t, err)
	server := httptest.NewUnstartedServer(mux)
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	return server
}

func (f *fakeCodeModeYoko) Index(_ context.Context, req *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.indexCounter++
	f.indexRequestLog = append(f.indexRequestLog, &yokov1.IndexRequest{SchemaSdl: req.Msg.GetSchemaSdl()})
	return connect.NewResponse(&yokov1.IndexResponse{SchemaId: fmt.Sprintf("schema-%d", f.indexCounter)}), nil
}

func (f *fakeCodeModeYoko) Search(_ context.Context, req *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.searchRequestLog = append(f.searchRequestLog, &yokov1.SearchRequest{
		Prompts:   append([]string(nil), req.Msg.GetPrompts()...),
		SchemaId:  req.Msg.GetSchemaId(),
		SessionId: req.Msg.GetSessionId(),
	})
	ops := make([]*yokov1.GeneratedOperation, 0, len(req.Msg.GetPrompts()))
	for _, prompt := range req.Msg.GetPrompts() {
		if op := f.opsByPrompt[prompt]; op != nil {
			ops = append(ops, op)
		}
	}
	return connect.NewResponse(&yokov1.SearchResponse{Operations: ops}), nil
}

func (f *fakeCodeModeYoko) indexRequests() []*yokov1.IndexRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*yokov1.IndexRequest, 0, len(f.indexRequestLog))
	for _, req := range f.indexRequestLog {
		out = append(out, &yokov1.IndexRequest{SchemaSdl: req.GetSchemaSdl()})
	}
	return out
}

func (f *fakeCodeModeYoko) searchRequests() []*yokov1.SearchRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*yokov1.SearchRequest, 0, len(f.searchRequestLog))
	for _, req := range f.searchRequestLog {
		out = append(out, &yokov1.SearchRequest{
			Prompts:   append([]string(nil), req.GetPrompts()...),
			SchemaId:  req.GetSchemaId(),
			SessionId: req.GetSessionId(),
		})
	}
	return out
}

type codeModeConfigPoller struct {
	initConfig   *nodev1.RouterConfig
	updateConfig func(newConfig *nodev1.RouterConfig, oldVersion string) error
	ready        chan struct{}
	once         sync.Once
}

func (c *codeModeConfigPoller) Subscribe(_ context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersion string) error) {
	c.updateConfig = handler
	c.once.Do(func() { close(c.ready) })
}

func (c *codeModeConfigPoller) GetRouterConfig(_ context.Context) (*routerconfig.Response, error) {
	return &routerconfig.Response{Config: c.initConfig}, nil
}

func (c *codeModeConfigPoller) Stop(_ context.Context) error {
	return nil
}
