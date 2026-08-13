package querygen

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/yoko/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/yoko/v1/yokov1connect"
)

// fakeService is a programmable stand-in for the discovery service.
type fakeService struct {
	yokov1connect.UnimplementedYokoServiceHandler

	mu sync.Mutex

	ensureCalls atomic.Int32
	getCalls    atomic.Int32

	// ensureStatus is the status that EnsureIndex reports.
	ensureStatus yokov1.IndexStatus
	// getStatuses are returned by GetIndex in order. The last one repeats.
	getStatuses []yokov1.IndexStatus
	// buildError is reported alongside a FAILED status.
	buildError string
	// ensureErr makes EnsureIndex fail.
	ensureErr error
	// stale marks the index as built by an older indexer version.
	stale bool

	searchHits []*yokov1.SymbolHit
	generateFn func(prompt string) *yokov1.Resolution
	searchErr  error
}

func (f *fakeService) EnsureIndex(_ context.Context, req *connect.Request[yokov1.EnsureIndexRequest]) (*connect.Response[yokov1.EnsureIndexResponse], error) {
	f.ensureCalls.Add(1)
	if f.ensureErr != nil {
		return nil, f.ensureErr
	}
	return connect.NewResponse(&yokov1.EnsureIndexResponse{
		Index: &yokov1.Index{
			IndexId: Address(req.Msg.GetSdl()),
			Status:  f.ensureStatus,
			Stale:   f.stale,
		},
	}), nil
}

func (f *fakeService) GetIndex(_ context.Context, req *connect.Request[yokov1.GetIndexRequest]) (*connect.Response[yokov1.GetIndexResponse], error) {
	n := int(f.getCalls.Add(1))

	f.mu.Lock()
	defer f.mu.Unlock()

	status := yokov1.IndexStatus_INDEX_STATUS_INDEXING
	if len(f.getStatuses) > 0 {
		if n-1 < len(f.getStatuses) {
			status = f.getStatuses[n-1]
		} else {
			status = f.getStatuses[len(f.getStatuses)-1]
		}
	}

	return connect.NewResponse(&yokov1.GetIndexResponse{
		Index: &yokov1.Index{
			IndexId:     req.Msg.GetIndexId(),
			Status:      status,
			Error:       f.buildError,
			SymbolCount: 42,
		},
	}), nil
}

func (f *fakeService) SearchSchema(_ context.Context, _ *connect.Request[yokov1.SearchSchemaRequest]) (*connect.Response[yokov1.SearchSchemaResponse], error) {
	if f.searchErr != nil {
		return nil, f.searchErr
	}
	return connect.NewResponse(&yokov1.SearchSchemaResponse{Hits: f.searchHits}), nil
}

func (f *fakeService) GenerateQuery(_ context.Context, req *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
	return connect.NewResponse(&yokov1.GenerateQueryResponse{
		Resolution: f.generateFn(req.Msg.GetPrompt()),
	}), nil
}

// newTestService starts a fake discovery service and returns a Service wired to
// it.
func newTestService(t *testing.T, fake *fakeService) (*Service, *httptest.Server) {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle(yokov1connect.NewYokoServiceHandler(fake))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	svc := NewService(Config{
		URL:               srv.URL,
		RequestTimeout:    5 * time.Second,
		IndexPollInterval: 10 * time.Millisecond,
		IndexTimeout:      2 * time.Second,
	}, "http://router.local/graphql")

	return svc, srv
}

// waitForAddress waits until an address is adopted.
func waitForAddress(t *testing.T, svc *Service) string {
	t.Helper()
	var address string
	require.Eventually(t, func() bool {
		a, err := svc.indexer.CurrentAddress()
		if err != nil {
			return false
		}
		address = a
		return true
	}, 2*time.Second, 5*time.Millisecond, "the index never became ready")
	return address
}

func TestAddress_MatchesServiceRule(t *testing.T) {
	// "sha256:" plus 64 hex characters is 71 characters.
	got := Address("type Query { a: Int }")
	assert.Len(t, got, 71)
	assert.Equal(t, "sha256:", got[:7])

	// One changed byte makes a different address.
	assert.NotEqual(t, got, Address("type Query { b: Int }"))
}

func TestSync_NewSchemaBecomesReady(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_INDEXING,
		getStatuses: []yokov1.IndexStatus{
			yokov1.IndexStatus_INDEX_STATUS_INDEXING,
			yokov1.IndexStatus_INDEX_STATUS_READY,
		},
	}
	svc, _ := newTestService(t, fake)

	const sdl = "type Query { hello: String }"
	svc.Sync(context.Background(), sdl)

	// The tool must report not ready while the build runs.
	_, err := svc.indexer.CurrentAddress()
	require.ErrorIs(t, err, ErrIndexNotReady)

	assert.Equal(t, Address(sdl), waitForAddress(t, svc))
	assert.GreaterOrEqual(t, fake.getCalls.Load(), int32(2))
}

func TestSync_AlreadyBuiltAdoptsWithoutPolling(t *testing.T) {
	fake := &fakeService{ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY}
	svc, _ := newTestService(t, fake)

	svc.Sync(context.Background(), "type Query { hello: String }")
	waitForAddress(t, svc)

	assert.Equal(t, int32(1), fake.ensureCalls.Load())
	assert.Equal(t, int32(0), fake.getCalls.Load(), "an already built index must not be polled")
}

func TestSync_UnchangedSchemaMakesNoNetworkCall(t *testing.T) {
	fake := &fakeService{ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY}
	svc, _ := newTestService(t, fake)

	const sdl = "type Query { hello: String }"
	svc.Sync(context.Background(), sdl)
	waitForAddress(t, svc)
	require.Equal(t, int32(1), fake.ensureCalls.Load())

	// A reload with the same schema must not call the service at all.
	for range 5 {
		svc.Sync(context.Background(), sdl)
	}

	assert.Equal(t, int32(1), fake.ensureCalls.Load())
	assert.Equal(t, int32(0), fake.getCalls.Load())
}

func TestSync_FailedBuildIsReported(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_INDEXING,
		getStatuses:  []yokov1.IndexStatus{yokov1.IndexStatus_INDEX_STATUS_FAILED},
		buildError:   "the SDL does not parse",
	}
	svc, _ := newTestService(t, fake)

	svc.Sync(context.Background(), "not a schema")

	require.Eventually(t, func() bool {
		_, err := svc.indexer.CurrentAddress()
		return err != nil && errors.Is(err, ErrIndexNotReady) &&
			strings.Contains(err.Error(), "the SDL does not parse")
	}, 2*time.Second, 5*time.Millisecond)
}

func TestSync_GivesUpAtIndexTimeout(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_INDEXING,
		getStatuses:  []yokov1.IndexStatus{yokov1.IndexStatus_INDEX_STATUS_INDEXING},
	}

	mux := http.NewServeMux()
	mux.Handle(yokov1connect.NewYokoServiceHandler(fake))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	svc := NewService(Config{
		URL:               srv.URL,
		IndexPollInterval: 5 * time.Millisecond,
		IndexTimeout:      50 * time.Millisecond,
	}, "http://router.local/graphql")

	svc.Sync(context.Background(), "type Query { hello: String }")

	require.Eventually(t, func() bool {
		_, err := svc.indexer.CurrentAddress()
		return err != nil && strings.Contains(err.Error(), "did not become ready")
	}, 2*time.Second, 5*time.Millisecond)
}

func TestSync_SchemaChangeKeepsServingTheOldIndex(t *testing.T) {
	fake := &fakeService{ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY}
	svc, _ := newTestService(t, fake)

	const oldSDL = "type Query { hello: String }"
	svc.Sync(context.Background(), oldSDL)
	oldAddress := waitForAddress(t, svc)

	// The next build never finishes.
	fake.mu.Lock()
	fake.ensureStatus = yokov1.IndexStatus_INDEX_STATUS_INDEXING
	fake.getStatuses = []yokov1.IndexStatus{yokov1.IndexStatus_INDEX_STATUS_INDEXING}
	fake.mu.Unlock()

	svc.Sync(context.Background(), "type Query { hello: String world: Int }")

	// The old address must keep serving while the new one builds.
	time.Sleep(50 * time.Millisecond)
	current, err := svc.indexer.CurrentAddress()
	require.NoError(t, err)
	assert.Equal(t, oldAddress, current, "a reload must not break a working tool")
}

func TestSync_StaleIndexStillServes(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY,
		stale:        true,
	}
	svc, _ := newTestService(t, fake)

	svc.Sync(context.Background(), "type Query { hello: String }")
	assert.NotEmpty(t, waitForAddress(t, svc))
}

func TestSearchSchema_DecodesTheRecord(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY,
		searchHits: []*yokov1.SymbolHit{
			{
				Coordinate: "field:Query.hello",
				Score:      0.9,
				// The service sends the record as a JSON encoded string.
				Payload: `{"Kind":"field","Name":"hello"}`,
			},
		},
	}
	svc, _ := newTestService(t, fake)
	svc.Sync(context.Background(), "type Query { hello: String }")
	waitForAddress(t, svc)

	res, err := svc.SearchSchema(context.Background(), SearchInput{Query: "greeting"})
	require.NoError(t, err)
	require.Len(t, res.Hits, 1)

	assert.Equal(t, "field:Query.hello", res.Hits[0].Coordinate)
	// The record must be raw JSON, not a JSON string.
	assert.JSONEq(t, `{"Kind":"field","Name":"hello"}`, string(res.Hits[0].Record))
}

func TestSearchSchema_NotReadyReturnsRetryMessage(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_INDEXING,
		getStatuses:  []yokov1.IndexStatus{yokov1.IndexStatus_INDEX_STATUS_INDEXING},
	}
	svc, _ := newTestService(t, fake)
	svc.Sync(context.Background(), "type Query { hello: String }")

	_, err := svc.SearchSchema(context.Background(), SearchInput{Query: "anything"})
	require.ErrorIs(t, err, ErrIndexNotReady)
	assert.Equal(t, "The schema index is still building. Retry in a few seconds.", UserMessage(err))
}

func TestGenerateQuery_DecodesVariablesSchemaAndAddsGuidance(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY,
		generateFn: func(string) *yokov1.Resolution {
			return &yokov1.Resolution{
				Queries: []*yokov1.ResolvedQuery{{
					Description:     "Reads the greeting.",
					Document:        "query Q { hello }",
					OperationName:   "Q",
					OperationType:   "query",
					VariablesSchema: `{"type":"object","properties":{}}`,
				}},
			}
		},
	}
	svc, _ := newTestService(t, fake)
	svc.Sync(context.Background(), "type Query { hello: String }")
	waitForAddress(t, svc)

	res, err := svc.GenerateQuery(context.Background(), "get the greeting")
	require.NoError(t, err)
	require.Len(t, res.Queries, 1)

	assert.Equal(t, "query Q { hello }", res.Queries[0].Document)
	assert.JSONEq(t, `{"type":"object","properties":{}}`, string(res.Queries[0].VariablesSchema))

	require.NotNil(t, res.Guidance)
	assert.Equal(t, "http://router.local/graphql", res.Guidance.Endpoint)
	assert.NotEmpty(t, res.Guidance.NextSteps)
}

func TestGenerateQuery_UnsatisfiedIsNotAnError(t *testing.T) {
	fake := &fakeService{
		ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY,
		generateFn: func(string) *yokov1.Resolution {
			return &yokov1.Resolution{
				Unsatisfied: []*yokov1.Unsatisfied{{Reason: "the schema has no billing data"}},
			}
		},
	}
	svc, _ := newTestService(t, fake)
	svc.Sync(context.Background(), "type Query { hello: String }")
	waitForAddress(t, svc)

	res, err := svc.GenerateQuery(context.Background(), "list invoices")
	require.NoError(t, err, "an unsatisfied result is a normal answer")
	assert.Empty(t, res.Queries)
	assert.Equal(t, []string{"the schema has no billing data"}, res.Unsatisfied)
	assert.Nil(t, res.Guidance, "guidance is pointless without an operation")
}

func TestUserMessage_MapsEveryServiceCode(t *testing.T) {
	cases := []struct {
		code connect.Code
		want string
	}{
		{connect.CodeNotFound, "The schema index expired. It is being rebuilt. Retry in a few seconds."},
		{connect.CodeFailedPrecondition, "The schema index is not ready. Retry in a few seconds."},
		{connect.CodeUnauthenticated, "Schema discovery is not configured correctly. Contact the router operator."},
	}

	for _, tc := range cases {
		t.Run(tc.code.String(), func(t *testing.T) {
			err := connect.NewError(tc.code, errors.New("boom"))
			assert.Equal(t, tc.want, UserMessage(err))
		})
	}
}

func TestUserMessage_NeverLeaksTheToken(t *testing.T) {
	err := connect.NewError(connect.CodeUnauthenticated, errors.New("bad token s3cr3t-value"))
	assert.NotContains(t, UserMessage(err), "s3cr3t-value")
}

func TestBearerToken_SetsTheHeaderOnlyWhenConfigured(t *testing.T) {
	var got string
	var mu sync.Mutex

	fake := &fakeService{ensureStatus: yokov1.IndexStatus_INDEX_STATUS_READY}
	mux := http.NewServeMux()
	mux.Handle(yokov1connect.NewYokoServiceHandler(fake))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = r.Header.Get("Authorization")
		mu.Unlock()
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)

	withToken := NewService(Config{URL: srv.URL, Token: "abc123"}, "")
	withToken.Sync(context.Background(), "type Query { a: Int }")
	waitForAddress(t, withToken)

	mu.Lock()
	assert.Equal(t, "Bearer abc123", got)
	mu.Unlock()

	noToken := NewService(Config{URL: srv.URL}, "")
	noToken.Sync(context.Background(), "type Query { b: Int }")
	waitForAddress(t, noToken)

	mu.Lock()
	assert.Empty(t, got, "an empty token must send no Authorization header")
	mu.Unlock()
}

func TestConfigValidate_RequiresURL(t *testing.T) {
	require.Error(t, (&Config{}).Validate())
	require.NoError(t, (&Config{URL: "http://localhost:3400"}).Validate())
}
