package cacheevents

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestBuildEvents_NilSnapshot(t *testing.T) {
	require.Nil(t, BuildEvents(nil, OperationMeta{}))
}

func TestBuildEvents_EmptySnapshot(t *testing.T) {
	require.Nil(t, BuildEvents(&resolve.CacheAnalyticsSnapshot{}, OperationMeta{}))
}

func TestBuildEvents_AllEventTypes(t *testing.T) {
	const piiKey = `{"id":"user-12345","email":"alice@example.com"}`
	snap := &resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{
			{CacheKey: piiKey, EntityType: "User", DataSource: "accounts", Kind: resolve.CacheKeyHit, ByteSize: 128},
		},
		L2Reads: []resolve.CacheKeyEvent{
			{CacheKey: piiKey, EntityType: "User", DataSource: "accounts", Kind: resolve.CacheKeyMiss},
		},
		L1Writes: []resolve.CacheWriteEvent{
			{CacheKey: piiKey, EntityType: "User", DataSource: "accounts", ByteSize: 128, TTL: 30 * time.Second, Source: resolve.CacheSourceQuery},
		},
		L2Writes: []resolve.CacheWriteEvent{
			{CacheKey: piiKey, EntityType: "User", DataSource: "accounts", ByteSize: 128, TTL: 60 * time.Second, Source: resolve.CacheSourceQuery},
		},
		FetchTimings: []resolve.FetchTimingEvent{
			{DataSource: "accounts", EntityType: "User", DurationMs: 12, Source: resolve.FieldSourceL2, ItemCount: 1, IsEntityFetch: true, HTTPStatusCode: 200, ResponseBytes: 128, TTFBMs: 1},
		},
		ErrorEvents: []resolve.SubgraphErrorEvent{
			{DataSource: "accounts", EntityType: "User", Message: "boom", Code: "INTERNAL_ERROR"},
		},
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{CacheKey: piiKey, EntityType: "User", DataSource: "accounts", IsFresh: false, CachedHash: 0xa, FreshHash: 0xb, CachedBytes: 100, FreshBytes: 110, CacheAgeMs: 5000, ConfiguredTTL: 60 * time.Second},
		},
		MutationEvents: []resolve.MutationEvent{
			{MutationRootField: "updateUser", EntityType: "User", EntityCacheKey: piiKey, HadCachedValue: true, IsStale: true, CachedHash: 0xa, FreshHash: 0xb, CachedBytes: 100, FreshBytes: 110, Source: resolve.CacheSourceMutation},
		},
		HeaderImpactEvents: []resolve.HeaderImpactEvent{
			{BaseKey: piiKey, HeaderHash: 0xa, ResponseHash: 0xb, EntityType: "User", DataSource: "accounts"},
		},
		CacheOpErrors: []resolve.CacheOperationError{
			{Operation: "get", CacheName: "redis", EntityType: "User", DataSource: "accounts", Message: "ECONNREFUSED", ItemCount: 1},
		},
		FieldHashes: []resolve.EntityFieldHash{
			// Safe: KeyHash is set (engine ran with HashAnalyticsKeys=true) — emit a FIELD_HASH event.
			{EntityType: "User", FieldName: "email", FieldHash: 0xfeed, KeyHash: 0xdead, Source: resolve.FieldSourceL2},
			// PII guard: KeyHash is zero (HashAnalyticsKeys=false on this entity) — must NOT emit.
			{EntityType: "User", FieldName: "phone", FieldHash: 0xbeef, KeyRaw: piiKey, Source: resolve.FieldSourceSubgraph},
		},
		EntityTypes: []resolve.EntityTypeInfo{
			{TypeName: "User", Count: 5, UniqueKeys: 3},
		},
	}

	meta := OperationMeta{
		OperationHash:       "abc123",
		OperationName:       "GetUser",
		OperationType:       "QUERY",
		RouterConfigVersion: "v1",
		ClientName:          "ios",
		ClientVersion:       "9.0.0",
		TraceID:             "00000000000000000000000000000001",
	}

	events := BuildEvents(snap, meta)
	// 10 base event types + 1 FIELD_HASH (the second has KeyHash=0 and is dropped) + 1 ENTITY_TYPE_INFO = 12.
	require.Len(t, events, 12)

	// Verify each event type was emitted exactly once.
	seen := map[cacheeventsv1.EventType]int{}
	for _, ev := range events {
		seen[ev.EventType]++
	}
	for _, et := range []cacheeventsv1.EventType{
		cacheeventsv1.EventType_L1_READ,
		cacheeventsv1.EventType_L2_READ,
		cacheeventsv1.EventType_L1_WRITE,
		cacheeventsv1.EventType_L2_WRITE,
		cacheeventsv1.EventType_FETCH_TIMING,
		cacheeventsv1.EventType_SUBGRAPH_ERROR,
		cacheeventsv1.EventType_SHADOW_COMPARISON,
		cacheeventsv1.EventType_MUTATION,
		cacheeventsv1.EventType_HEADER_IMPACT,
		cacheeventsv1.EventType_CACHE_OP_ERROR,
		cacheeventsv1.EventType_FIELD_HASH,
		cacheeventsv1.EventType_ENTITY_TYPE_INFO,
	} {
		require.Equalf(t, 1, seen[et], "missing event type %s", et)
	}

	// PII guard: the raw cache key must NEVER appear on any string-valued
	// proto field. The proto has no field for raw keys; only KeyHash and
	// BaseKeyHash carry identity. This test guards against accidental
	// reintroduction of a string-typed key field.
	for _, ev := range events {
		require.False(t, strings.Contains(ev.OperationHash, "user-12345"))
		require.False(t, strings.Contains(ev.OperationName, "user-12345"))
		require.False(t, strings.Contains(ev.EntityType, "user-12345"))
		require.False(t, strings.Contains(ev.SubgraphId, "user-12345"))
		require.False(t, strings.Contains(ev.WriteReason, "user-12345"))
		require.False(t, strings.Contains(ev.Source, "user-12345"))
		require.False(t, strings.Contains(ev.ErrorMessage, "user-12345"))
		require.False(t, strings.Contains(ev.ErrorCode, "user-12345"))
		require.False(t, strings.Contains(ev.MutationRootField, "user-12345"))
		require.False(t, strings.Contains(ev.CacheOp, "user-12345"))
		require.False(t, strings.Contains(ev.CacheName, "user-12345"))
		require.False(t, strings.Contains(ev.TraceId, "user-12345"))
	}

	// Verify KeyHash is non-zero where a key was supplied (read/write/shadow/mutation/field_hash),
	// and zero where there was none (fetch_timing, subgraph_error, cache_op_error, entity_type_info).
	for _, ev := range events {
		switch ev.EventType {
		case cacheeventsv1.EventType_L1_READ,
			cacheeventsv1.EventType_L2_READ,
			cacheeventsv1.EventType_L1_WRITE,
			cacheeventsv1.EventType_L2_WRITE,
			cacheeventsv1.EventType_SHADOW_COMPARISON,
			cacheeventsv1.EventType_MUTATION,
			cacheeventsv1.EventType_FIELD_HASH:
			require.NotZerof(t, ev.KeyHash, "KeyHash must be set for %s", ev.EventType)
		case cacheeventsv1.EventType_HEADER_IMPACT:
			require.NotZero(t, ev.BaseKeyHash, "BaseKeyHash must be set for HEADER_IMPACT")
		case cacheeventsv1.EventType_FETCH_TIMING,
			cacheeventsv1.EventType_SUBGRAPH_ERROR,
			cacheeventsv1.EventType_CACHE_OP_ERROR,
			cacheeventsv1.EventType_ENTITY_TYPE_INFO:
			require.Zerof(t, ev.KeyHash, "KeyHash must be zero for %s", ev.EventType)
		}
	}

	// FIELD_HASH must carry the engine-provided FieldName + FieldHash and the
	// dropped (KeyHash=0) entry must NOT have produced an event.
	for _, ev := range events {
		if ev.EventType != cacheeventsv1.EventType_FIELD_HASH {
			continue
		}
		require.Equal(t, "email", ev.FieldName)
		require.Equal(t, uint64(0xfeed), ev.FieldHash)
		require.Equal(t, uint64(0xdead), ev.KeyHash)
		// SubgraphId on FIELD_HASH is sourced from EntityFieldHash.DataSource on
		// the new engine; the pinned engine has no DataSource on that struct, so
		// the field is left empty until the engine bump lands.
		require.NotEqual(t, "phone", ev.FieldName, "FIELD_HASH event with KeyHash=0 must be dropped")
	}

	// ENTITY_TYPE_INFO must carry counts.
	for _, ev := range events {
		if ev.EventType != cacheeventsv1.EventType_ENTITY_TYPE_INFO {
			continue
		}
		require.Equal(t, "User", ev.EntityType)
		require.Equal(t, uint32(5), ev.EntityCount)
		require.Equal(t, uint32(3), ev.EntityUniqueKeys)
	}

	// CacheOpKind must be populated on CACHE_OP_ERROR (engine string "get" → GET enum).
	for _, ev := range events {
		if ev.EventType != cacheeventsv1.EventType_CACHE_OP_ERROR {
			continue
		}
		require.Equal(t, cacheeventsv1.CacheOpKind_GET, ev.CacheOpKind)
	}

	// Operation context should propagate to every event.
	for _, ev := range events {
		require.Equal(t, "abc123", ev.OperationHash)
		require.Equal(t, "GetUser", ev.OperationName)
		require.Equal(t, "query", ev.OperationType, "must be lowercased")
		require.Equal(t, "v1", ev.RouterConfigVersion)
		require.Equal(t, "ios", ev.ClientName)
		require.Equal(t, "9.0.0", ev.ClientVersion)
		require.Equal(t, "00000000000000000000000000000001", ev.TraceId)
	}
}

func TestHashKey(t *testing.T) {
	require.Zero(t, hashKey(""))
	require.NotZero(t, hashKey("non-empty"))
	require.Equal(t, hashKey("a"), hashKey("a"))
	require.NotEqual(t, hashKey("a"), hashKey("b"))
}
