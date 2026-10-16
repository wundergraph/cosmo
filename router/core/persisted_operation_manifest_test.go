package core

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
)

func newManifestProcessor(t *testing.T, opts persistedoperation.Options) (*OperationProcessor, *pqlmanifest.Store) {
	t.Helper()
	schema, report := astparser.ParseGraphqlDocumentString(`type Query { old: String new: String }`)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schema))
	store := pqlmanifest.NewStore(zap.NewNop())
	t.Cleanup(store.Close)
	opts.PQLStore = store
	client, err := persistedoperation.NewClient(&opts)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	cache, err := ristretto.NewCache(&ristretto.Config[uint64, NormalizationCacheEntry]{
		NumCounters:        100,
		MaxCost:            10,
		BufferItems:        64,
		IgnoreInternalCost: true,
	})
	require.NoError(t, err)
	t.Cleanup(cache.Close)
	return NewOperationProcessor(OperationProcessorOptions{
		Executor:                       &Executor{ClientSchema: &schema},
		PersistedOperationClient:       client,
		EnablePersistedOperationsCache: true,
		PersistedOpsNormalizationCache: cache,
	}), store
}

func TestPersistedOperationManifestSnapshot(t *testing.T) {
	t.Parallel()

	for _, reloadBeforeFetch := range []bool{true, false} {
		name := "reload before cache write"
		if reloadBeforeFetch {
			name = "reload before body lookup"
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			processor, store := newManifestProcessor(t, persistedoperation.Options{})
			load := func(revision, body string) {
				store.Load(&pqlmanifest.Manifest{
					Version:    1,
					Revision:   revision,
					Operations: map[string]string{"shared": body},
				})
			}
			newKit := func() *OperationKit {
				kit := NewIndependentOperationKit(processor)
				require.NoError(t, kit.UnmarshalOperationFromBody([]byte(`{
					"variables":{"old":true,"new":true},
					"extensions":{"persistedQuery":{"version":1,"sha256Hash":"shared"}}
				}`)))
				return kit
			}
			fetch := func(kit *OperationKit, wantHit bool) {
				hit, _, err := kit.FetchPersistedOperation(t.Context(), &ClientInfo{Name: "web"})
				require.NoError(t, err)
				require.Equal(t, wantHit, hit)
				if !hit {
					require.NoError(t, kit.Parse())
				}
			}
			normalize := func(kit *OperationKit) {
				_, err := kit.NormalizeOperation("web", false)
				require.NoError(t, err)
				processor.operationCache.persistedOperationNormalizationCache.Wait()
			}

			load("one", `query Get($old: Boolean!) { old @include(if: $old) }`)
			old := newKit()
			if !reloadBeforeFetch {
				fetch(old, false)
			}
			load("two", `query Get($new: Boolean!) { new @include(if: $new) }`)
			current := newKit()
			fetch(current, false)
			normalize(current)
			assert.Contains(t, current.parsedOperation.NormalizedRepresentation, "new")
			if reloadBeforeFetch {
				fetch(old, false)
			}
			normalize(old) // Finish the older request after the newer cache entry was written.
			assert.Contains(t, old.parsedOperation.NormalizedRepresentation, "old")

			current = newKit()
			fetch(current, false) // Old metadata must not be used for the new revision.
			normalize(current)
			assert.Contains(t, current.parsedOperation.NormalizedRepresentation, "new")
			cached := newKit()
			fetch(cached, true)
			assert.Contains(t, cached.parsedOperation.NormalizedRepresentation, "new")
			assert.Len(t, processor.operationCache.persistedOperationVariableNames, 1)

			store.Load(&pqlmanifest.Manifest{Version: 1, Revision: "three", Operations: map[string]string{}})
			_, _, err := newKit().FetchPersistedOperation(t.Context(), &ClientInfo{Name: "web"})
			var notFound *persistedoperation.PersistentOperationNotFoundError
			assert.ErrorAs(t, err, &notFound)
		})
	}
}

func TestManifestWarmupUsesCurrentSnapshot(t *testing.T) {
	t.Parallel()

	processor, store := newManifestProcessor(t, persistedoperation.Options{})
	store.Load(&pqlmanifest.Manifest{
		Version:    1,
		Revision:   "new",
		Operations: map[string]string{"shared": `query Current { new }`},
	})
	warmup := newManifestWarmup(processor)
	item := &nodev1.Operation{
		Request: &nodev1.OperationRequest{
			Query: `query Stale { old }`,
			Extensions: &nodev1.Extension{
				PersistedQuery: &nodev1.PersistedQuery{Version: 1, Sha256Hash: "shared"},
			},
		},
	}
	result, err := warmup.ProcessOperation(t.Context(), item)
	require.NoError(t, err)
	assert.Equal(t, "Current", result.OperationName)
	processor.operationCache.persistedOperationNormalizationCache.Wait()
	kit, err := processor.NewKit()
	require.NoError(t, err)
	defer kit.Free()
	require.NoError(t, kit.UnmarshalOperationFromBody([]byte(
		`{"extensions":{"persistedQuery":{"version":1,"sha256Hash":"shared"}}}`,
	)))
	hit, _, err := kit.FetchPersistedOperation(t.Context(), &ClientInfo{})
	require.NoError(t, err)
	assert.True(t, hit)
	assert.Contains(t, kit.parsedOperation.NormalizedRepresentation, "new")

	store.Load(&pqlmanifest.Manifest{Version: 1, Revision: "removed", Operations: map[string]string{}})
	_, err = warmup.ProcessOperation(t.Context(), item)
	var notFound *persistedoperation.PersistentOperationNotFoundError
	assert.ErrorAs(t, err, &notFound)
}

func TestManifestWarmupKeepsAPQOperationsOutsideManifest(t *testing.T) {
	t.Parallel()

	apqStore, err := apq.NewMemoryStore(1024, time.Minute)
	require.NoError(t, err)
	processor, store := newManifestProcessor(t, persistedoperation.Options{APQStore: apqStore})
	store.Load(&pqlmanifest.Manifest{
		Version:    1,
		Revision:   "rev-1",
		Operations: map[string]string{"published": `query Published { old }`},
	})
	warmup := newManifestWarmup(processor)

	// With APQ, the ID is the hash of the query, so the query cannot be stale
	// and warmup must not require the ID to be in the manifest.
	query := `query Current { new }`
	hash := sha256.Sum256([]byte(query))
	result, err := warmup.ProcessOperation(t.Context(), &nodev1.Operation{
		Request: &nodev1.OperationRequest{
			Query: query,
			Extensions: &nodev1.Extension{
				PersistedQuery: &nodev1.PersistedQuery{Version: 1, Sha256Hash: hex.EncodeToString(hash[:])},
			},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "Current", result.OperationName)
}

func newManifestWarmup(processor *OperationProcessor) *CacheWarmupPlanningProcessor {
	return NewCacheWarmupPlanningProcessor(&CacheWarmupPlanningProcessorOptions{
		OperationProcessor: processor,
		OperationPlanner:   NewOperationPlanner(&Executor{}, manifestWarmupPlanCache{}, nil, nil),
	})
}

// The warmup regression exercises parsing and normalization with an already cached plan.
type manifestWarmupPlanCache struct{}

func (manifestWarmupPlanCache) Get(uint64) (*planWithMetaData, bool) {
	return &planWithMetaData{}, true
}
func (manifestWarmupPlanCache) Set(uint64, *planWithMetaData, int64) bool { return true }
func (manifestWarmupPlanCache) IterValues(func(*planWithMetaData) bool)   {}
func (manifestWarmupPlanCache) Close()                                    {}
