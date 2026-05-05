package cacheevents

import (
	"testing"

	"github.com/stretchr/testify/require"
	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
)

func TestEventTypeString(t *testing.T) {
	t.Parallel()

	cases := map[cacheeventsv1.EventType]string{
		cacheeventsv1.EventType_L1_READ:           "l1_read",
		cacheeventsv1.EventType_L2_READ:           "l2_read",
		cacheeventsv1.EventType_L1_WRITE:          "l1_write",
		cacheeventsv1.EventType_L2_WRITE:          "l2_write",
		cacheeventsv1.EventType_FETCH_TIMING:      "fetch_timing",
		cacheeventsv1.EventType_SUBGRAPH_ERROR:    "subgraph_error",
		cacheeventsv1.EventType_SHADOW_COMPARISON: "shadow_comparison",
		cacheeventsv1.EventType_MUTATION:          "mutation",
		cacheeventsv1.EventType_HEADER_IMPACT:     "header_impact",
		cacheeventsv1.EventType_CACHE_OP_ERROR:    "cache_op_error",
		cacheeventsv1.EventType_FIELD_HASH:        "field_hash",
		cacheeventsv1.EventType_ENTITY_TYPE_INFO:  "entity_type_info",
	}
	for code, want := range cases {
		require.Equalf(t, want, EventTypeString(code), "EventType=%s", code)
	}

	// UNSPECIFIED and any unknown integer value must produce "" so the
	// rollup MV groups them into a single bucket rather than churning the
	// LowCardinality dictionary.
	require.Empty(t, EventTypeString(cacheeventsv1.EventType_EVENT_TYPE_UNSPECIFIED))
	require.Empty(t, EventTypeString(cacheeventsv1.EventType(9999)))
}

func TestCacheOpKindString(t *testing.T) {
	t.Parallel()

	cases := map[cacheeventsv1.CacheOpKind]string{
		cacheeventsv1.CacheOpKind_GET:          "get",
		cacheeventsv1.CacheOpKind_SET:          "set",
		cacheeventsv1.CacheOpKind_SET_NEGATIVE: "set_negative",
		cacheeventsv1.CacheOpKind_DELETE:       "delete",
	}
	for code, want := range cases {
		require.Equalf(t, want, CacheOpKindString(code), "CacheOpKind=%s", code)
	}

	require.Empty(t, CacheOpKindString(cacheeventsv1.CacheOpKind_CACHE_OP_KIND_UNSPECIFIED))
	require.Empty(t, CacheOpKindString(cacheeventsv1.CacheOpKind(9999)))
}

func TestVerdictString(t *testing.T) {
	t.Parallel()

	cases := map[cacheeventsv1.Verdict]string{
		cacheeventsv1.Verdict_HIT:         "hit",
		cacheeventsv1.Verdict_MISS:        "miss",
		cacheeventsv1.Verdict_PARTIAL_HIT: "partial_hit",
		cacheeventsv1.Verdict_FRESH:       "fresh",
		cacheeventsv1.Verdict_STALE:       "stale",
	}
	for code, want := range cases {
		require.Equalf(t, want, VerdictString(code), "Verdict=%s", code)
	}

	require.Empty(t, VerdictString(cacheeventsv1.Verdict_VERDICT_UNSPECIFIED))
	require.Empty(t, VerdictString(cacheeventsv1.Verdict(9999)))
}

func TestFieldSourceString(t *testing.T) {
	t.Parallel()

	cases := map[cacheeventsv1.FieldSource]string{
		cacheeventsv1.FieldSource_SUBGRAPH:      "subgraph",
		cacheeventsv1.FieldSource_L1:            "l1",
		cacheeventsv1.FieldSource_L2:            "l2",
		cacheeventsv1.FieldSource_SHADOW_CACHED: "shadow_cached",
	}
	for code, want := range cases {
		require.Equalf(t, want, FieldSourceString(code), "FieldSource=%s", code)
	}

	require.Empty(t, FieldSourceString(cacheeventsv1.FieldSource_FIELD_SOURCE_UNSPECIFIED))
	require.Empty(t, FieldSourceString(cacheeventsv1.FieldSource(9999)))
}
