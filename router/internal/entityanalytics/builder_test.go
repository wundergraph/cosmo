package entityanalytics

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
)

var testMeta = OperationMeta{
	Hash:          "abc123",
	Name:          "GetUser",
	Type:          entityanalyticsv1.OperationType_QUERY,
	ClientName:    "web-app",
	ClientVersion: "1.0.0",
	SchemaVersion: "v1",
}

func TestBuildEntityAnalyticsInfo_EmptySnapshot(t *testing.T) {
	t.Parallel()
	snapshot := resolve.CacheAnalyticsSnapshot{}
	info := BuildEntityAnalyticsInfo(snapshot, testMeta, DetailLevelFull)

	require.NotNil(t, info)
	assert.Equal(t, "abc123", info.Operation.Hash)
	assert.Equal(t, "GetUser", info.Operation.Name)
	assert.Equal(t, entityanalyticsv1.OperationType_QUERY, info.Operation.Type)
	assert.Equal(t, "web-app", info.Client.Name)
	assert.Equal(t, "1.0.0", info.Client.Version)
	assert.Equal(t, "v1", info.Schema.Version)
	assert.Empty(t, info.EntityTypes)
	require.NotNil(t, info.Summary)
	assert.Equal(t, uint32(0), info.Summary.TotalCacheHits)
}

func TestBuildEntityAnalyticsInfo_BasicLevel_CacheStats(t *testing.T) {
	t.Parallel()
	snapshot := resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{
			{EntityType: "User", DataSource: "accounts", Kind: resolve.CacheKeyHit, ByteSize: 100},
			{EntityType: "User", DataSource: "accounts", Kind: resolve.CacheKeyMiss},
		},
		L2Reads: []resolve.CacheKeyEvent{
			{EntityType: "Product", DataSource: "catalog", Kind: resolve.CacheKeyHit, ByteSize: 200, CacheAgeMs: 5000},
			{EntityType: "Product", DataSource: "catalog", Kind: resolve.CacheKeyMiss},
		},
		L2Writes: []resolve.CacheWriteEvent{
			{EntityType: "Product", DataSource: "catalog", ByteSize: 200, TTL: 60 * time.Second},
		},
		// Standard/Full events should be ignored at basic level
		FieldHashes: []resolve.EntityFieldHash{
			{EntityType: "User", FieldName: "email", FieldHash: 12345},
		},
		MutationEvents: []resolve.MutationEvent{
			{EntityType: "User", MutationRootField: "updateUser", HadCachedValue: true},
		},
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{EntityType: "User", DataSource: "accounts", IsFresh: true},
		},
	}

	info := BuildEntityAnalyticsInfo(snapshot, testMeta, DetailLevelBasic)

	// Should have User and Product entity types
	require.Len(t, info.EntityTypes, 2)

	entityMap := make(map[string]*entityanalyticsv1.EntityTypeAnalytics)
	for _, et := range info.EntityTypes {
		entityMap[et.EntityType+"/"+et.SubgraphId] = et
	}

	// User cache stats
	user := entityMap["User/accounts"]
	require.NotNil(t, user)
	require.NotNil(t, user.Cache)
	assert.Equal(t, uint32(1), user.Cache.L1Hits)
	assert.Equal(t, uint32(1), user.Cache.L1Misses)
	assert.Equal(t, uint64(100), user.Cache.CachedBytesServed)

	// Product cache stats
	product := entityMap["Product/catalog"]
	require.NotNil(t, product)
	require.NotNil(t, product.Cache)
	assert.Equal(t, uint32(1), product.Cache.L2Hits)
	assert.Equal(t, uint32(1), product.Cache.L2Misses)
	assert.Equal(t, uint32(1), product.Cache.L2Writes)
	assert.Equal(t, uint32(1), product.Cache.Populations)
	assert.Equal(t, uint64(200), product.Cache.CachedBytesServed)

	// Standard/Full fields should be nil at basic level
	assert.Nil(t, user.Behavior)
	assert.Nil(t, user.MutationImpact)
	assert.Nil(t, user.Shadow)
}

func TestBuildEntityAnalyticsInfo_StandardLevel_FieldHashes(t *testing.T) {
	t.Parallel()
	snapshot := resolve.CacheAnalyticsSnapshot{
		FieldHashes: []resolve.EntityFieldHash{
			{EntityType: "User", FieldName: "email", FieldHash: 111, Source: resolve.FieldSourceSubgraph},
			{EntityType: "User", FieldName: "name", FieldHash: 222, Source: resolve.FieldSourceL2},
		},
		EntityTypes: []resolve.EntityTypeInfo{
			{TypeName: "User", Count: 5, UniqueKeys: 3},
		},
		MutationEvents: []resolve.MutationEvent{
			{EntityType: "User", MutationRootField: "updateUser", HadCachedValue: true, IsStale: true, CachedHash: 100, FreshHash: 200},
		},
		// Full-level events should be ignored at standard level
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{EntityType: "User", DataSource: "accounts", IsFresh: false, CacheAgeMs: 5000},
		},
		ErrorEvents: []resolve.SubgraphErrorEvent{
			{DataSource: "accounts", EntityType: "User", Message: "timeout"},
		},
	}

	info := BuildEntityAnalyticsInfo(snapshot, testMeta, DetailLevelStandard)

	require.Len(t, info.EntityTypes, 1)
	user := info.EntityTypes[0]
	assert.Equal(t, "User", user.EntityType)

	// Behavior (standard level)
	require.NotNil(t, user.Behavior)
	assert.Equal(t, uint32(5), user.Behavior.InstanceCount)
	assert.Equal(t, uint32(3), user.Behavior.UniqueKeys)
	require.Len(t, user.Behavior.FieldSnapshots, 2)
	assert.Equal(t, "email", user.Behavior.FieldSnapshots[0].FieldName)
	assert.Equal(t, uint64(111), user.Behavior.FieldSnapshots[0].FieldHash)
	assert.Equal(t, entityanalyticsv1.FieldSource_SUBGRAPH, user.Behavior.FieldSnapshots[0].Source)
	assert.Equal(t, entityanalyticsv1.FieldSource_L2_CACHE, user.Behavior.FieldSnapshots[1].Source)

	// MutationImpact (standard level)
	require.NotNil(t, user.MutationImpact)
	assert.Equal(t, "updateUser", user.MutationImpact.MutationField)
	assert.True(t, user.MutationImpact.HadCachedValue)
	assert.True(t, user.MutationImpact.EntityChanged)
	assert.Equal(t, uint64(100), user.MutationImpact.CachedHash)
	assert.Equal(t, uint64(200), user.MutationImpact.FreshHash)

	// Full-level fields should be nil at standard level
	assert.Nil(t, user.Shadow)
	assert.Empty(t, user.Errors)
}

func TestBuildEntityAnalyticsInfo_FullLevel(t *testing.T) {
	t.Parallel()
	snapshot := resolve.CacheAnalyticsSnapshot{
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{EntityType: "Product", DataSource: "catalog", IsFresh: true, ConfiguredTTL: 5 * time.Minute},
			{EntityType: "Product", DataSource: "catalog", IsFresh: false, CacheAgeMs: 120000, ConfiguredTTL: 5 * time.Minute},
		},
		HeaderImpactEvents: []resolve.HeaderImpactEvent{
			{EntityType: "Product", DataSource: "catalog", BaseKey: "k1", HeaderHash: 1},
			{EntityType: "Product", DataSource: "catalog", BaseKey: "k1", HeaderHash: 2},
		},
		ErrorEvents: []resolve.SubgraphErrorEvent{
			{DataSource: "catalog", EntityType: "Product", Message: "timeout", Code: "GATEWAY_TIMEOUT"},
		},
	}

	info := BuildEntityAnalyticsInfo(snapshot, testMeta, DetailLevelFull)

	require.Len(t, info.EntityTypes, 1)
	product := info.EntityTypes[0]

	// Shadow analysis
	require.NotNil(t, product.Shadow)
	assert.Equal(t, uint32(2), product.Shadow.Comparisons)
	assert.Equal(t, uint32(1), product.Shadow.FreshCount)
	assert.Equal(t, uint32(1), product.Shadow.StaleCount)
	assert.Equal(t, float64(120000), product.Shadow.AvgCacheAgeAtStaleMs)
	assert.Equal(t, float64(300000), product.Shadow.ConfiguredTtlMs)

	// Header impact
	require.NotNil(t, product.HeaderImpact)
	assert.Equal(t, uint32(2), product.HeaderImpact.DistinctHeaderVariants)

	// Errors
	require.Len(t, product.Errors, 1)
	assert.Equal(t, "timeout", product.Errors[0].Message)
	assert.Equal(t, "GATEWAY_TIMEOUT", product.Errors[0].Code)

	// Summary should reflect errors
	assert.True(t, info.Summary.HadErrors)
}

func TestBuildEntityAnalyticsInfo_FetchPerformance_LatencySaved(t *testing.T) {
	t.Parallel()
	snapshot := resolve.CacheAnalyticsSnapshot{
		FetchTimings: []resolve.FetchTimingEvent{
			{DataSource: "catalog", EntityType: "Product", DurationMs: 50, Source: resolve.FieldSourceSubgraph, ItemCount: 1, HTTPStatusCode: 200, ResponseBytes: 1024, TTFBMs: 10},
			{DataSource: "catalog", EntityType: "Product", DurationMs: 3, Source: resolve.FieldSourceL2, ItemCount: 2},
		},
	}

	info := BuildEntityAnalyticsInfo(snapshot, testMeta, DetailLevelBasic)

	require.Len(t, info.EntityTypes, 1)
	product := info.EntityTypes[0]
	require.NotNil(t, product.Fetch)
	assert.Equal(t, float64(50), product.Fetch.SubgraphLatencyMs)
	assert.Equal(t, float64(3), product.Fetch.L2LatencyMs)
	assert.Equal(t, uint32(1), product.Fetch.SubgraphItemCount)
	assert.Equal(t, uint32(2), product.Fetch.CachedItemCount)
	assert.Equal(t, int32(200), product.Fetch.HttpStatusCode)
	assert.Equal(t, uint64(1024), product.Fetch.ResponseBytes)
	assert.Equal(t, float64(10), product.Fetch.TtfbMs)

	// LatencySaved = (50/1 - 3/2) * 2 = (50 - 1.5) * 2 = 97
	assert.Equal(t, float64(97), product.Fetch.LatencySavedMs)

	// Summary
	assert.Equal(t, uint32(3), info.Summary.TotalEntitiesResolved)
	assert.Equal(t, uint32(2), info.Summary.SubgraphFetchesAvoided)
}

func TestBuildEntityAnalyticsInfo_GroupsByEntityTypeAndDataSource(t *testing.T) {
	t.Parallel()
	snapshot := resolve.CacheAnalyticsSnapshot{
		L2Reads: []resolve.CacheKeyEvent{
			{EntityType: "User", DataSource: "accounts", Kind: resolve.CacheKeyHit, ByteSize: 100},
			{EntityType: "User", DataSource: "reviews", Kind: resolve.CacheKeyMiss},
			{EntityType: "Product", DataSource: "catalog", Kind: resolve.CacheKeyHit, ByteSize: 200},
		},
	}

	info := BuildEntityAnalyticsInfo(snapshot, testMeta, DetailLevelBasic)

	assert.Len(t, info.EntityTypes, 3)

	// Summary should aggregate
	assert.Equal(t, uint32(2), info.Summary.TotalCacheHits)
	assert.Equal(t, uint32(1), info.Summary.TotalCacheMisses)
}

func TestBuildEntityAnalyticsInfo_RequestSummary(t *testing.T) {
	t.Parallel()
	snapshot := resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{
			{EntityType: "User", DataSource: "accounts", Kind: resolve.CacheKeyHit, ByteSize: 50},
		},
		L2Reads: []resolve.CacheKeyEvent{
			{EntityType: "Product", DataSource: "catalog", Kind: resolve.CacheKeyHit, ByteSize: 200},
			{EntityType: "Product", DataSource: "catalog", Kind: resolve.CacheKeyMiss},
		},
		FetchTimings: []resolve.FetchTimingEvent{
			{DataSource: "catalog", EntityType: "Product", DurationMs: 100, Source: resolve.FieldSourceSubgraph, ItemCount: 1, ResponseBytes: 512},
		},
	}

	info := BuildEntityAnalyticsInfo(snapshot, testMeta, DetailLevelBasic)

	require.NotNil(t, info.Summary)
	assert.Equal(t, uint32(2), info.Summary.TotalCacheHits)  // 1 L1 + 1 L2
	assert.Equal(t, uint32(1), info.Summary.TotalCacheMisses) // 1 L2 miss
	assert.Equal(t, uint64(250), info.Summary.TotalCachedBytes)
	assert.Equal(t, uint64(512), info.Summary.TotalFetchedBytes)
	assert.Equal(t, float64(100), info.Summary.TotalSubgraphLatencyMs)
	assert.False(t, info.Summary.HadErrors)
}

func TestParseDetailLevel(t *testing.T) {
	t.Parallel()
	assert.Equal(t, DetailLevelBasic, ParseDetailLevel("basic"))
	assert.Equal(t, DetailLevelStandard, ParseDetailLevel("standard"))
	assert.Equal(t, DetailLevelStandard, ParseDetailLevel(""))
	assert.Equal(t, DetailLevelStandard, ParseDetailLevel("invalid"))
	assert.Equal(t, DetailLevelFull, ParseDetailLevel("full"))
}
