package yoko

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
)

type fakeYokoServiceClient struct {
	mu sync.Mutex

	indexRequests    []*yokov1.IndexSchemaRequest
	generateRequests []*yokov1.GenerateQueryRequest

	indexFunc    func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error)
	generateFunc func(context.Context, *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error)
}

func (f *fakeYokoServiceClient) IndexSchema(ctx context.Context, req *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
	f.mu.Lock()
	f.indexRequests = append(f.indexRequests, req.Msg)
	indexFunc := f.indexFunc
	f.mu.Unlock()

	if indexFunc != nil {
		return indexFunc(ctx, req)
	}
	return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: "schema-1"}), nil
}

func (f *fakeYokoServiceClient) GenerateQuery(ctx context.Context, req *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
	f.mu.Lock()
	f.generateRequests = append(f.generateRequests, req.Msg)
	generateFunc := f.generateFunc
	f.mu.Unlock()

	if generateFunc != nil {
		return generateFunc(ctx, req)
	}
	return connect.NewResponse(generateResponse(req.Msg.GetPrompt())), nil
}

func (f *fakeYokoServiceClient) indexRequestMessages() []*yokov1.IndexSchemaRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*yokov1.IndexSchemaRequest(nil), f.indexRequests...)
}

func (f *fakeYokoServiceClient) generateRequestMessages() []*yokov1.GenerateQueryRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*yokov1.GenerateQueryRequest(nil), f.generateRequests...)
}

func newTestClient(fake *fakeYokoServiceClient) *Client {
	client := New(nil, "http://yoko.example", nil, WithServiceClient(fake))
	client.SetSchema("type Query { product: Product }")
	return client
}

func generateResponse(prompt string) *yokov1.GenerateQueryResponse {
	return &yokov1.GenerateQueryResponse{
		Resolution: &yokov1.Resolution{
			Queries: []*yokov1.ResolvedQuery{
				{
					Description:     "Fetch product for prompt: " + prompt,
					Document:        "query GetProduct { product { id } }",
					OperationName:   "GetProduct",
					OperationType:   "query",
					VariablesSchema: `{"type":"object","properties":{}}`,
				},
			},
		},
	}
}

func connectError(code connect.Code, message string) error {
	return connect.NewError(code, errors.New(message))
}

func TestSearchFirstCallIndexesSchemaThenGeneratesPerPrompt(t *testing.T) {
	fake := &fakeYokoServiceClient{
		indexFunc: func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
			return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: "schema-from-yoko"}), nil
		},
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), []string{"find products", "find more products"})

	require.NoError(t, err)
	require.Equal(t, &yokov1.Resolution{
		Queries: []*yokov1.ResolvedQuery{
			generateResponse("find products").GetResolution().GetQueries()[0],
			generateResponse("find more products").GetResolution().GetQueries()[0],
		},
	}, actual)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest{
		{SchemaId: "schema-from-yoko", Prompt: "find products"},
		{SchemaId: "schema-from-yoko", Prompt: "find more products"},
	}, fake.generateRequestMessages())
}

func TestSearchSubsequentCallUsesCachedSchemaID(t *testing.T) {
	fake := &fakeYokoServiceClient{}
	client := newTestClient(fake)

	first, firstErr := client.Search(context.Background(), []string{"first"})
	second, secondErr := client.Search(context.Background(), []string{"second"})

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	require.Equal(t, generateResponse("first").GetResolution(), first)
	require.Equal(t, generateResponse("second").GetResolution(), second)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest{
		{SchemaId: "schema-1", Prompt: "first"},
		{SchemaId: "schema-1", Prompt: "second"},
	}, fake.generateRequestMessages())
}

func TestSearchAggregatesResolutionAcrossPrompts(t *testing.T) {
	calls := 0
	fake := &fakeYokoServiceClient{
		generateFunc: func(_ context.Context, req *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
			calls++
			switch calls {
			case 1:
				return connect.NewResponse(&yokov1.GenerateQueryResponse{
					Resolution: &yokov1.Resolution{
						Queries: []*yokov1.ResolvedQuery{{Document: "q1"}},
					},
				}), nil
			case 2:
				return connect.NewResponse(&yokov1.GenerateQueryResponse{
					Resolution: &yokov1.Resolution{
						Unsatisfied: []*yokov1.Unsatisfied{{Reason: "no field for that filter"}},
						Truncated:   true,
					},
				}), nil
			}
			return connect.NewResponse(&yokov1.GenerateQueryResponse{}), nil
		},
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), []string{"a", "b"})

	require.NoError(t, err)
	require.Equal(t, &yokov1.Resolution{
		Queries:     []*yokov1.ResolvedQuery{{Document: "q1"}},
		Unsatisfied: []*yokov1.Unsatisfied{{Reason: "no field for that filter"}},
		Truncated:   true,
	}, actual)
}

func TestSearchReindexesAndRetriesOnceAfterNotFound(t *testing.T) {
	var generateCount int
	fake := &fakeYokoServiceClient{}
	indexIDs := []string{"schema-initial", "schema-reindexed"}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: id}), nil
	}
	fake.generateFunc = func(_ context.Context, req *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
		generateCount++
		if generateCount == 1 {
			return nil, connectError(connect.CodeNotFound, "schema evicted")
		}
		return connect.NewResponse(generateResponse(req.Msg.GetPrompt())), nil
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), []string{"find products"})

	require.NoError(t, err)
	require.Equal(t, generateResponse("find products").GetResolution(), actual)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest{
		{SchemaId: "schema-initial", Prompt: "find products"},
		{SchemaId: "schema-reindexed", Prompt: "find products"},
	}, fake.generateRequestMessages())
}

func TestSearchRetryFailureSurfacesErrorAndLeavesCacheEmpty(t *testing.T) {
	retryErr := connectError(connect.CodeUnavailable, "retry transport down")
	indexIDs := []string{"schema-initial", "schema-reindexed", "schema-after-failure"}
	fake := &fakeYokoServiceClient{}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: id}), nil
	}
	generateErrors := []error{
		connectError(connect.CodeNotFound, "schema evicted"),
		retryErr,
		nil,
	}
	fake.generateFunc = func(_ context.Context, req *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
		err := generateErrors[len(fake.generateRequestMessages())-1]
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(generateResponse(req.Msg.GetPrompt())), nil
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), []string{"find products"})

	require.Nil(t, actual)
	require.ErrorIs(t, err, retryErr)

	actualAfterFailure, errAfterFailure := client.Search(context.Background(), []string{"find products again"})

	require.NoError(t, errAfterFailure)
	require.Equal(t, generateResponse("find products again").GetResolution(), actualAfterFailure)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
		{Sdl: "type Query { product: Product }"},
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest{
		{SchemaId: "schema-initial", Prompt: "find products"},
		{SchemaId: "schema-reindexed", Prompt: "find products"},
		{SchemaId: "schema-after-failure", Prompt: "find products again"},
	}, fake.generateRequestMessages())
}

func TestSearchRetryNotFoundSurfacesErrorAndLeavesCacheEmpty(t *testing.T) {
	retryErr := connectError(connect.CodeNotFound, "schema evicted again")
	indexIDs := []string{"schema-initial", "schema-reindexed", "schema-after-failure"}
	fake := &fakeYokoServiceClient{}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: id}), nil
	}
	generateErrors := []error{
		connectError(connect.CodeNotFound, "schema evicted"),
		retryErr,
		nil,
	}
	fake.generateFunc = func(_ context.Context, req *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
		err := generateErrors[len(fake.generateRequestMessages())-1]
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(generateResponse(req.Msg.GetPrompt())), nil
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), []string{"find products"})

	require.Nil(t, actual)
	require.ErrorIs(t, err, retryErr)

	actualAfterFailure, errAfterFailure := client.Search(context.Background(), []string{"find products again"})

	require.NoError(t, errAfterFailure)
	require.Equal(t, generateResponse("find products again").GetResolution(), actualAfterFailure)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
		{Sdl: "type Query { product: Product }"},
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
}

func TestSetSchemaInvalidatesCachedIDAndNextSearchReindexes(t *testing.T) {
	indexIDs := []string{"schema-v1", "schema-v2"}
	fake := &fakeYokoServiceClient{}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: id}), nil
	}
	client := newTestClient(fake)

	_, firstErr := client.Search(context.Background(), []string{"first"})
	client.SetSchema("type Query { review: Review }")
	_, secondErr := client.Search(context.Background(), []string{"second"})

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	require.Equal(t, "type Query { review: Review }", client.Schema())
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
		{Sdl: "type Query { review: Review }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest{
		{SchemaId: "schema-v1", Prompt: "first"},
		{SchemaId: "schema-v2", Prompt: "second"},
	}, fake.generateRequestMessages())
}

func TestConcurrentFirstSearchIndexesOnce(t *testing.T) {
	indexStarted := make(chan struct{})
	releaseIndex := make(chan struct{})
	var indexStartedOnce sync.Once
	fake := &fakeYokoServiceClient{
		indexFunc: func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
			indexStartedOnce.Do(func() {
				close(indexStarted)
			})
			<-releaseIndex
			return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: "schema-shared"}), nil
		},
	}
	client := newTestClient(fake)

	var wg sync.WaitGroup
	wg.Add(2)
	results := make([]*yokov1.Resolution, 2)
	errs := make([]error, 2)
	go func() {
		defer wg.Done()
		results[0], errs[0] = client.Search(context.Background(), []string{"first"})
	}()
	<-indexStarted
	go func() {
		defer wg.Done()
		results[1], errs[1] = client.Search(context.Background(), []string{"second"})
	}()
	time.Sleep(25 * time.Millisecond)
	close(releaseIndex)
	wg.Wait()

	require.NoError(t, errs[0])
	require.NoError(t, errs[1])
	require.Equal(t, generateResponse("first").GetResolution(), results[0])
	require.Equal(t, generateResponse("second").GetResolution(), results[1])
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	assert.Equal(t, 2, len(fake.generateRequestMessages()))
}

func TestConcurrentFirstSearchIndexFailureReturnsErrorToBothAndLeavesCacheEmpty(t *testing.T) {
	indexErr := connectError(connect.CodeUnavailable, "index unavailable")
	indexStarted := make(chan struct{})
	releaseIndex := make(chan struct{})
	var indexStartedOnce sync.Once
	fake := &fakeYokoServiceClient{
		indexFunc: func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
			indexStartedOnce.Do(func() {
				close(indexStarted)
			})
			<-releaseIndex
			return nil, indexErr
		},
	}
	client := newTestClient(fake)

	var wg sync.WaitGroup
	wg.Add(2)
	results := make([]*yokov1.Resolution, 2)
	errs := make([]error, 2)
	go func() {
		defer wg.Done()
		results[0], errs[0] = client.Search(context.Background(), []string{"first"})
	}()
	<-indexStarted
	go func() {
		defer wg.Done()
		results[1], errs[1] = client.Search(context.Background(), []string{"second"})
	}()
	time.Sleep(25 * time.Millisecond)
	close(releaseIndex)
	wg.Wait()

	require.Nil(t, results[0])
	require.Nil(t, results[1])
	require.ErrorIs(t, errs[0], indexErr)
	require.ErrorIs(t, errs[1], indexErr)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest(nil), fake.generateRequestMessages())

	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
		return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: "schema-after-error"}), nil
	}
	actual, err := client.Search(context.Background(), []string{"third"})

	require.NoError(t, err)
	require.Equal(t, generateResponse("third").GetResolution(), actual)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
}

func TestSearchBubblesUpArbitraryConnectErrors(t *testing.T) {
	generateErr := connectError(connect.CodeUnavailable, "generate unavailable")
	fake := &fakeYokoServiceClient{
		generateFunc: func(context.Context, *connect.Request[yokov1.GenerateQueryRequest]) (*connect.Response[yokov1.GenerateQueryResponse], error) {
			return nil, generateErr
		},
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), []string{"find products"})

	require.Nil(t, actual)
	require.ErrorIs(t, err, generateErr)
	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest{
		{SchemaId: "schema-1", Prompt: "find products"},
	}, fake.generateRequestMessages())
}

func TestEnsureIndexedSendsIndexSchemaAndCachesID(t *testing.T) {
	fake := &fakeYokoServiceClient{
		indexFunc: func(context.Context, *connect.Request[yokov1.IndexSchemaRequest]) (*connect.Response[yokov1.IndexSchemaResponse], error) {
			return connect.NewResponse(&yokov1.IndexSchemaResponse{SchemaId: "schema-warm"}), nil
		},
	}
	client := newTestClient(fake)

	require.NoError(t, client.EnsureIndexed(context.Background()))

	// Cached schema_id is reused by the next Search — no second IndexSchema RPC.
	_, err := client.Search(context.Background(), []string{"first"})
	require.NoError(t, err)

	require.Equal(t, []*yokov1.IndexSchemaRequest{
		{Sdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.GenerateQueryRequest{
		{SchemaId: "schema-warm", Prompt: "first"},
	}, fake.generateRequestMessages())
}

func TestEnsureIndexedNoOpWhenSchemaUnset(t *testing.T) {
	fake := &fakeYokoServiceClient{}
	client := New(nil, "http://yoko.example", nil, WithServiceClient(fake))

	require.NoError(t, client.EnsureIndexed(context.Background()))
	require.Empty(t, fake.indexRequestMessages())
}

func TestSchemaGetterReturnsCurrentSchema(t *testing.T) {
	client := New(nil, "http://yoko.example", nil, WithServiceClient(&fakeYokoServiceClient{}))

	require.Equal(t, "", client.Schema())
	client.SetSchema("type Query { store: Store }")
	require.Equal(t, "type Query { store: Store }", client.Schema())
}
