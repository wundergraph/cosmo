package cacheevents

import (
	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
)

// EventTypeString returns the canonical lowercase string for the EventType
// LowCardinality column. Unknown values produce an empty string so they are
// pruned from the rollup MV (ClickHouse treats them as a single bucket).
func EventTypeString(t cacheeventsv1.EventType) string {
	switch t {
	case cacheeventsv1.EventType_L1_READ:
		return "l1_read"
	case cacheeventsv1.EventType_L2_READ:
		return "l2_read"
	case cacheeventsv1.EventType_L1_WRITE:
		return "l1_write"
	case cacheeventsv1.EventType_L2_WRITE:
		return "l2_write"
	case cacheeventsv1.EventType_FETCH_TIMING:
		return "fetch_timing"
	case cacheeventsv1.EventType_SUBGRAPH_ERROR:
		return "subgraph_error"
	case cacheeventsv1.EventType_SHADOW_COMPARISON:
		return "shadow_comparison"
	case cacheeventsv1.EventType_MUTATION:
		return "mutation"
	case cacheeventsv1.EventType_HEADER_IMPACT:
		return "header_impact"
	case cacheeventsv1.EventType_CACHE_OP_ERROR:
		return "cache_op_error"
	case cacheeventsv1.EventType_FIELD_HASH:
		return "field_hash"
	case cacheeventsv1.EventType_ENTITY_TYPE_INFO:
		return "entity_type_info"
	default:
		return ""
	}
}

// CacheOpKindString returns the canonical lowercase name for the new CacheOpKind
// proto enum, matching the existing freeform cache_op string values.
func CacheOpKindString(k cacheeventsv1.CacheOpKind) string {
	switch k {
	case cacheeventsv1.CacheOpKind_GET:
		return "get"
	case cacheeventsv1.CacheOpKind_SET:
		return "set"
	case cacheeventsv1.CacheOpKind_SET_NEGATIVE:
		return "set_negative"
	case cacheeventsv1.CacheOpKind_DELETE:
		return "delete"
	default:
		return ""
	}
}

func VerdictString(v cacheeventsv1.Verdict) string {
	switch v {
	case cacheeventsv1.Verdict_HIT:
		return "hit"
	case cacheeventsv1.Verdict_MISS:
		return "miss"
	case cacheeventsv1.Verdict_PARTIAL_HIT:
		return "partial_hit"
	case cacheeventsv1.Verdict_FRESH:
		return "fresh"
	case cacheeventsv1.Verdict_STALE:
		return "stale"
	default:
		return ""
	}
}

func FieldSourceString(s cacheeventsv1.FieldSource) string {
	switch s {
	case cacheeventsv1.FieldSource_SUBGRAPH:
		return "subgraph"
	case cacheeventsv1.FieldSource_L1:
		return "l1"
	case cacheeventsv1.FieldSource_L2:
		return "l2"
	case cacheeventsv1.FieldSource_SHADOW_CACHED:
		return "shadow_cached"
	default:
		return ""
	}
}
