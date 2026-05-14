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
			// DataSource ("accounts") and FieldPath (["address"]) must be propagated onto the proto event.
			{EntityType: "User", FieldName: "street", FieldPath: []string{"address"}, FieldHash: 0xfeed, KeyHash: 0xdead, Source: resolve.FieldSourceL2, DataSource: "accounts"},
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

	// FIELD_HASH must carry the engine-provided FieldName + FieldHash, the
	// resolving subgraph's name on SubgraphId (from EntityFieldHash.DataSource),
	// the schema-name FieldPath chain, and the dropped (KeyHash=0) entry
	// must NOT have produced an event.
	for _, ev := range events {
		if ev.EventType != cacheeventsv1.EventType_FIELD_HASH {
			continue
		}
		require.Equal(t, "street", ev.FieldName)
		require.Equal(t, uint64(0xfeed), ev.FieldHash)
		require.Equal(t, uint64(0xdead), ev.KeyHash)
		require.Equal(t, "accounts", ev.SubgraphId, "SubgraphId must propagate from EntityFieldHash.DataSource")
		require.Equal(t, []string{"address"}, ev.FieldPath, "FieldPath must propagate from EntityFieldHash.FieldPath")
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

func TestCacheOpKindFromString(t *testing.T) {
	t.Parallel()

	require.Equal(t, cacheeventsv1.CacheOpKind_GET, cacheOpKindFromString("get"))
	require.Equal(t, cacheeventsv1.CacheOpKind_SET, cacheOpKindFromString("set"))
	require.Equal(t, cacheeventsv1.CacheOpKind_SET_NEGATIVE, cacheOpKindFromString("set_negative"))
	require.Equal(t, cacheeventsv1.CacheOpKind_DELETE, cacheOpKindFromString("delete"))
	// Unknown values must fall through to UNSPECIFIED so the writer falls back
	// to the legacy freeform string column.
	require.Equal(t, cacheeventsv1.CacheOpKind_CACHE_OP_KIND_UNSPECIFIED, cacheOpKindFromString(""))
	require.Equal(t, cacheeventsv1.CacheOpKind_CACHE_OP_KIND_UNSPECIFIED, cacheOpKindFromString("unknown"))
	// Case sensitivity: the engine emits lower-case, anything else is unknown.
	require.Equal(t, cacheeventsv1.CacheOpKind_CACHE_OP_KIND_UNSPECIFIED, cacheOpKindFromString("GET"))
}

func TestVerdictFromKind(t *testing.T) {
	t.Parallel()

	require.Equal(t, cacheeventsv1.Verdict_HIT, verdictFromKind(resolve.CacheKeyHit))
	require.Equal(t, cacheeventsv1.Verdict_MISS, verdictFromKind(resolve.CacheKeyMiss))
	require.Equal(t, cacheeventsv1.Verdict_PARTIAL_HIT, verdictFromKind(resolve.CacheKeyPartialHit))
	// Zero-value Kind (no matching case) must collapse to UNSPECIFIED so the
	// rollup MV does not churn its LowCardinality dictionary on garbage input.
	require.Equal(t, cacheeventsv1.Verdict_VERDICT_UNSPECIFIED, verdictFromKind(resolve.CacheKeyEventKind(0)))
	require.Equal(t, cacheeventsv1.Verdict_VERDICT_UNSPECIFIED, verdictFromKind(resolve.CacheKeyEventKind(99)))
}

func TestFetchSourceFromGoTools(t *testing.T) {
	t.Parallel()

	require.Equal(t, cacheeventsv1.FieldSource_SUBGRAPH, fetchSourceFromGoTools(resolve.FieldSourceSubgraph))
	require.Equal(t, cacheeventsv1.FieldSource_L1, fetchSourceFromGoTools(resolve.FieldSourceL1))
	require.Equal(t, cacheeventsv1.FieldSource_L2, fetchSourceFromGoTools(resolve.FieldSourceL2))
	require.Equal(t, cacheeventsv1.FieldSource_SHADOW_CACHED, fetchSourceFromGoTools(resolve.FieldSourceShadowCached))
	require.Equal(t, cacheeventsv1.FieldSource_FIELD_SOURCE_UNSPECIFIED, fetchSourceFromGoTools(resolve.FieldSource(99)))
}

func TestBuildEvents_OperationTypeIsLowercased(t *testing.T) {
	t.Parallel()

	for _, in := range []string{"QUERY", "Mutation", "subscription", "MIXED case", ""} {
		snap := &resolve.CacheAnalyticsSnapshot{
			L1Reads: []resolve.CacheKeyEvent{{CacheKey: "k", EntityType: "T", Kind: resolve.CacheKeyHit}},
		}
		events := BuildEvents(snap, OperationMeta{OperationType: in})
		require.Len(t, events, 1)
		require.Equal(t, strings.ToLower(in), events[0].OperationType, "input %q", in)
	}
}

func TestBuildEvents_SharesOneTimestampPerSnapshot(t *testing.T) {
	t.Parallel()

	// All events from one snapshot must share a single timestamp — the
	// pinned engine does not yet stamp per-event timestamps, and we want
	// downstream consumers to see one consistent build-time value.
	snap := &resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{
			{CacheKey: "k1", EntityType: "User", Kind: resolve.CacheKeyHit},
			{CacheKey: "k2", EntityType: "User", Kind: resolve.CacheKeyMiss},
		},
		L2Writes: []resolve.CacheWriteEvent{
			{CacheKey: "k3", EntityType: "User", TTL: time.Second},
		},
	}
	events := BuildEvents(snap, OperationMeta{})
	require.Len(t, events, 3)
	ts := events[0].TimestampUnixNano
	require.NotZero(t, ts)
	for i, ev := range events {
		require.Equalf(t, ts, ev.TimestampUnixNano, "event[%d] must share the snapshot timestamp", i)
	}
}

func TestBuildEvents_FieldLevelMappings(t *testing.T) {
	t.Parallel()

	const cacheKey = "User:1"
	snap := &resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{
			{CacheKey: cacheKey, EntityType: "User", DataSource: "accounts", Kind: resolve.CacheKeyHit, ByteSize: 256, CacheAgeMs: 1500, Shadow: true},
		},
		L1Writes: []resolve.CacheWriteEvent{
			{CacheKey: cacheKey, EntityType: "User", DataSource: "accounts", ByteSize: 1024, TTL: 90 * time.Second, Source: resolve.CacheSourceMutation, WriteReason: "refresh"},
		},
		FetchTimings: []resolve.FetchTimingEvent{
			{DataSource: "accounts", EntityType: "User", DurationMs: 42, TTFBMs: 7, Source: resolve.FieldSourceSubgraph, ItemCount: 3, IsEntityFetch: true, HTTPStatusCode: 503, ResponseBytes: 9001},
		},
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{CacheKey: cacheKey, EntityType: "User", DataSource: "accounts", IsFresh: true, CachedHash: 0x11, FreshHash: 0x22, CachedBytes: 50, FreshBytes: 60, CacheAgeMs: 100, ConfiguredTTL: 30 * time.Second},
		},
		MutationEvents: []resolve.MutationEvent{
			{MutationRootField: "updateUser", EntityType: "User", EntityCacheKey: cacheKey, HadCachedValue: false, IsStale: false, Source: resolve.CacheSourceMutation},
		},
		HeaderImpactEvents: []resolve.HeaderImpactEvent{
			{BaseKey: cacheKey, HeaderHash: 0xaa, ResponseHash: 0xbb, EntityType: "User", DataSource: "accounts"},
		},
		CacheOpErrors: []resolve.CacheOperationError{
			{Operation: "delete", CacheName: "redis", EntityType: "User", DataSource: "accounts", Message: "ECONNREFUSED", ItemCount: 4},
		},
	}
	events := BuildEvents(snap, OperationMeta{})
	byType := map[cacheeventsv1.EventType]*cacheeventsv1.CacheEvent{}
	for _, ev := range events {
		byType[ev.EventType] = ev
	}

	read := byType[cacheeventsv1.EventType_L1_READ]
	require.NotNil(t, read)
	require.Equal(t, cacheeventsv1.Verdict_HIT, read.Verdict)
	require.Equal(t, uint32(256), read.ByteSize)
	require.Equal(t, uint32(1500), read.CacheAgeMs)
	require.True(t, read.IsShadow, "Shadow flag must propagate from CacheKeyEvent.Shadow")
	require.Equal(t, "accounts", read.SubgraphId, "DataSource must populate SubgraphId")

	write := byType[cacheeventsv1.EventType_L1_WRITE]
	require.NotNil(t, write)
	require.Equal(t, uint32(1024), write.ByteSize)
	require.Equal(t, uint32(90_000), write.TtlMs, "TTL must convert to milliseconds")
	require.Equal(t, "mutation", write.Source, "CacheOperationSource string passes through unchanged")
	require.Equal(t, "refresh", write.WriteReason)

	timing := byType[cacheeventsv1.EventType_FETCH_TIMING]
	require.NotNil(t, timing)
	require.InDelta(t, 42.0, timing.DurationMs, 0.0)
	require.InDelta(t, 7.0, timing.TtfbMs, 0.0)
	require.Equal(t, uint32(3), timing.ItemCount)
	require.True(t, timing.IsEntityFetch)
	require.Equal(t, uint32(503), timing.HttpStatusCode)
	require.Equal(t, uint32(9001), timing.ResponseBytes)
	require.Equal(t, cacheeventsv1.FieldSource_SUBGRAPH, timing.FetchSource)
	// FETCH_TIMING never carries a key — the proto has no CacheKey on this event.
	require.Zero(t, timing.KeyHash)

	shadow := byType[cacheeventsv1.EventType_SHADOW_COMPARISON]
	require.NotNil(t, shadow)
	require.Equal(t, cacheeventsv1.Verdict_FRESH, shadow.Verdict, "IsFresh=true must map to FRESH")
	require.True(t, shadow.ShadowIsFresh)
	require.Equal(t, uint64(0x11), shadow.CachedHash)
	require.Equal(t, uint64(0x22), shadow.FreshHash)
	require.Equal(t, uint32(30_000), shadow.ConfiguredTtlMs)
	require.True(t, shadow.IsShadow, "SHADOW_COMPARISON must always carry IsShadow=true")

	mutation := byType[cacheeventsv1.EventType_MUTATION]
	require.NotNil(t, mutation)
	require.Equal(t, "updateUser", mutation.MutationRootField)
	require.False(t, mutation.HadCachedValue)
	require.Empty(t, mutation.SubgraphId, "MutationEvent has no DataSource on the pinned engine")

	header := byType[cacheeventsv1.EventType_HEADER_IMPACT]
	require.NotNil(t, header)
	require.NotZero(t, header.BaseKeyHash, "BaseKey must be hashed onto BaseKeyHash")
	require.Equal(t, uint64(0xaa), header.HeaderHash)
	require.Equal(t, uint64(0xbb), header.ResponseHash)

	opErr := byType[cacheeventsv1.EventType_CACHE_OP_ERROR]
	require.NotNil(t, opErr)
	require.Equal(t, cacheeventsv1.CacheOpKind_DELETE, opErr.CacheOpKind)
	require.Equal(t, "redis", opErr.CacheName)
	require.Equal(t, "ECONNREFUSED", opErr.ErrorMessage)
	require.Equal(t, uint32(4), opErr.ItemCount)
}

func TestBuildEvents_VerdictMapsFromKind(t *testing.T) {
	t.Parallel()

	cases := map[resolve.CacheKeyEventKind]cacheeventsv1.Verdict{
		resolve.CacheKeyHit:        cacheeventsv1.Verdict_HIT,
		resolve.CacheKeyMiss:       cacheeventsv1.Verdict_MISS,
		resolve.CacheKeyPartialHit: cacheeventsv1.Verdict_PARTIAL_HIT,
	}
	for kind, want := range cases {
		snap := &resolve.CacheAnalyticsSnapshot{
			L2Reads: []resolve.CacheKeyEvent{{CacheKey: "k", EntityType: "T", Kind: kind}},
		}
		events := BuildEvents(snap, OperationMeta{})
		require.Len(t, events, 1)
		require.Equalf(t, want, events[0].Verdict, "kind=%v", kind)
	}
}

func TestBuildEvents_ShadowComparison_StaleVerdictWhenNotFresh(t *testing.T) {
	t.Parallel()

	snap := &resolve.CacheAnalyticsSnapshot{
		ShadowComparisons: []resolve.ShadowComparisonEvent{
			{CacheKey: "k", EntityType: "T", IsFresh: false},
		},
	}
	events := BuildEvents(snap, OperationMeta{})
	require.Len(t, events, 1)
	require.Equal(t, cacheeventsv1.Verdict_STALE, events[0].Verdict)
	require.False(t, events[0].ShadowIsFresh)
	require.True(t, events[0].IsShadow)
}

func TestBuildEvents_FieldHash_DropsWhenKeyHashIsZero(t *testing.T) {
	t.Parallel()

	snap := &resolve.CacheAnalyticsSnapshot{
		FieldHashes: []resolve.EntityFieldHash{
			{EntityType: "User", FieldName: "email", FieldHash: 0xfeed, KeyHash: 0xdead, Source: resolve.FieldSourceL2},
			// PII guard: when the engine did not hash the key, KeyRaw might
			// hold the raw entity-key JSON. The proto has no field for raw
			// keys, so we drop the event entirely rather than risk leakage.
			{EntityType: "User", FieldName: "phone", FieldHash: 0xbeef, KeyHash: 0, KeyRaw: `{"id":"1"}`, Source: resolve.FieldSourceSubgraph},
			{EntityType: "User", FieldName: "ssn", FieldHash: 0xcafe, KeyHash: 0, Source: resolve.FieldSourceSubgraph},
		},
	}
	events := BuildEvents(snap, OperationMeta{})
	require.Len(t, events, 1, "only the entry with non-zero KeyHash must produce a FIELD_HASH event")
	require.Equal(t, cacheeventsv1.EventType_FIELD_HASH, events[0].EventType)
	require.Equal(t, "email", events[0].FieldName)
	require.Equal(t, uint64(0xfeed), events[0].FieldHash)
	require.Equal(t, uint64(0xdead), events[0].KeyHash)
}

func TestBuildEvents_EntityTypeInfo_NoKeyOrSubgraph(t *testing.T) {
	t.Parallel()

	snap := &resolve.CacheAnalyticsSnapshot{
		EntityTypes: []resolve.EntityTypeInfo{
			{TypeName: "User", Count: 7, UniqueKeys: 4},
		},
	}
	events := BuildEvents(snap, OperationMeta{})
	require.Len(t, events, 1)
	ev := events[0]
	require.Equal(t, cacheeventsv1.EventType_ENTITY_TYPE_INFO, ev.EventType)
	require.Equal(t, "User", ev.EntityType)
	require.Equal(t, uint32(7), ev.EntityCount)
	require.Equal(t, uint32(4), ev.EntityUniqueKeys)
	require.Empty(t, ev.SubgraphId, "ENTITY_TYPE_INFO has no subgraph dimension")
	require.Zero(t, ev.KeyHash, "ENTITY_TYPE_INFO carries no key")
}
