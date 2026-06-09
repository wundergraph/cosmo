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

	indexRequests  []*yokov1.IndexRequest
	searchRequests []*yokov1.SearchRequest

	indexFunc  func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error)
	searchFunc func(context.Context, *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error)
}

func (f *fakeYokoServiceClient) Index(ctx context.Context, req *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
	f.mu.Lock()
	f.indexRequests = append(f.indexRequests, req.Msg)
	indexFunc := f.indexFunc
	f.mu.Unlock()

	if indexFunc != nil {
		return indexFunc(ctx, req)
	}
	return connect.NewResponse(&yokov1.IndexResponse{SchemaId: "schema-1"}), nil
}

func (f *fakeYokoServiceClient) Search(ctx context.Context, req *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
	f.mu.Lock()
	f.searchRequests = append(f.searchRequests, req.Msg)
	searchFunc := f.searchFunc
	f.mu.Unlock()

	if searchFunc != nil {
		return searchFunc(ctx, req)
	}
	return connect.NewResponse(searchResponse("op")), nil
}

func (f *fakeYokoServiceClient) indexRequestMessages() []*yokov1.IndexRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*yokov1.IndexRequest(nil), f.indexRequests...)
}

func (f *fakeYokoServiceClient) searchRequestMessages() []*yokov1.SearchRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*yokov1.SearchRequest(nil), f.searchRequests...)
}

func newTestClient(fake *fakeYokoServiceClient) *Client {
	client := New(nil, "http://yoko.example", nil, WithServiceClient(fake))
	client.SetSchema("type Query { product: Product }")
	return client
}

func searchResponse(name string) *yokov1.SearchResponse {
	return &yokov1.SearchResponse{
		Operations: []*yokov1.GeneratedOperation{
			{
				Name:        name,
				Body:        "query " + name + " { product { id } }",
				Kind:        yokov1.OperationKind_OPERATION_KIND_QUERY,
				Description: "Fetch product",
			},
		},
	}
}

func connectError(code connect.Code, message string) error {
	return connect.NewError(code, errors.New(message))
}

func TestSearchFirstCallIndexesSchemaThenSearchesWithReturnedID(t *testing.T) {
	fake := &fakeYokoServiceClient{
		indexFunc: func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
			return connect.NewResponse(&yokov1.IndexResponse{SchemaId: "schema-from-yoko"}), nil
		},
		searchFunc: func(context.Context, *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
			return connect.NewResponse(searchResponse("fromSearch")), nil
		},
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), "session-1", []string{"find products"})

	require.NoError(t, err)
	require.Equal(t, searchResponse("fromSearch"), actual)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.SearchRequest{
		{
			Prompts:   []string{"find products"},
			SchemaId:  "schema-from-yoko",
			SessionId: "session-1",
		},
	}, fake.searchRequestMessages())
}

func TestSearchSubsequentCallUsesCachedSchemaID(t *testing.T) {
	fake := &fakeYokoServiceClient{}
	client := newTestClient(fake)

	first, firstErr := client.Search(context.Background(), "session-1", []string{"first"})
	second, secondErr := client.Search(context.Background(), "session-2", []string{"second"})

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	require.Equal(t, searchResponse("op"), first)
	require.Equal(t, searchResponse("op"), second)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.SearchRequest{
		{
			Prompts:   []string{"first"},
			SchemaId:  "schema-1",
			SessionId: "session-1",
		},
		{
			Prompts:   []string{"second"},
			SchemaId:  "schema-1",
			SessionId: "session-2",
		},
	}, fake.searchRequestMessages())
}

func TestSearchReindexesAndRetriesOnceAfterNotFound(t *testing.T) {
	var searchCount int
	fake := &fakeYokoServiceClient{}
	indexIDs := []string{"schema-initial", "schema-reindexed"}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexResponse{SchemaId: id}), nil
	}
	fake.searchFunc = func(context.Context, *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
		searchCount++
		if searchCount == 1 {
			return nil, connectError(connect.CodeNotFound, "schema evicted")
		}
		return connect.NewResponse(searchResponse("retried")), nil
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), "session-1", []string{"find products"})

	require.NoError(t, err)
	require.Equal(t, searchResponse("retried"), actual)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.SearchRequest{
		{
			Prompts:   []string{"find products"},
			SchemaId:  "schema-initial",
			SessionId: "session-1",
		},
		{
			Prompts:   []string{"find products"},
			SchemaId:  "schema-reindexed",
			SessionId: "session-1",
		},
	}, fake.searchRequestMessages())
}

func TestSearchRetryFailureSurfacesErrorAndLeavesCacheEmpty(t *testing.T) {
	retryErr := connectError(connect.CodeUnavailable, "retry transport down")
	indexIDs := []string{"schema-initial", "schema-reindexed", "schema-after-failure"}
	fake := &fakeYokoServiceClient{}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexResponse{SchemaId: id}), nil
	}
	searchErrors := []error{
		connectError(connect.CodeNotFound, "schema evicted"),
		retryErr,
		nil,
	}
	fake.searchFunc = func(context.Context, *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
		err := searchErrors[len(fake.searchRequestMessages())-1]
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(searchResponse("afterFailure")), nil
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), "session-1", []string{"find products"})

	require.Nil(t, actual)
	require.ErrorIs(t, err, retryErr)

	actualAfterFailure, errAfterFailure := client.Search(context.Background(), "session-2", []string{"find products again"})

	require.NoError(t, errAfterFailure)
	require.Equal(t, searchResponse("afterFailure"), actualAfterFailure)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
		{SchemaSdl: "type Query { product: Product }"},
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.SearchRequest{
		{
			Prompts:   []string{"find products"},
			SchemaId:  "schema-initial",
			SessionId: "session-1",
		},
		{
			Prompts:   []string{"find products"},
			SchemaId:  "schema-reindexed",
			SessionId: "session-1",
		},
		{
			Prompts:   []string{"find products again"},
			SchemaId:  "schema-after-failure",
			SessionId: "session-2",
		},
	}, fake.searchRequestMessages())
}

func TestSearchRetryNotFoundSurfacesErrorAndLeavesCacheEmpty(t *testing.T) {
	retryErr := connectError(connect.CodeNotFound, "schema evicted again")
	indexIDs := []string{"schema-initial", "schema-reindexed", "schema-after-failure"}
	fake := &fakeYokoServiceClient{}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexResponse{SchemaId: id}), nil
	}
	searchErrors := []error{
		connectError(connect.CodeNotFound, "schema evicted"),
		retryErr,
		nil,
	}
	fake.searchFunc = func(context.Context, *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
		err := searchErrors[len(fake.searchRequestMessages())-1]
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(searchResponse("afterFailure")), nil
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), "session-1", []string{"find products"})

	require.Nil(t, actual)
	require.ErrorIs(t, err, retryErr)

	actualAfterFailure, errAfterFailure := client.Search(context.Background(), "session-2", []string{"find products again"})

	require.NoError(t, errAfterFailure)
	require.Equal(t, searchResponse("afterFailure"), actualAfterFailure)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
		{SchemaSdl: "type Query { product: Product }"},
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
}

func TestSetSchemaInvalidatesCachedIDAndNextSearchReindexes(t *testing.T) {
	indexIDs := []string{"schema-v1", "schema-v2"}
	fake := &fakeYokoServiceClient{}
	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
		id := indexIDs[len(fake.indexRequestMessages())-1]
		return connect.NewResponse(&yokov1.IndexResponse{SchemaId: id}), nil
	}
	client := newTestClient(fake)

	_, firstErr := client.Search(context.Background(), "session-1", []string{"first"})
	client.SetSchema("type Query { review: Review }")
	_, secondErr := client.Search(context.Background(), "session-2", []string{"second"})

	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
	require.Equal(t, "type Query { review: Review }", client.Schema())
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
		{SchemaSdl: "type Query { review: Review }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.SearchRequest{
		{
			Prompts:   []string{"first"},
			SchemaId:  "schema-v1",
			SessionId: "session-1",
		},
		{
			Prompts:   []string{"second"},
			SchemaId:  "schema-v2",
			SessionId: "session-2",
		},
	}, fake.searchRequestMessages())
}

func TestConcurrentFirstSearchIndexesOnce(t *testing.T) {
	indexStarted := make(chan struct{})
	releaseIndex := make(chan struct{})
	var indexStartedOnce sync.Once
	fake := &fakeYokoServiceClient{
		indexFunc: func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
			indexStartedOnce.Do(func() {
				close(indexStarted)
			})
			<-releaseIndex
			return connect.NewResponse(&yokov1.IndexResponse{SchemaId: "schema-shared"}), nil
		},
	}
	client := newTestClient(fake)

	var wg sync.WaitGroup
	wg.Add(2)
	results := make([]*yokov1.SearchResponse, 2)
	errs := make([]error, 2)
	go func() {
		defer wg.Done()
		results[0], errs[0] = client.Search(context.Background(), "session-1", []string{"first"})
	}()
	<-indexStarted
	go func() {
		defer wg.Done()
		results[1], errs[1] = client.Search(context.Background(), "session-2", []string{"second"})
	}()
	time.Sleep(25 * time.Millisecond)
	close(releaseIndex)
	wg.Wait()

	require.NoError(t, errs[0])
	require.NoError(t, errs[1])
	require.Equal(t, searchResponse("op"), results[0])
	require.Equal(t, searchResponse("op"), results[1])
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	assert.Equal(t, 2, len(fake.searchRequestMessages()))
}

func TestConcurrentFirstSearchIndexFailureReturnsErrorToBothAndLeavesCacheEmpty(t *testing.T) {
	indexErr := connectError(connect.CodeUnavailable, "index unavailable")
	indexStarted := make(chan struct{})
	releaseIndex := make(chan struct{})
	var indexStartedOnce sync.Once
	fake := &fakeYokoServiceClient{
		indexFunc: func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
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
	results := make([]*yokov1.SearchResponse, 2)
	errs := make([]error, 2)
	go func() {
		defer wg.Done()
		results[0], errs[0] = client.Search(context.Background(), "session-1", []string{"first"})
	}()
	<-indexStarted
	go func() {
		defer wg.Done()
		results[1], errs[1] = client.Search(context.Background(), "session-2", []string{"second"})
	}()
	time.Sleep(25 * time.Millisecond)
	close(releaseIndex)
	wg.Wait()

	require.Nil(t, results[0])
	require.Nil(t, results[1])
	require.ErrorIs(t, errs[0], indexErr)
	require.ErrorIs(t, errs[1], indexErr)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.SearchRequest(nil), fake.searchRequestMessages())

	fake.indexFunc = func(context.Context, *connect.Request[yokov1.IndexRequest]) (*connect.Response[yokov1.IndexResponse], error) {
		return connect.NewResponse(&yokov1.IndexResponse{SchemaId: "schema-after-error"}), nil
	}
	actual, err := client.Search(context.Background(), "session-3", []string{"third"})

	require.NoError(t, err)
	require.Equal(t, searchResponse("op"), actual)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
}

func TestSearchBubblesUpArbitraryConnectErrors(t *testing.T) {
	searchErr := connectError(connect.CodeUnavailable, "search unavailable")
	fake := &fakeYokoServiceClient{
		searchFunc: func(context.Context, *connect.Request[yokov1.SearchRequest]) (*connect.Response[yokov1.SearchResponse], error) {
			return nil, searchErr
		},
	}
	client := newTestClient(fake)

	actual, err := client.Search(context.Background(), "session-1", []string{"find products"})

	require.Nil(t, actual)
	require.ErrorIs(t, err, searchErr)
	require.Equal(t, []*yokov1.IndexRequest{
		{SchemaSdl: "type Query { product: Product }"},
	}, fake.indexRequestMessages())
	require.Equal(t, []*yokov1.SearchRequest{
		{
			Prompts:   []string{"find products"},
			SchemaId:  "schema-1",
			SessionId: "session-1",
		},
	}, fake.searchRequestMessages())
}

func TestSchemaGetterReturnsCurrentSchema(t *testing.T) {
	client := New(nil, "http://yoko.example", nil, WithServiceClient(&fakeYokoServiceClient{}))

	require.Equal(t, "", client.Schema())
	client.SetSchema("type Query { store: Store }")
	require.Equal(t, "type Query { store: Store }", client.Schema())
}
