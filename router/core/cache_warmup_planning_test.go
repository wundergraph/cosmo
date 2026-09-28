package core

import (
	"crypto/sha256"
	"fmt"
	"testing"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
)

func TestCacheWarmupPlanningProcessorPersistedCacheHit(t *testing.T) {
	schema, report := astparser.ParseGraphqlDocumentString(`type Query { hello: String }`)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schema))

	const query = `query GetHello { hello }`
	id := fmt.Sprintf("%x", sha256.Sum256([]byte(query)))
	store := pqlmanifest.NewStore(zap.NewNop())
	t.Cleanup(store.Close)
	store.Load(&pqlmanifest.Manifest{
		Version:    1,
		Revision:   "one",
		Operations: map[string]string{id: query},
	})
	client, err := persistedoperation.NewClient(&persistedoperation.Options{PQLStore: store})
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
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                       &Executor{ClientSchema: &schema},
		PersistedOperationClient:       client,
		EnablePersistedOperationsCache: true,
		PersistedOpsNormalizationCache: cache,
	})

	// Populate the normalization cache as a live persisted-operation request would.
	kit, err := processor.NewIndependentKit()
	require.NoError(t, err)
	require.NoError(t, kit.UnmarshalOperationFromBody([]byte(fmt.Sprintf(
		`{"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`, id,
	))))
	skipParse, _, err := kit.FetchPersistedOperation(t.Context(), &ClientInfo{})
	require.NoError(t, err)
	require.False(t, skipParse)
	require.NoError(t, kit.Parse())
	_, err = kit.NormalizeOperation("", false)
	require.NoError(t, err)
	cache.Wait()

	warmup := NewCacheWarmupPlanningProcessor(&CacheWarmupPlanningProcessorOptions{
		OperationProcessor: processor,
		OperationPlanner:   NewOperationPlanner(&Executor{}, warmupCachedPlan{}, nil, nil),
	})
	result, err := warmup.ProcessOperation(t.Context(), &nodev1.Operation{
		Request: &nodev1.OperationRequest{
			Extensions: &nodev1.Extension{
				PersistedQuery: &nodev1.PersistedQuery{Version: 1, Sha256Hash: id},
			},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "GetHello", result.OperationName)
	require.True(t, result.PlanCacheHit)
}

// Keep planning out of this regression: the cached document must still pass validation.
type warmupCachedPlan struct{}

func (warmupCachedPlan) Get(uint64) (*planWithMetaData, bool)      { return &planWithMetaData{}, true }
func (warmupCachedPlan) Set(uint64, *planWithMetaData, int64) bool { return true }
func (warmupCachedPlan) IterValues(func(*planWithMetaData) bool)   {}
func (warmupCachedPlan) Close()                                    {}
