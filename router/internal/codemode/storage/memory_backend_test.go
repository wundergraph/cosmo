package storage

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func newTestClock() *testClock {
	return &testClock{now: time.Unix(1_700_000_000, 0).UTC()}
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func newTestBackend(t *testing.T, clock *testClock, renderer Renderer) *MemoryBackend {
	t.Helper()

	if renderer == nil {
		renderer = RendererFunc(func(ops []SessionOp) (string, error) {
			names := make([]string, 0, len(ops))
			for _, op := range ops {
				names = append(names, op.Name)
			}
			return strings.Join(names, "\n"), nil
		})
	}

	backend := NewMemoryBackend(MemoryConfig{
		SessionTTL:     time.Hour,
		MaxSessions:    100,
		MaxBundleBytes: 1 << 20,
		Renderer:       renderer,
		Now:            clock.Now,
	})
	require.NoError(t, backend.Start(context.Background()))
	t.Cleanup(func() {
		require.NoError(t, backend.Stop())
	})

	return backend
}

func TestMemoryBackendAppendGetOpBundleResetRoundTrip(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)

	ops := []SessionOp{
		{Name: "get-user", Body: "query GetUser { user { id } }", Kind: OperationKindQuery, Description: "Fetch a user"},
		{Name: "delete", Body: "mutation DeleteUser { deleteUser(id: 1) }", Kind: OperationKindMutation, Description: "Delete a user"},
		{Name: "get-user", Body: "query GetUserAgain { user { name } }", Kind: OperationKindQuery, Description: "Fetch user name"},
	}

	appended, err := backend.Append(ctx, "session-1", ops)
	require.NoError(t, err)
	assert.Equal(t, []SessionOp{
		{Name: "getUser", Body: "query GetUser { user { id } }", Kind: OperationKindQuery, Description: "Fetch a user"},
		{Name: "op_delete", Body: "mutation DeleteUser { deleteUser(id: 1) }", Kind: OperationKindMutation, Description: "Delete a user"},
		{Name: "getUser_2", Body: "query GetUserAgain { user { name } }", Kind: OperationKindQuery, Description: "Fetch user name"},
	}, appended)

	gotQuery, ok, err := backend.GetOp(ctx, "session-1", "getUser")
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	assert.Equal(t, SessionOp{Name: "getUser", Body: "query GetUser { user { id } }", Kind: OperationKindQuery, Description: "Fetch a user"}, gotQuery)

	gotMutation, ok, err := backend.GetOp(ctx, "session-1", "op_delete")
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	assert.Equal(t, SessionOp{Name: "op_delete", Body: "mutation DeleteUser { deleteUser(id: 1) }", Kind: OperationKindMutation, Description: "Delete a user"}, gotMutation)

	gotCollision, ok, err := backend.GetOp(ctx, "session-1", "getUser_2")
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	assert.Equal(t, SessionOp{Name: "getUser_2", Body: "query GetUserAgain { user { name } }", Kind: OperationKindQuery, Description: "Fetch user name"}, gotCollision)

	bundle, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "getUser\nop_delete\ngetUser_2", bundle)

	require.NoError(t, backend.Reset(ctx, "session-1"))
	gotAfterReset, ok, err := backend.GetOp(ctx, "session-1", "getUser")
	require.NoError(t, err)
	assert.Equal(t, false, ok)
	assert.Equal(t, SessionOp{}, gotAfterReset)

	bundleAfterReset, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "", bundleAfterReset)
}

func TestMemoryBackendSetSchemaClearsSessionsAndIncrementsSchemaVersion(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)
	initialVersion := backend.SchemaVersion()

	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: "get-user", Body: "query { user { id } }", Kind: OperationKindQuery}})
	require.NoError(t, err)
	schema := &ast.Document{}

	backend.SetSchema(schema)

	assert.Equal(t, initialVersion+1, backend.SchemaVersion())
	assert.Equal(t, schema, backend.Schema())

	got, ok, err := backend.GetOp(ctx, "session-1", "getUser")
	require.NoError(t, err)
	assert.Equal(t, false, ok)
	assert.Equal(t, SessionOp{}, got)

	backend.SetSchema(&ast.Document{})
	assert.Equal(t, initialVersion+2, backend.SchemaVersion())
}

func TestMemoryBackendTTLEvictionUsesInjectedClock(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := NewMemoryBackend(MemoryConfig{
		SessionTTL:     time.Minute,
		MaxSessions:    100,
		MaxBundleBytes: 1 << 20,
		Renderer:       RendererFunc(func(ops []SessionOp) (string, error) { return "", nil }),
		Now:            clock.Now,
	})

	_, err := backend.Append(ctx, "idle", []SessionOp{{Name: "idle-op", Body: "query { idle }", Kind: OperationKindQuery}})
	require.NoError(t, err)
	_, err = backend.Append(ctx, "fresh", []SessionOp{{Name: "fresh-op", Body: "query { fresh }", Kind: OperationKindQuery}})
	require.NoError(t, err)
	clock.Advance(30 * time.Second)
	_, ok, err := backend.GetOp(ctx, "fresh", "freshOp")
	require.NoError(t, err)
	assert.Equal(t, true, ok)

	clock.Advance(31 * time.Second)
	backend.sweepIdle()

	_, idleOK, err := backend.GetOp(ctx, "idle", "idleOp")
	require.NoError(t, err)
	assert.Equal(t, false, idleOK)

	_, freshOK, err := backend.GetOp(ctx, "fresh", "freshOp")
	require.NoError(t, err)
	assert.Equal(t, true, freshOK)
}

func TestMemoryBackendLRUEvictionAtMaxSessions(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := NewMemoryBackend(MemoryConfig{
		SessionTTL:     time.Hour,
		MaxSessions:    2,
		MaxBundleBytes: 1 << 20,
		Renderer:       RendererFunc(func(ops []SessionOp) (string, error) { return "", nil }),
		Now:            clock.Now,
	})

	_, err := backend.Append(ctx, "session-a", []SessionOp{{Name: "a-op", Body: "query { a }", Kind: OperationKindQuery}})
	require.NoError(t, err)
	clock.Advance(time.Second)
	_, err = backend.Append(ctx, "session-b", []SessionOp{{Name: "b-op", Body: "query { b }", Kind: OperationKindQuery}})
	require.NoError(t, err)
	clock.Advance(time.Second)
	_, ok, err := backend.GetOp(ctx, "session-a", "aOp")
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	clock.Advance(time.Second)

	_, err = backend.Append(ctx, "session-c", []SessionOp{{Name: "c-op", Body: "query { c }", Kind: OperationKindQuery}})
	require.NoError(t, err)

	_, aOK, err := backend.GetOp(ctx, "session-a", "aOp")
	require.NoError(t, err)
	assert.Equal(t, true, aOK)

	_, bOK, err := backend.GetOp(ctx, "session-b", "bOp")
	require.NoError(t, err)
	assert.Equal(t, false, bOK)

	_, cOK, err := backend.GetOp(ctx, "session-c", "cOp")
	require.NoError(t, err)
	assert.Equal(t, true, cOK)
}

func TestMemoryBackendConcurrentAppendIsRaceFreeAndSuffixesNames(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)

	const goroutines = 32
	var wg sync.WaitGroup
	errs := make(chan error, goroutines)

	for i := range goroutines {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := backend.Append(ctx, "shared", []SessionOp{{
				Name:        "shared-op",
				Body:        fmt.Sprintf("query Shared%d { shared%d }", i, i),
				Kind:        OperationKindQuery,
				Description: fmt.Sprintf("Shared %d", i),
			}})
			errs <- err
		}(i)
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		require.NoError(t, err)
	}

	names := make([]string, 0, goroutines)
	for i := range goroutines {
		name := "sharedOp"
		if i > 0 {
			name = fmt.Sprintf("sharedOp_%d", i+1)
		}
		op, ok, err := backend.GetOp(ctx, "shared", name)
		require.NoError(t, err)
		assert.Equal(t, true, ok)
		names = append(names, op.Name)
	}

	sort.Strings(names)
	want := make([]string, 0, goroutines)
	for i := range goroutines {
		name := "sharedOp"
		if i > 0 {
			name = fmt.Sprintf("sharedOp_%d", i+1)
		}
		want = append(want, name)
	}
	sort.Strings(want)
	assert.Equal(t, want, names)
}

func TestMemoryBackendBundleCacheInvalidatesOnAppend(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	var mu sync.Mutex
	rendered := make([]string, 0, 3)
	renderer := RendererFunc(func(ops []SessionOp) (string, error) {
		names := make([]string, 0, len(ops))
		for _, op := range ops {
			names = append(names, op.Name)
		}
		bundle := strings.Join(names, ",")
		mu.Lock()
		rendered = append(rendered, bundle)
		mu.Unlock()
		return bundle, nil
	})
	backend := newTestBackend(t, clock, renderer)

	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: "one", Body: "query { one }", Kind: OperationKindQuery}})
	require.NoError(t, err)
	first, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "one", first)

	second, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "one", second)

	_, err = backend.Append(ctx, "session-1", []SessionOp{{Name: "two", Body: "query { two }", Kind: OperationKindQuery}})
	require.NoError(t, err)
	third, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "one,two", third)

	mu.Lock()
	gotRendered := append([]string(nil), rendered...)
	mu.Unlock()
	assert.Equal(t, []string{"one", "one,two"}, gotRendered)
}

func TestMemoryBackendBundleDropsWholeOpsAtMaxBundleBytes(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	renderer := RendererFunc(func(ops []SessionOp) (string, error) {
		names := make([]string, 0, len(ops))
		for _, op := range ops {
			names = append(names, op.Name)
		}
		return strings.Join(names, "|"), nil
	})
	backend := NewMemoryBackend(MemoryConfig{
		SessionTTL:     time.Hour,
		MaxSessions:    100,
		MaxBundleBytes: len("one|two"),
		Renderer:       renderer,
		Now:            clock.Now,
	})

	_, err := backend.Append(ctx, "session-1", []SessionOp{
		{Name: "one", Body: "query { one }", Kind: OperationKindQuery},
		{Name: "two", Body: "query { two }", Kind: OperationKindQuery},
		{Name: "three", Body: "query { three }", Kind: OperationKindQuery},
	})
	require.NoError(t, err)

	bundle, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "one|two", bundle)
}
