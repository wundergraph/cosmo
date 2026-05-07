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

const noQueriesFromYokoMessage = "// yoko returned no operations for these prompts. Restate with concrete entity/field names."

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
	searcher.responses <- &yokov1.Resolution{
		Queries: []*yokov1.ResolvedQuery{
			{
				OperationName:   "getOrders",
				Document:        "query GetOrders($limit: Int) { orders(limit: $limit) { id } }",
				OperationType:   "query",
				Description:     "Fetch orders.",
				VariablesSchema: `{"type":"object","properties":{"limit":{"type":["integer","null"]}}}`,
			},
			{
				OperationName: "watchOrders",
				Document:      "subscription WatchOrders { orders { id } }",
				OperationType: "subscription",
				Description:   "Watch orders.",
			},
		},
	}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, true, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	getOrdersBody := "query GetOrders($limit: Int) { orders(limit: $limit) { id } }"
	expectedJSON := mustJSON(t, legacyCatalogueResponse{
		Operations: []legacyCatalogueOperation{
			{
				Name:            storage.ShortSHA(getOrdersBody),
				Body:            getOrdersBody,
				Kind:            "Query",
				Description:     "Fetch orders.",
				VariablesSchema: `{"type":"object","properties":{"limit":{"type":["integer","null"]}}}`,
			},
		},
	})
	assert.Equal(t, textToolResult(expectedJSON), got)
	assert.Equal(t, []searchCall{{prompts: []string{"orders"}}}, searcher.callsSnapshot())
	assert.Equal(t, []storage.SessionOp(nil), store.opsSnapshot("session-1"))
}

func TestHandleSearchStatefulAppendsAndReturnsNewOpsFragment(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{
		Queries: []*yokov1.ResolvedQuery{
			{
				OperationName: "getOrders",
				Document:      "query GetOrders($limit: Int) { orders(limit: $limit) { id total } }",
				OperationType: "query",
				Description:   "Fetch orders.",
			},
			{
				OperationName: "cancelOrder",
				Document:      "mutation CancelOrder($id: ID!) { cancelOrder(id: $id) { id } }",
				OperationType: "mutation",
				Description:   "Cancel an order.",
			},
			{
				OperationName: "watchOrders",
				Document:      "subscription WatchOrders { orders { id } }",
				OperationType: "subscription",
				Description:   "Watch orders.",
			},
		},
	}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders", "cancel order"},
	}))

	require.NoError(t, err)
	getOrdersBody := "query GetOrders($limit: Int) { orders(limit: $limit) { id total } }"
	cancelOrderBody := "mutation CancelOrder($id: ID!) { cancelOrder(id: $id) { id } }"
	wantOps := []storage.SessionOp{
		{
			Name:         storage.ShortSHA(getOrdersBody),
			Body:         getOrdersBody,
			Kind:         storage.OperationKindQuery,
			DocumentName: "getOrders",
			Description:  "Fetch orders.",
		},
		{
			Name:         storage.ShortSHA(cancelOrderBody),
			Body:         cancelOrderBody,
			Kind:         storage.OperationKindMutation,
			DocumentName: "cancelOrder",
			Description:  "Cancel an order.",
		},
	}
	wantFragment, err := tsgen.NewOpsFragment(wantOps, searchHandlerTestSchema(t))
	require.NoError(t, err)
	assert.Equal(t, textToolResult(wantFragment), got)
	assert.Equal(t, wantOps, store.opsSnapshot("session-1"))
	assert.Equal(t, []searchCall{{prompts: []string{"orders", "cancel order"}}}, searcher.callsSnapshot())
}

func TestHandleSearchStatefulHashesNameButPreservesDocumentName(t *testing.T) {
	// Regression: yoko returns operation_name in any casing it likes,
	// and the same document name can mask different bodies. Storage Name
	// must be the content-derived ShortSHA so collisions on the document
	// name don't conflate distinct operations, but DocumentName must be
	// the original name so the host bridge can match the operation
	// inside Body when invoking.
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{
		Queries: []*yokov1.ResolvedQuery{{
			OperationName: "GetCustomerContractDetails",
			Document:      "query GetCustomerContractDetails { orders { id } }",
			OperationType: "query",
			Description:   "Fetch contract details.",
		}},
	}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, false, searcher, store)

	_, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"contract"},
	}))

	require.NoError(t, err)
	body := "query GetCustomerContractDetails { orders { id } }"
	wantOps := []storage.SessionOp{{
		Name:         storage.ShortSHA(body),
		Body:         body,
		Kind:         storage.OperationKindQuery,
		DocumentName: "GetCustomerContractDetails",
		Description:  "Fetch contract details.",
	}}
	assert.Equal(t, wantOps, store.opsSnapshot("session-1"))
}

func TestHandleSearchStatefulForwardsUnsatisfiedAndTruncated(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{
		Queries: []*yokov1.ResolvedQuery{{
			OperationName: "getOrders",
			Document:      "query GetOrders { orders { id } }",
			OperationType: "query",
			Description:   "Fetch orders.",
		}},
		Unsatisfied: []*yokov1.Unsatisfied{
			{Reason: "no field on the schema carries that filter dimension"},
			{Reason: "customer filter not supported"},
		},
		Truncated: true,
	}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders", "filtered orders"},
	}))

	require.NoError(t, err)
	getOrdersBody := "query GetOrders { orders { id } }"
	wantOps := []storage.SessionOp{{
		Name:        storage.ShortSHA(getOrdersBody),
		Body:        getOrdersBody,
		Kind:        storage.OperationKindQuery,
		Description: "Fetch orders.",
	}}
	wantFragment, err := tsgen.NewOpsFragment(wantOps, searchHandlerTestSchema(t))
	require.NoError(t, err)
	wantText := "// unsatisfied: yoko could not satisfy the following requirement(s):\n" +
		"//   - no field on the schema carries that filter dimension\n" +
		"//   - customer filter not supported\n" +
		"// truncated: yoko ran out of turns before committing every requirement; consider tightening the prompt.\n" +
		"\n" + wantFragment
	assert.Equal(t, textToolResult(wantText), got)
}

func TestHandleSearchStatefulNoOpsWithUnsatisfiedReturnsNotes(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{
		Unsatisfied: []*yokov1.Unsatisfied{{Reason: "not possible"}},
	}
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	wantText := "// unsatisfied: yoko could not satisfy the following requirement(s):\n" +
		"//   - not possible\n" +
		noQueriesFromYokoMessage
	assert.Equal(t, textToolResult(wantText), got)
}

func TestHandleSearchStatelessForwardsUnsatisfiedAndTruncated(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{
		Queries: []*yokov1.ResolvedQuery{{
			OperationName: "getOrders",
			Document:      "query GetOrders { orders { id } }",
			OperationType: "query",
			Description:   "Fetch orders.",
		}},
		Unsatisfied: []*yokov1.Unsatisfied{{Reason: "no field for that filter"}},
		Truncated:   true,
	}
	srv := newSearchTestServer(t, true, searcher, newSearchTestStorage(t))

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	getOrdersBody := "query GetOrders { orders { id } }"
	expectedJSON := mustJSON(t, legacyCatalogueResponse{
		Operations: []legacyCatalogueOperation{{
			Name:        storage.ShortSHA(getOrdersBody),
			Body:        getOrdersBody,
			Kind:        "Query",
			Description: "Fetch orders.",
		}},
		Unsatisfied: []string{"no field for that filter"},
		Truncated:   true,
	})
	assert.Equal(t, textToolResult(expectedJSON), got)
}

func TestHandleSearchFallsBackToStatelessWhenSessionIDMissing(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{Queries: []*yokov1.ResolvedQuery{{
		OperationName: "getOrders",
		Document:      "query GetOrders { orders { id } }",
		OperationType: "query",
		Description:   "Fetch orders.",
	}}}
	store := newSearchTestStorage(t)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	getOrdersBody := "query GetOrders { orders { id } }"
	expectedJSON := mustJSON(t, legacyCatalogueResponse{
		Operations: []legacyCatalogueOperation{{
			Name:        storage.ShortSHA(getOrdersBody),
			Body:        getOrdersBody,
			Kind:        "Query",
			Description: "Fetch orders.",
		}},
	})
	assert.Equal(t, textToolResult(expectedJSON), got)
	assert.Equal(t, []storage.SessionOp(nil), store.opsSnapshot("session-1"))
}

func TestHandleSearchSameDocumentNameDifferentBodiesRegistersBoth(t *testing.T) {
	// Regression: yoko regenerates the same document name with a different
	// body. With SHA-based identity each body lands as its own entry —
	// previously the new body was silently dropped under the old name.
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{Queries: []*yokov1.ResolvedQuery{{
		OperationName: "getOrders",
		Document:      "query getOrders { orders { id total } }",
		OperationType: "query",
		Description:   "Fetch order totals.",
	}}}
	store := newSearchTestStorage(t)
	originalBody := "query getOrders { orders { id } }"
	_, err := store.Append(context.Background(), "session-1", []storage.SessionOp{{
		Name:         storage.ShortSHA(originalBody),
		Body:         originalBody,
		Kind:         storage.OperationKindQuery,
		DocumentName: "getOrders",
	}})
	require.NoError(t, err)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders again"},
	}))

	require.NoError(t, err)
	newBody := "query getOrders { orders { id total } }"
	newOp := storage.SessionOp{
		Name:         storage.ShortSHA(newBody),
		Body:         newBody,
		Kind:         storage.OperationKindQuery,
		DocumentName: "getOrders",
		Description:  "Fetch order totals.",
	}
	wantFragment, err := tsgen.NewOpsFragment([]storage.SessionOp{newOp}, searchHandlerTestSchema(t))
	require.NoError(t, err)
	assert.Equal(t, textToolResult(wantFragment), got)
	assert.Equal(t, []storage.SessionOp{
		{
			Name:         storage.ShortSHA(originalBody),
			Body:         originalBody,
			Kind:         storage.OperationKindQuery,
			DocumentName: "getOrders",
		},
		newOp,
	}, store.opsSnapshot("session-1"))
}

func TestHandleSearchExistingOpsAreReRenderedOnRepeatPrompt(t *testing.T) {
	// Regression for the fresh-context bug: when yoko returns ops that the
	// session already has, the handler must still emit their TS declarations
	// so a fresh model context can use them without introspecting `tools`.
	body := "query GetOrders { orders { id } }"
	sha := storage.ShortSHA(body)

	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{Queries: []*yokov1.ResolvedQuery{{
		OperationName: "GetOrders",
		Document:      body,
		OperationType: "query",
		Description:   "Fetch orders.",
	}}}
	store := newSearchTestStorage(t)
	_, err := store.Append(context.Background(), "session-1", []storage.SessionOp{{
		Name:         sha,
		Body:         body,
		Kind:         storage.OperationKindQuery,
		DocumentName: "GetOrders",
	}})
	require.NoError(t, err)
	srv := newSearchTestServer(t, false, searcher, store)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	wantOps := []storage.SessionOp{{
		Name:         sha,
		Body:         body,
		Kind:         storage.OperationKindQuery,
		DocumentName: "GetOrders",
	}}
	wantFragment, err := tsgen.NewOpsFragment(wantOps, searchHandlerTestSchema(t))
	require.NoError(t, err)
	assert.Equal(t, textToolResult(wantFragment), got)
	assert.Equal(t, wantOps, store.opsSnapshot("session-1"))
}

func TestHandleSearchEmptyYokoResponseReturnsNoQueriesMessage(t *testing.T) {
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.Resolution{}
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	assert.Equal(t, textToolResult(noQueriesFromYokoMessage), got)
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
		searcher.responses <- &yokov1.Resolution{Queries: []*yokov1.ResolvedQuery{{
			OperationName: "getOrders",
			Document:      "query GetOrders { orders { id } }",
			OperationType: "query",
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
		searcher.responses <- &yokov1.Resolution{}
		searcher.responses <- &yokov1.Resolution{}
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
		searcher.responses <- &yokov1.Resolution{}
		searcher.responses <- &yokov1.Resolution{}
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
	searcher.responses <- &yokov1.Resolution{Queries: []*yokov1.ResolvedQuery{{
		OperationName: "getOrders",
		Document:      "query GetOrders { orders { id } }",
		OperationType: "query",
	}}}
	srv := newSearchTestServer(t, false, searcher, newSearchTestStorage(t))
	srv.opsFragment = func([]storage.SessionOp, *ast.Document) (string, error) {
		return "", errors.New("render exploded")
	}

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	assert.Equal(t, toolError("code_mode_search_tools: failed to render ops: render exploded"), got)
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
	prompts []string
}

type fakeYoko struct {
	mu                  sync.Mutex
	calls               []searchCall
	responses           chan *yokov1.Resolution
	errs                chan error
	block               chan struct{}
	schema              string
	ensureIndexedCalled int
	ensureIndexedErr    error
}

func newFakeYoko() *fakeYoko {
	return &fakeYoko{
		responses: make(chan *yokov1.Resolution, 16),
		errs:      make(chan error, 16),
	}
}

func (f *fakeYoko) Search(ctx context.Context, prompts []string) (*yokov1.Resolution, error) {
	f.mu.Lock()
	f.calls = append(f.calls, searchCall{prompts: append([]string(nil), prompts...)})
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
		return &yokov1.Resolution{}, nil
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

// EnsureIndexed records that eager warm-up was requested and returns the
// stubbed ensureIndexedErr (nil by default). The fake does not model an
// index cache; the body is otherwise a no-op.
func (f *fakeYoko) EnsureIndexed(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ensureIndexedCalled++
	return f.ensureIndexedErr
}

func (f *fakeYoko) ensureIndexedCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.ensureIndexedCalled
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
		calls = append(calls, searchCall{prompts: append([]string(nil), call.prompts...)})
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

	byBody := make(map[string]storage.SessionOp, len(s.ops[sessionID])+len(ops))
	for _, existing := range s.ops[sessionID] {
		byBody[storage.CanonicalBody(existing.Body)] = existing
	}

	resolved := make([]storage.SessionOp, 0, len(ops))
	for _, op := range ops {
		canonical := storage.CanonicalBody(op.Body)
		if existing, ok := byBody[canonical]; ok {
			resolved = append(resolved, existing)
			continue
		}
		s.ops[sessionID] = append(s.ops[sessionID], op)
		byBody[canonical] = op
		resolved = append(resolved, op)
	}
	return resolved, nil
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

func searchHandlerTestSchema(t *testing.T) *ast.Document {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(searchHandlerTestSchemaSDL)
	require.False(t, report.HasErrors(), report.Error())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&doc))
	return &doc
}
