package storage

import (
	"context"
	"fmt"
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

	bundle, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, querySHA+"\n"+mutationSHA, bundle)

	require.NoError(t, backend.Reset(ctx, "session-1"))
	gotAfterReset, ok, err := backend.GetOp(ctx, "session-1", querySHA)
	require.NoError(t, err)
	assert.Equal(t, false, ok)
	assert.Equal(t, SessionOp{}, gotAfterReset)

	bundleAfterReset, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, "", bundleAfterReset)
}

func TestMemoryBackendAppendIdempotentOnIdenticalBody(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)

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

	got, ok, err := backend.GetOp(ctx, "s1", sha)
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	assert.Equal(t, SessionOp{Name: sha, Body: body, Kind: OperationKindQuery, Description: "v1"}, got)
}

func TestMemoryBackendAppendDedupsBodyAcrossPromptNames(t *testing.T) {
	// Regression: yoko sometimes returns the same body under different
	// document names ("getUser" via one prompt, "fetchUser" via another).
	// Storage dedups by canonical body, so the second registration reuses
	// the first SessionOp regardless of the inbound DocumentName.
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)

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

func TestMemoryBackendAppendDifferentBodiesGetSeparateEntries(t *testing.T) {
	// Regression: yoko regenerates an operation under the same document
	// name but with a different body. With SHA-based identity each body
	// gets its own entry, eliminating the silent overwrite that name-based
	// identity used to mask.
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)

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

func TestMemoryBackendSetSchemaClearsSessionsAndIncrementsSchemaVersion(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)
	initialVersion := backend.SchemaVersion()

	body := "query { user { id } }"
	sha := ShortSHA(body)
	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: sha, Body: body, Kind: OperationKindQuery}})
	require.NoError(t, err)
	schema := &ast.Document{}

	backend.SetSchema(schema)

	assert.Equal(t, initialVersion+1, backend.SchemaVersion())
	assert.Equal(t, schema, backend.Schema())

	got, ok, err := backend.GetOp(ctx, "session-1", sha)
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

	idleBody := "query { idle }"
	freshBody := "query { fresh }"
	idleSHA := ShortSHA(idleBody)
	freshSHA := ShortSHA(freshBody)

	_, err := backend.Append(ctx, "idle", []SessionOp{{Name: idleSHA, Body: idleBody, Kind: OperationKindQuery}})
	require.NoError(t, err)
	_, err = backend.Append(ctx, "fresh", []SessionOp{{Name: freshSHA, Body: freshBody, Kind: OperationKindQuery}})
	require.NoError(t, err)
	clock.Advance(30 * time.Second)
	_, ok, err := backend.GetOp(ctx, "fresh", freshSHA)
	require.NoError(t, err)
	assert.Equal(t, true, ok)

	clock.Advance(31 * time.Second)
	backend.sweepIdle()

	_, idleOK, err := backend.GetOp(ctx, "idle", idleSHA)
	require.NoError(t, err)
	assert.Equal(t, false, idleOK)

	_, freshOK, err := backend.GetOp(ctx, "fresh", freshSHA)
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

	aBody := "query { a }"
	bBody := "query { b }"
	cBody := "query { c }"
	aSHA := ShortSHA(aBody)
	bSHA := ShortSHA(bBody)
	cSHA := ShortSHA(cBody)

	_, err := backend.Append(ctx, "session-a", []SessionOp{{Name: aSHA, Body: aBody, Kind: OperationKindQuery}})
	require.NoError(t, err)
	clock.Advance(time.Second)
	_, err = backend.Append(ctx, "session-b", []SessionOp{{Name: bSHA, Body: bBody, Kind: OperationKindQuery}})
	require.NoError(t, err)
	clock.Advance(time.Second)
	_, ok, err := backend.GetOp(ctx, "session-a", aSHA)
	require.NoError(t, err)
	assert.Equal(t, true, ok)
	clock.Advance(time.Second)

	_, err = backend.Append(ctx, "session-c", []SessionOp{{Name: cSHA, Body: cBody, Kind: OperationKindQuery}})
	require.NoError(t, err)

	_, aOK, err := backend.GetOp(ctx, "session-a", aSHA)
	require.NoError(t, err)
	assert.Equal(t, true, aOK)

	_, bOK, err := backend.GetOp(ctx, "session-b", bSHA)
	require.NoError(t, err)
	assert.Equal(t, false, bOK)

	_, cOK, err := backend.GetOp(ctx, "session-c", cSHA)
	require.NoError(t, err)
	assert.Equal(t, true, cOK)
}

func TestMemoryBackendConcurrentAppendSameBodyConvergesToOne(t *testing.T) {
	ctx := context.Background()
	clock := newTestClock()
	backend := newTestBackend(t, clock, nil)

	const goroutines = 32
	body := "query Shared { shared }"
	sha := ShortSHA(body)

	var wg sync.WaitGroup
	results := make(chan []SessionOp, goroutines)

	for i := range goroutines {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resolved, err := backend.Append(ctx, "shared", []SessionOp{{
				Name:        sha,
				Body:        body,
				Kind:        OperationKindQuery,
				Description: fmt.Sprintf("Shared %d", i),
			}})
			require.NoError(t, err)
			results <- resolved
		}(i)
	}

	wg.Wait()
	close(results)

	for resolved := range results {
		require.Equal(t, 1, len(resolved))
		assert.Equal(t, sha, resolved[0].Name)
	}

	names, err := backend.ListNames(ctx, "shared")
	require.NoError(t, err)
	assert.Equal(t, []string{sha}, names)
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

	oneBody := "query { one }"
	twoBody := "query { two }"
	oneSHA := ShortSHA(oneBody)
	twoSHA := ShortSHA(twoBody)

	_, err := backend.Append(ctx, "session-1", []SessionOp{{Name: oneSHA, Body: oneBody, Kind: OperationKindQuery}})
	require.NoError(t, err)
	first, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, oneSHA, first)

	second, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, oneSHA, second)

	_, err = backend.Append(ctx, "session-1", []SessionOp{{Name: twoSHA, Body: twoBody, Kind: OperationKindQuery}})
	require.NoError(t, err)
	third, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, oneSHA+","+twoSHA, third)

	mu.Lock()
	gotRendered := append([]string(nil), rendered...)
	mu.Unlock()
	assert.Equal(t, []string{oneSHA, oneSHA + "," + twoSHA}, gotRendered)
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

	oneBody := "query { one }"
	twoBody := "query { two }"
	threeBody := "query { three }"
	oneSHA := ShortSHA(oneBody)
	twoSHA := ShortSHA(twoBody)
	threeSHA := ShortSHA(threeBody)
	twoOpsBundle := oneSHA + "|" + twoSHA

	backend := NewMemoryBackend(MemoryConfig{
		SessionTTL:     time.Hour,
		MaxSessions:    100,
		MaxBundleBytes: len(twoOpsBundle),
		Renderer:       renderer,
		Now:            clock.Now,
	})

	_, err := backend.Append(ctx, "session-1", []SessionOp{
		{Name: oneSHA, Body: oneBody, Kind: OperationKindQuery},
		{Name: twoSHA, Body: twoBody, Kind: OperationKindQuery},
		{Name: threeSHA, Body: threeBody, Kind: OperationKindQuery},
	})
	require.NoError(t, err)

	bundle, err := backend.Bundle(ctx, "session-1")
	require.NoError(t, err)
	assert.Equal(t, twoOpsBundle, bundle)
}
