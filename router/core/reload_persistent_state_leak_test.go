package core

import (
	"runtime"
	"testing"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/slowplancache"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// TestReloadConfig_PlanCacheRetentionLeak reproduces the confirmed memory-retention bug
// that occurs on router config hot-reload.
//
// The leak chain (all real production code paths, see graph_server.go / reload_persistent_state.go):
//
//  1. The ristretto plan cache is given an OnEvict callback (only when
//     cacheWarmup.Enabled && cacheWarmup.InMemoryFallback) that re-homes every evicted
//     *planWithMetaData into the graphMux's planFallbackCache (a *slowplancache.Cache).
//     -> graph_server.go:723-730
//  2. That planFallbackCache is registered into the Router-lifetime
//     ReloadPersistentState via setPlanCacheForFF.
//     -> graph_server.go:1609
//  3. On reload, graphMux.Shutdown() calls planCache.Close(). ristretto's Close() ->
//     Clear() -> storedItems.Clear(onEvict) fires OnEvict for EVERY remaining entry,
//     dumping the entire plan cache into planFallbackCache.
//     -> graph_server.go:964 + ristretto cache.go Close/Clear
//  4. Each cached entry is a *planWithMetaData which holds the planned operation/plan
//     plus large *ast.Document values (e.g. operationDocument).
//     -> operation_planner.go:20-28
//  5. slowplancache.Close() does NOT clear its stored entries map - it only closes
//     channels. So every demoted entry stays reachable via the Router-lifetime
//     ReloadPersistentState.
//     -> slow_plan_cache.go Close()
//
// Net: the old plan cache (and the operation documents it holds) are moved into a
// structure that is never freed.
//
// This test sets a finalizer on the cached entry's operationDocument, which is reachable
// only through the cached plan. After running the real shutdown/close path, it forces GC
// and asserts the document was collected (i.e. NO leak). On current main the finalizer
// never fires because the ReloadPersistentState keeps the slowplancache (and therefore
// the cached plan entry) alive, so the assertion FAILS. Once the leak is fixed (e.g.
// slowplancache.Close clears its entries map, or Shutdown stops demoting-on-close, or the
// fallback is detached on reload) the finalizer fires and the test PASSES.
//
// Note: the tracked field is operationDocument (not schemaDocument) so that the test
// compiles and is meaningful both on main and on the fix branch, which removes the
// stored-but-unread schemaDocument field. The leak chain is identical either way.
func TestReloadConfig_PlanCacheRetentionLeak(t *testing.T) {
	// Not parallel: relies on runtime.GC() behaviour and finalizer timing.

	t.Run("control: without Router-lifetime retention the cached plan is freed", func(t *testing.T) {
		// Sanity check that the finalizer mechanism itself is sound: when nothing
		// Router-lifetime holds the fallback cache, the cached plan entry must be
		// collectable after the same shutdown/close path. If this sub-test ever fails,
		// the leak assertion below would be meaningless.
		fired := runReloadClosePath(t, nil)
		require.True(t, awaitFinalizer(fired, 2*time.Second),
			"cached plan should be collectable when no Router-lifetime structure retains it")
	})

	t.Run("leak: ReloadPersistentState retains the cached plan across reload", func(t *testing.T) {
		// Build a real Router-lifetime ReloadPersistentState with the in-memory plan
		// cache fallback enabled, exactly as router.go does on startup.
		rps := NewReloadPersistentState(zap.NewNop())
		rps.UpdateReloadPersistentState(&Config{
			cacheWarmup: &config.CacheWarmupConfiguration{
				Enabled:          true,
				InMemoryFallback: true,
			},
		})
		require.True(t, rps.inMemoryPlanCacheFallback.IsEnabled())

		fired := runReloadClosePath(t, rps)

		// This is the assertion that catches the leak. On current main the cached plan
		// (and its operationDocument) remains reachable through:
		//   rps -> inMemoryPlanCacheFallback -> queriesForFeatureFlag[""]
		//       -> *slowplancache.Cache -> entries -> *planWithMetaData -> operationDocument
		// so the finalizer never fires and this FAILS. With the leak fixed it PASSES.
		require.True(t, awaitFinalizer(fired, 2*time.Second),
			"LEAK: cached plan was retained by ReloadPersistentState after config reload and never freed")

		// Keep rps alive until the very end so it is the only thing that could be
		// retaining the cached plan during the GC above.
		runtime.KeepAlive(rps)
	})
}

// runReloadClosePath wires up the exact cache structures and callbacks used in
// graph_server.go (ristretto plan cache with the cache-warmup OnEvict demote callback,
// plus a slowplancache fallback), inserts a single plan whose operationDocument has a
// finalizer, then exercises the real reload close path: planCache.Close() (which fires
// OnEvict for every remaining entry) followed by planFallbackCache.Close().
//
// If rps is non-nil, the fallback cache is registered into it via setPlanCacheForFF,
// mirroring graph_server.go:1609 - this is what makes the demoted entries survive on the
// Router-lifetime structure.
//
// It returns a channel that is closed by the finalizer when the operation document is
// collected.
func runReloadClosePath(t *testing.T, rps *ReloadPersistentState) <-chan struct{} {
	t.Helper()

	fired := make(chan struct{})

	// Run the wiring in a child function so that the only references to the plan and the
	// operation document are inside the cache structures (no lingering stack locals).
	func() {
		// A document held by the cached plan that we track for collection. We finalize
		// operationDocument because it survives the fix (the fix removes the unused
		// schemaDocument field) while being retained by the identical leak chain.
		opDoc := ast.NewDocument()
		runtime.SetFinalizer(opDoc, func(_ *ast.Document) {
			close(fired)
		})

		plan := &planWithMetaData{
			operationDocument: opDoc,
			content:           "query { leakCanary }",
			planningDuration:  5 * time.Second, // above the slowplancache threshold (0)
		}

		// The graphMux's planFallbackCache (slowplancache). threshold 0 so everything is
		// accepted, matching the production behaviour for demoted entries.
		fallback, err := slowplancache.New[*planWithMetaData](1024, 0)
		require.NoError(t, err)

		// The ristretto plan cache, wired with the SAME OnEvict callback as
		// graph_server.go buildOperationCaches when cacheWarmup in-memory fallback is on.
		planCache, err := ristretto.NewCache[uint64, *planWithMetaData](&ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:            1024,
			NumCounters:        1024 * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
			OnEvict: func(item *ristretto.Item[*planWithMetaData]) {
				fallback.Set(item.Key, item.Value, item.Value.planningDuration)
			},
		})
		require.NoError(t, err)

		// Insert the plan and make sure it is actually stored (ristretto writes are async).
		planCache.Set(1, plan, 1)
		planCache.Wait()

		// Register the fallback into the Router-lifetime state, exactly like buildGraphMux.
		if rps != nil {
			rps.inMemoryPlanCacheFallback.setPlanCacheForFF("", fallback)
		}

		// ---- the reload close path (graphMux.Shutdown) ----
		// Closing the ristretto cache fires OnEvict for every remaining entry, demoting
		// the plan (and its operation document) into the slowplancache fallback.
		planCache.Close()
		// Ensure the demoted Set has been applied before we close the fallback.
		fallback.Wait()
		// slowplancache.Close() only closes channels; it does NOT clear stored entries.
		fallback.Close()

		// Drop all local references. After this function returns, the ONLY thing that can
		// keep opDoc alive is the ReloadPersistentState -> slowplancache chain (when
		// rps != nil). When rps == nil, nothing retains it and it must be collected.
		//nolint:ineffassign,wastedassign
		planCache = nil
		//nolint:ineffassign,wastedassign
		plan = nil
		//nolint:ineffassign,wastedassign
		opDoc = nil
		_ = fallback // fallback is local; when rps == nil it becomes unreachable on return
		//nolint:ineffassign,wastedassign
		fallback = nil
	}()

	return fired
}

// awaitFinalizer forces GC repeatedly and waits up to timeout for the finalizer channel
// to be closed. Returns true if the finalizer fired (object collected) within the
// deadline. The generous bounded poll avoids CI flakiness.
func awaitFinalizer(fired <-chan struct{}, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		// Two GCs: the first may only queue the finalizer, the second ensures it runs.
		runtime.GC()
		runtime.GC()

		select {
		case <-fired:
			return true
		default:
		}

		if time.Now().After(deadline) {
			// One last chance after the final GC.
			select {
			case <-fired:
				return true
			default:
				return false
			}
		}

		time.Sleep(25 * time.Millisecond)
	}
}
