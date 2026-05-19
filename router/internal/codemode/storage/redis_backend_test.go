package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	miniredisserver "github.com/alicebob/miniredis/v2/server"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

type testRedisRenderer func(context.Context, []SessionOp, *ast.Document) (string, error)

func (f testRedisRenderer) Render(ctx context.Context, ops []SessionOp, schema *ast.Document) (string, error) {
	return f(ctx, ops, schema)
}

func newTestRedisBackend(t *testing.T, renderer Renderer, ttl time.Duration) (*RedisBackend, *miniredis.Miniredis, *redis.Client) {
	t.Helper()

	if renderer == nil {
		renderer = testRedisRenderer(func(_ context.Context, ops []SessionOp, _ *ast.Document) (string, error) {
			names := make([]string, 0, len(ops))
			for _, op := range ops {
				names = append(names, op.Name)
			}
			return strings.Join(names, "\n"), nil
		})
	}
	if ttl == 0 {
		ttl = time.Hour
	}

	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})

	backend, err := NewRedisBackend(RedisConfig{
		Client:     client,
		KeyPrefix:  "test_code_mode",
		SessionTTL: ttl,
		Renderer:   renderer,
		Now:        func() time.Time { return time.Unix(1_700_000_000, 0).UTC() },
	})
	require.NoError(t, err)
	require.NoError(t, backend.Start(context.Background()))
	t.Cleanup(func() {
		require.NoError(t, backend.Stop())
	})

	return backend, mr, client
}

func TestRedisBackendAppendGetOpRoundTrip(t *testing.T) {
	ctx := context.Background()
	backend, _, _ := newTestRedisBackend(t, nil, time.Hour)

	queryBody := "query GetUser { user { id } }"
	mutationBody := "mutation DeleteUser { deleteUser(id: 1) }"
	querySHA := ShortSHA(queryBody)
	mutationSHA := ShortSHA(mutationBody)

	ops := []SessionOp{
		{Name: querySHA, Body: queryBody, Kind: OperationKindQuery, Description: "Fetch a user"},
		{Name: mutationSHA, Body: mutationBody, Kind: OperationKindMutation, Description: "Delete a user"},
	}
	appended, err := backend.Append(ctx, "session-1", ops)
	require.NoError(t, err)
	assert.Equal(t, ops, appended)

	gotQuery, ok, err := backend.GetOp(ctx, "session-1", querySHA)
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	assert.Equal(t, ops[0], gotQuery)

	gotMutation, ok, err := backend.GetOp(ctx, "session-1", mutationSHA)
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	assert.Equal(t, ops[1], gotMutation)

	gotMissing, ok, err := backend.GetOp(ctx, "session-1", "missing")
	require.NoError(t, err)
	assert.Equal(t, false, ok)
	assert.Equal(t, SessionOp{}, gotMissing)
}

func TestRedisBackendAppendIdempotentOnIdenticalBody(t *testing.T) {
	ctx := context.Background()
	backend, _, _ := newTestRedisBackend(t, nil, time.Hour)

	body := "query GetUser { user { id } }"
	sha := ShortSHA(body)

	first, err := backend.Append(ctx, "s1", []SessionOp{
		{Name: sha, Body: body, Kind: OperationKindQuery, Description: "v1"},
	})
	require.NoError(t, err)
	assert.Equal(t, []SessionOp{
		{Name: sha, Body: body, Kind: OperationKindQuery, Description: "v1"},
	}, first)

	// Whitespace-only differences canonicalize to the same SHA, so the
	// backend reuses the first registration.
	second, err := backend.Append(ctx, "s1", []SessionOp{
		{Name: sha, Body: "  query GetUser {\n  user { id }\n}\n", Kind: OperationKindQuery, Description: "v2"},
	})
	require.NoError(t, err)
	assert.Equal(t, []SessionOp{
		{Name: sha, Body: body, Kind: OperationKindQuery, Description: "v1"},
	}, second)

	names, err := backend.ListNames(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, []string{sha}, names)
}

func TestRedisBackendAppendDedupsBodyAcrossPromptNames(t *testing.T) {
	ctx := context.Background()
	backend, _, _ := newTestRedisBackend(t, nil, time.Hour)

	body := "query GetUser { user { id } }"
	sha := ShortSHA(body)

	_, err := backend.Append(ctx, "s1", []SessionOp{
		{Name: sha, Body: body, Kind: OperationKindQuery, DocumentName: "GetUser"},
	})
	require.NoError(t, err)

	second, err := backend.Append(ctx, "s1", []SessionOp{
		{Name: sha, Body: body, Kind: OperationKindQuery, DocumentName: "FetchUser"},
	})
	require.NoError(t, err)
	assert.Equal(t, []SessionOp{
		{Name: sha, Body: body, Kind: OperationKindQuery, DocumentName: "GetUser"},
	}, second)

	names, err := backend.ListNames(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, []string{sha}, names)
}

func TestRedisBackendAppendDifferentBodiesGetSeparateEntries(t *testing.T) {
	ctx := context.Background()
	backend, _, _ := newTestRedisBackend(t, nil, time.Hour)

	bodyV1 := "query GetUser { user { id } }"
	bodyV2 := "query GetUser { user { name } }"
	shaV1 := ShortSHA(bodyV1)
	shaV2 := ShortSHA(bodyV2)
	require.NotEqual(t, shaV1, shaV2)

	_, err := backend.Append(ctx, "s1", []SessionOp{
		{Name: shaV1, Body: bodyV1, Kind: OperationKindQuery, DocumentName: "GetUser"},
	})
	require.NoError(t, err)

	resolved, err := backend.Append(ctx, "s1", []SessionOp{
		{Name: shaV2, Body: bodyV2, Kind: OperationKindQuery, DocumentName: "GetUser"},
	})
	require.NoError(t, err)
	assert.Equal(t, []SessionOp{
		{Name: shaV2, Body: bodyV2, Kind: OperationKindQuery, DocumentName: "GetUser"},
	}, resolved)

	names, err := backend.ListNames(ctx, "s1")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{shaV1, shaV2}, names)
}

func TestRedisBackendBundleRendersAndReadsFromCache(t *testing.T) {
	ctx := context.Background()
	var renders atomic.Int64
	backend, mr, _ := newTestRedisBackend(t, testRedisRenderer(func(_ context.Context, ops []SessionOp, _ *ast.Document) (string, error) {
		renders.Add(1)
		return fmt.Sprintf("render-%d:%s", renders.Load(), ops[0].Name), nil
	}), time.Hour)

	body := "query { user { id } }"
	sha := ShortSHA(body)
	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: sha, Body: body, Kind: OperationKindQuery}})
	require.NoError(t, err)

	first, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "render-1:"+sha, first)
	assert.Equal(t, true, mr.Exists(backend.bundleKey("session-1")))

	second, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "render-1:"+sha, second)
	assert.Equal(t, int64(1), renders.Load())
}

func TestRedisBackendResetClearsOpsAndBundleKeys(t *testing.T) {
	ctx := context.Background()
	backend, mr, _ := newTestRedisBackend(t, nil, time.Hour)

	body := "query { user { id } }"
	sha := ShortSHA(body)
	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: sha, Body: body, Kind: OperationKindQuery}})
	require.NoError(t, err)
	_, err = backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	opsKey := backend.opsKey("session-1")
	bundleKey := backend.bundleKey("session-1")
	assert.Equal(t, true, mr.Exists(opsKey))
	assert.Equal(t, true, mr.Exists(bundleKey))

	require.NoError(t, backend.Reset(ctx, "session-1"))

	assert.Equal(t, false, mr.Exists(opsKey))
	assert.Equal(t, false, mr.Exists(bundleKey))
}

func TestRedisBackendSetSchemaRotatesKeysAndKeepsOldKeysUntilTTL(t *testing.T) {
	ctx := context.Background()
	schemaA := &ast.Document{RootNodes: []ast.Node{{Kind: ast.NodeKindSchemaDefinition}}}
	schemaB := &ast.Document{RootNodes: []ast.Node{{Kind: ast.NodeKindObjectTypeDefinition}}}
	backend, mr, _ := newTestRedisBackend(t, testRedisRenderer(func(_ context.Context, _ []SessionOp, schema *ast.Document) (string, error) {
		return fmt.Sprintf("schema-kind-%d", schema.RootNodes[0].Kind), nil
	}), time.Hour)
	backend.SetSchema(schemaA)

	body := "query { user { id } }"
	sha := ShortSHA(body)
	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: sha, Body: body, Kind: OperationKindQuery}})
	require.NoError(t, err)
	oldOpsKey := backend.opsKey("session-1")
	oldBundleKey := backend.bundleKey("session-1")
	first, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, fmt.Sprintf("schema-kind-%d", schemaA.RootNodes[0].Kind), first)
	assert.Equal(t, true, mr.Exists(oldOpsKey))
	assert.Equal(t, true, mr.Exists(oldBundleKey))

	oldVersion := backend.SchemaVersion()
	backend.SetSchema(schemaB)

	assert.Equal(t, oldVersion+1, backend.SchemaVersion())
	assert.Equal(t, schemaB, backend.Schema())
	assert.Equal(t, true, mr.Exists(oldOpsKey))
	assert.Equal(t, true, mr.Exists(oldBundleKey))

	_, err = backend.Append(ctx, "session-1", []SessionOp{{Name: sha, Body: body, Kind: OperationKindQuery}})
	require.NoError(t, err)
	second, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, fmt.Sprintf("schema-kind-%d", schemaB.RootNodes[0].Kind), second)
	assert.Equal(t, true, mr.Exists(backend.opsKey("session-1")))
	assert.Equal(t, true, mr.Exists(backend.bundleKey("session-1")))
}

func TestRedisBackendConcurrentAppendRetriesWatchConflicts(t *testing.T) {
	ctx := context.Background()
	backend, mr, _ := newTestRedisBackend(t, nil, time.Hour)
	const goroutines = 12
	const opsPerGoroutine = 8

	var wg sync.WaitGroup
	errs := make(chan error, goroutines)
	for i := range goroutines {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			ops := make([]SessionOp, 0, opsPerGoroutine)
			for j := range opsPerGoroutine {
				body := fmt.Sprintf("query Q_%02d_%02d { f_%02d_%02d }", worker, j, worker, j)
				ops = append(ops, SessionOp{
					Name: ShortSHA(body),
					Body: body,
					Kind: OperationKindQuery,
				})
			}
			_, err := backend.Append(ctx, "session-1", ops)
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	raw, err := mr.Get(backend.opsKey("session-1"))
	require.NoError(t, err)
	var entries []redisOpEntry
	require.NoError(t, json.Unmarshal([]byte(raw), &entries))
	assert.Equal(t, goroutines*opsPerGoroutine, len(entries))
}

func TestRedisBackendAppendAbandonsOnContextDone(t *testing.T) {
	backend, mr, _ := newTestRedisBackend(t, nil, time.Hour)
	mr.SetError("LOADING Redis is loading the dataset in memory")
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	body := "query { user { id } }"
	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: ShortSHA(body), Body: body, Kind: OperationKindQuery}})

	require.Error(t, err)
	assert.Equal(t, true, errors.Is(err, context.DeadlineExceeded))
}

func TestRedisBackendExpiresKeysOnWrites(t *testing.T) {
	ctx := context.Background()
	backend, mr, _ := newTestRedisBackend(t, nil, 10*time.Second)

	body := "query { user { id } }"
	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: ShortSHA(body), Body: body, Kind: OperationKindQuery}})
	require.NoError(t, err)
	opsKey := backend.opsKey("session-1")
	assert.Equal(t, 10*time.Second, mr.TTL(opsKey))

	_, err = backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	bundleKey := backend.bundleKey("session-1")
	assert.Equal(t, 10*time.Second, mr.TTL(bundleKey))

	mr.FastForward(11 * time.Second)
	assert.Equal(t, false, mr.Exists(opsKey))
	assert.Equal(t, false, mr.Exists(bundleKey))
}

func TestRedisBackendBundleWriteBackIsBestEffort(t *testing.T) {
	ctx := context.Background()
	backend, mr, _ := newTestRedisBackend(t, testRedisRenderer(func(_ context.Context, ops []SessionOp, _ *ast.Document) (string, error) {
		return "rendered:" + ops[0].Name, nil
	}), time.Hour)
	body := "query { user { id } }"
	sha := ShortSHA(body)
	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: sha, Body: body, Kind: OperationKindQuery}})
	require.NoError(t, err)

	mr.Server().SetPreHook(func(c *miniredisserver.Peer, cmd string, _ ...string) bool {
		if strings.EqualFold(cmd, "set") {
			c.WriteError("ERR forced set failure")
			return true
		}
		return false
	})
	t.Cleanup(func() {
		mr.Server().SetPreHook(nil)
	})

	bundle, err := backend.Bundle(ctx, "session-1")

	require.NoError(t, err)
	assert.Equal(t, "rendered:"+sha, bundle)
	assert.Equal(t, false, mr.Exists(backend.bundleKey("session-1")))
}
