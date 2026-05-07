package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/cosmo/router/internal/codemode/tsgen"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
)

const searchHandlerTestSchemaSDL = `
schema {
	query: Query
	mutation: Mutation
}

type Query {
	orders(limit: Int): [Order!]!
	customer(id: ID!): Customer
}

type Mutation {
	cancelOrder(id: ID!): Order!
}

type Order {
	id: ID!
	total: Float!
}

type Customer {
	id: ID!
	name: String!
}
`

const emptySearchMessage = "// 0 new ops; previous code_mode_search_tools calls already cover these prompts."

func TestHandleSearchValidatesPrompts(t *testing.T) {
	tests := []struct {
		name      string
		arguments map[string]any
		want      string
	}{
		{
			name:      "missing prompts",
			arguments: map[string]any{},
			want:      "code_mode_search_tools: prompts must be a non-empty array of strings",
		},
		{
			name:      "empty prompts",
			arguments: map[string]any{"prompts": []string{}},
			want:      "code_mode_search_tools: prompts must be a non-empty array of strings",
		},
		{
			name: "too many prompts",
			arguments: map[string]any{"prompts": func() []string {
				prompts := make([]string, 21)
				for i := range prompts {
					prompts[i] = fmt.Sprintf("prompt %d", i)
				}
				return prompts
			}()},
			want: "too many prompts: 21 (max 20) — pass all prompts in one call",
		},
		{
			name:      "empty prompt",
			arguments: map[string]any{"prompts": []string{"orders", "  \t\n"}},
			want:      "code_mode_search_tools: prompt at index 1 is empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newSearchTestServer(t, false, newFakeYoko(), newSearchTestStorage(t))

			got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", tt.arguments))

			require.NoError(t, err)
			assert.Equal(t, toolError(tt.want), got)
		})
	}
}

func TestHandleSearchStatelessReturnsLegacyJSONCatalogue(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.SearchResponse{Operations: []*yokov1.GeneratedOperation{
		{
			Name:        "getOrders",
			Body:        "query GetOrders($limit: Int) { orders(limit: $limit) { id } }",
			Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
			Description: "Fetch orders.",
		},
		{
			Name:        "watchOrders",
			Body:        "subscription WatchOrders { orders { id } }",
			Kind:        yokoOperationKindSubscription,
			Description: "Watch orders.",
		},
	}}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, true, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	expectedJSON := mustJSON(t, []legacyCatalogueEntry{
		{
			Name:        "getOrders",
			Body:        "query GetOrders($limit: Int) { orders(limit: $limit) { id } }",
			Kind:        "Query",
			Description: "Fetch orders.",
			Variables:   ptrString("($limit: Int)"),
		},
	})
	assert.Equal(t, textToolResult(expectedJSON), got)
	assert.Equal(t, []searchCall{{sessionID: "", prompts: []string{"orders"}}}, searcher.callsSnapshot())
	assert.Equal(t, []storage.SessionOp(nil), store.opsSnapshot("session-1"))
}

func TestHandleSearchStatefulAppendsAndReturnsNewOpsFragment(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.SearchResponse{Operations: []*yokov1.GeneratedOperation{
		{
			Name:        "getOrders",
			Body:        "query GetOrders($limit: Int) { orders(limit: $limit) { id total } }",
			Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
			Description: "Fetch orders.",
		},
		{
			Name:        "cancelOrder",
			Body:        "mutation CancelOrder($id: ID!) { cancelOrder(id: $id) { id } }",
			Kind:        yokov1.OperationKind_OPERATION_KIND_MUTATION,
			Description: "Cancel an order.",
		},
		{
			Name:        "watchOrders",
			Body:        "subscription WatchOrders { orders { id } }",
			Kind:        yokoOperationKindSubscription,
			Description: "Watch orders.",
		},
	}}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders", "cancel order"},
	}))

	require.NoError(t, err)
	wantOps := []storage.SessionOp{
		{
			Name:        "getOrders",
			Body:        "query GetOrders($limit: Int) { orders(limit: $limit) { id total } }",
			Kind:        storage.OperationKindQuery,
			Description: "Fetch orders.",
		},
		{
			Name:        "cancelOrder",
			Body:        "mutation CancelOrder($id: ID!) { cancelOrder(id: $id) { id } }",
			Kind:        storage.OperationKindMutation,
			Description: "Cancel an order.",
		},
	}
	wantFragment, err := tsgen.NewOpsFragment(wantOps, searchHandlerTestSchema(t))
	require.NoError(t, err)
	assert.Equal(t, textToolResult(wantFragment), got)
	assert.Equal(t, wantOps, store.opsSnapshot("session-1"))
	assert.Equal(t, []searchCall{{sessionID: "session-1", prompts: []string{"orders", "cancel order"}}}, searcher.callsSnapshot())
}

func TestHandleSearchFallsBackToStatelessWhenSessionIDMissing(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.SearchResponse{Operations: []*yokov1.GeneratedOperation{{
		Name:        "getOrders",
		Body:        "query GetOrders { orders { id } }",
		Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
		Description: "Fetch orders.",
	}}}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	expectedJSON := mustJSON(t, []legacyCatalogueEntry{{
		Name:        "getOrders",
		Body:        "query GetOrders { orders { id } }",
		Kind:        "Query",
		Description: "Fetch orders.",
		Variables:   nil,
	}})
	assert.Equal(t, textToolResult(expectedJSON), got)
	assert.Equal(t, []storage.SessionOp(nil), store.opsSnapshot("session-1"))
}

func TestHandleSearchNamingCollisionUsesFinalStoredName(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.SearchResponse{Operations: []*yokov1.GeneratedOperation{{
		Name:        "getOrders",
		Body:        "query GetOrdersAgain { orders { total } }",
		Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
		Description: "Fetch order totals.",
	}}}
	store := newSearchTestStorage(t)
	_, err := store.Append(context.Background(), "session-1", []storage.SessionOp{{
		Name: "getOrders",
		Body: "query GetOrders { orders { id } }",
		Kind: storage.OperationKindQuery,
	}})
	require.NoError(t, err)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders again"},
	}))

	require.NoError(t, err)
	wantOps := []storage.SessionOp{
		{Name: "getOrders", Body: "query GetOrders { orders { id } }", Kind: storage.OperationKindQuery},
		{Name: "getOrders_2", Body: "query GetOrdersAgain { orders { total } }", Kind: storage.OperationKindQuery, Description: "Fetch order totals."},
	}
	wantFragment, err := tsgen.NewOpsFragment(wantOps[1:], searchHandlerTestSchema(t))
	require.NoError(t, err)
	assert.Equal(t, textToolResult(wantFragment), got)
	assert.Equal(t, wantOps, store.opsSnapshot("session-1"))
}

func TestHandleSearchEmptyYokoResponseIsSuccess(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.SearchResponse{}
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	assert.Equal(t, textToolResult(emptySearchMessage), got)
}

func TestHandleSearchDoesNotRetryNotFoundFromSearcher(t *testing.T) {
	searcher := newFakeYoko()
	searcher.errs <- connect.NewError(connect.CodeNotFound, errors.New("missing index"))
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	assert.Equal(t, toolError("code_mode_search_tools: yoko search failed: not_found: missing index"), got)
	assert.Equal(t, 1, searcher.callCount())
}

func TestHandleSearchYokoErrorIsToolError(t *testing.T) {
	searcher := newFakeYoko()
	searcher.errs <- errors.New("dial tcp: connection refused")
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	assert.Equal(t, toolError("code_mode_search_tools: yoko search failed: dial tcp: connection refused"), got)
}

func TestHandleSearchSingleFlight(t *testing.T) {
	t.Run("identical calls share leader result", func(t *testing.T) {
		searcher := newFakeYoko()
		searcher.block = make(chan struct{})
		searcher.responses <- &yokov1.SearchResponse{Operations: []*yokov1.GeneratedOperation{{
			Name: "getOrders",
			Body: "query GetOrders { orders { id } }",
			Kind: yokov1.OperationKind_OPERATION_KIND_QUERY,
		}}}
		srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

		ctx := context.Background()
		var wg sync.WaitGroup
		results := make([]*mcp.CallToolResult, 2)
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := srv.handleSearch(ctx, searchToolRequest(t, "session-1", map[string]any{
				"prompts": []string{"orders", "customers"},
			}))
			require.NoError(t, err)
			results[0] = result
		}()
		require.Eventually(t, func() bool { return searcher.callCount() == 1 }, time.Second, time.Millisecond)
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := srv.handleSearch(ctx, searchToolRequest(t, "session-1", map[string]any{
				"prompts": []string{"orders", "customers"},
			}))
			require.NoError(t, err)
			results[1] = result
		}()
		time.Sleep(10 * time.Millisecond)
		close(searcher.block)
		wg.Wait()

		assert.Equal(t, 1, searcher.callCount())
		assert.Equal(t, results[0], results[1])
	})

	t.Run("different calls do not share result", func(t *testing.T) {
		searcher := newFakeYoko()
		searcher.responses <- &yokov1.SearchResponse{}
		searcher.responses <- &yokov1.SearchResponse{}
		srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

		var wg sync.WaitGroup
		for _, prompt := range []string{"orders", "customers"} {
			wg.Add(1)
			go func(prompt string) {
				defer wg.Done()
				_, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
					"prompts": []string{prompt},
				}))
				require.NoError(t, err)
			}(prompt)
		}
		wg.Wait()

		assert.Equal(t, 2, searcher.callCount())
	})

	t.Run("ambiguous spacing prompt sets do not share result", func(t *testing.T) {
		searcher := newFakeYoko()
		searcher.block = make(chan struct{})
		searcher.responses <- &yokov1.SearchResponse{}
		searcher.responses <- &yokov1.SearchResponse{}
		srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

		var wg sync.WaitGroup
		for _, prompts := range [][]string{
			{"a b", "c"},
			{"a", "b c"},
		} {
			prompts := prompts
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
					"prompts": prompts,
				}))
				require.NoError(t, err)
			}()
		}

		require.Eventually(t, func() bool { return searcher.callCount() == 2 }, time.Second, time.Millisecond)
		close(searcher.block)
		wg.Wait()

		assert.Equal(t, 2, searcher.callCount())
	})
}

func TestHandleSearchRenderErrorIsToolError(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.SearchResponse{Operations: []*yokov1.GeneratedOperation{{
		Name: "getOrders",
		Body: "query GetOrders { orders { id } }",
		Kind: yokov1.OperationKind_OPERATION_KIND_QUERY,
	}}}
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))
	srv.newOpsFragment = func([]storage.SessionOp, *ast.Document) (string, error) {
		return "", errors.New("render exploded")
	}

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	assert.Equal(t, toolError("code_mode_search_tools: failed to render new ops: render exploded"), got)
}

func TestHandleSearchCancelMaySurfaceLeaderCancellationToFollower(t *testing.T) {
	searcher := newFakeYoko()
	searcher.block = make(chan struct{})
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	defer cancelLeader()

	var wg sync.WaitGroup
	results := make([]*mcp.CallToolResult, 2)
	wg.Add(1)
	go func() {
		defer wg.Done()
		result, err := srv.handleSearch(leaderCtx, searchToolRequest(t, "session-1", map[string]any{
			"prompts": []string{"orders"},
		}))
		require.NoError(t, err)
		results[0] = result
	}()
	require.Eventually(t, func() bool { return searcher.callCount() == 1 }, time.Second, time.Millisecond)

	wg.Add(1)
	go func() {
		defer wg.Done()
		result, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
			"prompts": []string{"orders"},
		}))
		require.NoError(t, err)
		results[1] = result
	}()
	time.Sleep(10 * time.Millisecond)
	cancelLeader()
	close(searcher.block)
	wg.Wait()

	assert.Equal(t, 1, searcher.callCount())
	assert.Equal(t, toolError("code_mode_search_tools: yoko search failed: context canceled"), results[0])
	assert.Equal(t, toolError("code_mode_search_tools: yoko search failed: context canceled"), results[1])
}

type searchCall struct {
	sessionID string
	prompts   []string
}

type fakeYoko struct {
	mu              sync.Mutex
	calls           []searchCall
	responses       chan *yokov1.SearchResponse
	errs            chan error
	block           chan struct{}
	schema          string
	ensureIndexed    int
	ensureIndexedErr error
}

func newFakeYoko() *fakeYoko {
	return &fakeYoko{
		responses: make(chan *yokov1.SearchResponse, 16),
		errs:      make(chan error, 16),
	}
}

func (f *fakeYoko) Search(ctx context.Context, sessionID string, prompts []string) (*yokov1.SearchResponse, error) {
	f.mu.Lock()
	f.calls = append(f.calls, searchCall{sessionID: sessionID, prompts: append([]string(nil), prompts...)})
	f.mu.Unlock()

	if f.block != nil {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-f.block:
		}
	}

	select {
	case err := <-f.errs:
		return nil, err
	default:
	}
	select {
	case response := <-f.responses:
		return response, nil
	default:
		return &yokov1.SearchResponse{}, nil
	}
}

func (f *fakeYoko) SetSchema(schema string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.schema = schema
}

func (f *fakeYoko) Schema() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.schema
}

func (f *fakeYoko) EnsureIndexed(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ensureIndexed++
	return f.ensureIndexedErr
}

func (f *fakeYoko) ensureIndexedCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ensureIndexed
}

func (f *fakeYoko) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeYoko) callsSnapshot() []searchCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	calls := make([]searchCall, 0, len(f.calls))
	for _, call := range f.calls {
		calls = append(calls, searchCall{sessionID: call.sessionID, prompts: append([]string(nil), call.prompts...)})
	}
	return calls
}

type searchTestStorage struct {
	mu     sync.Mutex
	schema *ast.Document
	ops    map[string][]storage.SessionOp
}

func newSearchTestStorage(t *testing.T) *searchTestStorage {
	t.Helper()
	return &searchTestStorage{
		schema: searchHandlerTestSchema(t),
		ops:    make(map[string][]storage.SessionOp),
	}
}

func (s *searchTestStorage) Append(ctx context.Context, sessionID string, ops []storage.SessionOp) ([]storage.SessionOp, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	taken := make(map[string]struct{}, len(s.ops[sessionID])+len(ops))
	for _, op := range s.ops[sessionID] {
		taken[op.Name] = struct{}{}
	}

	appended := make([]storage.SessionOp, 0, len(ops))
	for _, op := range ops {
		op.Name = storage.SuffixedName(storage.NormalizeName(op.Name), taken)
		taken[op.Name] = struct{}{}
		s.ops[sessionID] = append(s.ops[sessionID], op)
		appended = append(appended, op)
	}
	return appended, nil
}

func (s *searchTestStorage) GetOp(_ context.Context, sessionID string, name string) (storage.SessionOp, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, op := range s.ops[sessionID] {
		if op.Name == name {
			return op, true, nil
		}
	}
	return storage.SessionOp{}, false, nil
}

func (s *searchTestStorage) ListNames(_ context.Context, sessionID string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.ops[sessionID]))
	for _, op := range s.ops[sessionID] {
		names = append(names, op.Name)
	}
	return names, nil
}

func (s *searchTestStorage) Bundle(context.Context, string) (string, error) {
	return "", nil
}

func (s *searchTestStorage) Reset(_ context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.ops, sessionID)
	return nil
}

func (s *searchTestStorage) SetSchema(schema *ast.Document) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.schema = schema
}

func (s *searchTestStorage) Schema() *ast.Document {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.schema
}

func (s *searchTestStorage) Start(context.Context) error {
	return nil
}

func (s *searchTestStorage) Stop() error {
	return nil
}

func (s *searchTestStorage) opsSnapshot(sessionID string) []storage.SessionOp {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]storage.SessionOp(nil), s.ops[sessionID]...)
}

type legacyCatalogueEntry struct {
	Name        string  `json:"name"`
	Body        string  `json:"body"`
	Kind        string  `json:"kind"`
	Description string  `json:"description"`
	Variables   *string `json:"variables"`
}

func newSearchTestServer(t *testing.T, stateless bool, searcher *fakeYoko, store *searchTestStorage) *Server {
	t.Helper()
	srv, err := New(Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: stateless,
		Storage:          store,
		YokoClient:       searcher,
		BundleRenderer:   storage.RendererFunc(func([]storage.SessionOp) (string, error) { return "", nil }),
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)
	return srv
}

func searchToolRequest(t *testing.T, sessionID string, arguments map[string]any) *mcp.CallToolRequest {
	t.Helper()
	body, err := json.Marshal(arguments)
	require.NoError(t, err)
	return &mcp.CallToolRequest{
		Params: &mcp.CallToolParamsRaw{
			Name:      "code_mode_search_tools",
			Arguments: body,
		},
		Extra: &mcp.RequestExtra{Header: http.Header{mcpSessionIDHeader: []string{sessionID}}},
	}
}

func textToolResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
	}
}

func ptrString(value string) *string {
	return &value
}

func searchHandlerTestSchema(t *testing.T) *ast.Document {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(searchHandlerTestSchemaSDL)
	require.False(t, report.HasErrors(), report.Error())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&doc))
	return &doc
}
