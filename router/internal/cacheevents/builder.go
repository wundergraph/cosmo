package cacheevents

import (
	"strings"
	"time"

	"github.com/cespare/xxhash/v2"
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// OperationMeta is the per-request context carried onto every CacheEvent.
// It mirrors the operation/client/schema dimensions used by graphqlmetrics
// SchemaUsageInfo so cache events join cleanly with schema-usage data.
type OperationMeta struct {
	OperationHash       string
	OperationName       string
	OperationType       string
	RouterConfigVersion string
	ClientName          string
	ClientVersion       string
	TraceID             string
}

// BuildEvents converts a CacheAnalyticsSnapshot into a slice of wire-format
// CacheEvent records. Raw cache keys are hashed via xxhash before they leave
// this function — the wire protocol has no field for raw keys, so PII
// containment is enforced by the proto's shape.
func BuildEvents(snapshot *resolve.CacheAnalyticsSnapshot, meta OperationMeta) []*cacheeventsv1.CacheEvent {
	if snapshot == nil {
		return nil
	}
	total := len(snapshot.L1Reads) + len(snapshot.L2Reads) +
		len(snapshot.L1Writes) + len(snapshot.L2Writes) +
		len(snapshot.FetchTimings) + len(snapshot.ErrorEvents) +
		len(snapshot.ShadowComparisons) + len(snapshot.MutationEvents) +
		len(snapshot.HeaderImpactEvents) + len(snapshot.CacheOpErrors) +
		len(snapshot.FieldHashes) + len(snapshot.EntityTypes)
	if total == 0 {
		return nil
	}

	// All events in a single snapshot share the build-time timestamp. The
	// engine does not yet stamp per-event timestamps; once it does, swap to
	// the per-event field.
	now := uint64(time.Now().UnixNano())

	out := make([]*cacheeventsv1.CacheEvent, 0, total)

	for i := range snapshot.L1Reads {
		ev := &snapshot.L1Reads[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_L1_READ, ev.EntityType, ev.DataSource, ev.Shadow, &cacheeventsv1.CacheEvent{
			KeyHash:    hashKey(ev.CacheKey),
			Verdict:    verdictFromKind(ev.Kind),
			ByteSize:   uint32(ev.ByteSize),
			CacheAgeMs: uint32(ev.CacheAgeMs),
		}))
	}
	for i := range snapshot.L2Reads {
		ev := &snapshot.L2Reads[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_L2_READ, ev.EntityType, ev.DataSource, ev.Shadow, &cacheeventsv1.CacheEvent{
			KeyHash:    hashKey(ev.CacheKey),
			Verdict:    verdictFromKind(ev.Kind),
			ByteSize:   uint32(ev.ByteSize),
			CacheAgeMs: uint32(ev.CacheAgeMs),
		}))
	}
	for i := range snapshot.L1Writes {
		ev := &snapshot.L1Writes[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_L1_WRITE, ev.EntityType, ev.DataSource, ev.Shadow, &cacheeventsv1.CacheEvent{
			KeyHash:     hashKey(ev.CacheKey),
			ByteSize:    uint32(ev.ByteSize),
			TtlMs:       uint32(ev.TTL / time.Millisecond),
			WriteReason: string(ev.WriteReason),
			Source:      string(ev.Source),
		}))
	}
	for i := range snapshot.L2Writes {
		ev := &snapshot.L2Writes[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_L2_WRITE, ev.EntityType, ev.DataSource, ev.Shadow, &cacheeventsv1.CacheEvent{
			KeyHash:     hashKey(ev.CacheKey),
			ByteSize:    uint32(ev.ByteSize),
			TtlMs:       uint32(ev.TTL / time.Millisecond),
			WriteReason: string(ev.WriteReason),
			Source:      string(ev.Source),
		}))
	}
	for i := range snapshot.FetchTimings {
		ev := &snapshot.FetchTimings[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_FETCH_TIMING, ev.EntityType, ev.DataSource, false, &cacheeventsv1.CacheEvent{
			FetchSource:    fetchSourceFromGoTools(ev.Source),
			DurationMs:     float64(ev.DurationMs),
			TtfbMs:         float64(ev.TTFBMs),
			ItemCount:      uint32(ev.ItemCount),
			IsEntityFetch:  ev.IsEntityFetch,
			HttpStatusCode: uint32(ev.HTTPStatusCode),
			ResponseBytes:  uint32(ev.ResponseBytes),
		}))
	}
	for i := range snapshot.ErrorEvents {
		ev := &snapshot.ErrorEvents[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_SUBGRAPH_ERROR, ev.EntityType, ev.DataSource, false, &cacheeventsv1.CacheEvent{
			ErrorMessage: ev.Message,
			ErrorCode:    ev.Code,
		}))
	}
	for i := range snapshot.ShadowComparisons {
		ev := &snapshot.ShadowComparisons[i]
		verdict := cacheeventsv1.Verdict_STALE
		if ev.IsFresh {
			verdict = cacheeventsv1.Verdict_FRESH
		}
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_SHADOW_COMPARISON, ev.EntityType, ev.DataSource, true, &cacheeventsv1.CacheEvent{
			KeyHash:         hashKey(ev.CacheKey),
			Verdict:         verdict,
			ShadowIsFresh:   ev.IsFresh,
			CachedHash:      ev.CachedHash,
			FreshHash:       ev.FreshHash,
			CachedBytes:     uint32(ev.CachedBytes),
			FreshBytes:      uint32(ev.FreshBytes),
			CacheAgeMs:      uint32(ev.CacheAgeMs),
			ConfiguredTtlMs: uint32(ev.ConfiguredTTL / time.Millisecond),
		}))
	}
	for i := range snapshot.MutationEvents {
		ev := &snapshot.MutationEvents[i]
		// MutationEvent has no DataSource in the pinned engine — pass empty.
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_MUTATION, ev.EntityType, "", false, &cacheeventsv1.CacheEvent{
			KeyHash:           hashKey(ev.EntityCacheKey),
			MutationRootField: ev.MutationRootField,
			HadCachedValue:    ev.HadCachedValue,
			IsStale:           ev.IsStale,
			CachedHash:        ev.CachedHash,
			FreshHash:         ev.FreshHash,
			CachedBytes:       uint32(ev.CachedBytes),
			FreshBytes:        uint32(ev.FreshBytes),
			Source:            string(ev.Source),
		}))
	}
	for i := range snapshot.HeaderImpactEvents {
		ev := &snapshot.HeaderImpactEvents[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_HEADER_IMPACT, ev.EntityType, ev.DataSource, false, &cacheeventsv1.CacheEvent{
			BaseKeyHash:  hashKey(ev.BaseKey),
			HeaderHash:   ev.HeaderHash,
			ResponseHash: ev.ResponseHash,
		}))
	}
	for i := range snapshot.CacheOpErrors {
		ev := &snapshot.CacheOpErrors[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_CACHE_OP_ERROR, ev.EntityType, ev.DataSource, false, &cacheeventsv1.CacheEvent{
			CacheOpKind:  cacheOpKindFromString(ev.Operation),
			CacheName:    ev.CacheName,
			ErrorMessage: ev.Message,
			ItemCount:    uint32(ev.ItemCount),
		}))
	}
	for i := range snapshot.FieldHashes {
		ev := &snapshot.FieldHashes[i]
		// PII guard: only emit when the engine produced a hashed key. KeyRaw
		// (raw entity key JSON) is never sent on the wire — the proto has no
		// field for it, and we drop the event entirely if no KeyHash is set.
		if ev.KeyHash == 0 {
			continue
		}
		// EntityFieldHash has no DataSource or FieldPath in the pinned engine.
		// Once those fields land upstream, populate them here.
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_FIELD_HASH, ev.EntityType, "", false, &cacheeventsv1.CacheEvent{
			KeyHash:     ev.KeyHash,
			FieldName:   ev.FieldName,
			FieldHash:   ev.FieldHash,
			FetchSource: fetchSourceFromGoTools(ev.Source),
		}))
	}
	for i := range snapshot.EntityTypes {
		ev := &snapshot.EntityTypes[i]
		out = append(out, fillCommon(meta, now, cacheeventsv1.EventType_ENTITY_TYPE_INFO, ev.TypeName, "", false, &cacheeventsv1.CacheEvent{
			EntityCount:      uint32(ev.Count),
			EntityUniqueKeys: uint32(ev.UniqueKeys),
		}))
	}
	return out
}

// cacheOpKindFromString maps the engine's freeform Operation string onto the
// typed proto enum. Unknown values map to UNSPECIFIED (the writer will then
// fall back to the legacy string column).
func cacheOpKindFromString(op string) cacheeventsv1.CacheOpKind {
	switch op {
	case "get":
		return cacheeventsv1.CacheOpKind_GET
	case "set":
		return cacheeventsv1.CacheOpKind_SET
	case "set_negative":
		return cacheeventsv1.CacheOpKind_SET_NEGATIVE
	case "delete":
		return cacheeventsv1.CacheOpKind_DELETE
	default:
		return cacheeventsv1.CacheOpKind_CACHE_OP_KIND_UNSPECIFIED
	}
}

// fillCommon populates the dimensions every event shares: timestamp, type,
// entity/subgraph identity, the operation/client/schema context.
func fillCommon(meta OperationMeta, ts uint64, t cacheeventsv1.EventType, entityType, subgraph string, isShadow bool, ev *cacheeventsv1.CacheEvent) *cacheeventsv1.CacheEvent {
	ev.TimestampUnixNano = ts
	ev.EventType = t
	ev.OperationHash = meta.OperationHash
	ev.OperationName = meta.OperationName
	ev.OperationType = strings.ToLower(meta.OperationType)
	ev.RouterConfigVersion = meta.RouterConfigVersion
	ev.ClientName = meta.ClientName
	ev.ClientVersion = meta.ClientVersion
	ev.TraceId = meta.TraceID
	ev.IsShadow = isShadow
	ev.EntityType = entityType
	ev.SubgraphId = subgraph
	return ev
}

// hashKey xxhashes a raw cache-key string. Returns 0 for empty input.
// This is the PII-redaction boundary: callers must not put the raw string
// onto a CacheEvent — only the hash.
func hashKey(s string) uint64 {
	if s == "" {
		return 0
	}
	return xxhash.Sum64String(s)
}

func verdictFromKind(k resolve.CacheKeyEventKind) cacheeventsv1.Verdict {
	switch k {
	case resolve.CacheKeyHit:
		return cacheeventsv1.Verdict_HIT
	case resolve.CacheKeyMiss:
		return cacheeventsv1.Verdict_MISS
	case resolve.CacheKeyPartialHit:
		return cacheeventsv1.Verdict_PARTIAL_HIT
	default:
		return cacheeventsv1.Verdict_VERDICT_UNSPECIFIED
	}
}

func fetchSourceFromGoTools(s resolve.FieldSource) cacheeventsv1.FieldSource {
	switch s {
	case resolve.FieldSourceSubgraph:
		return cacheeventsv1.FieldSource_SUBGRAPH
	case resolve.FieldSourceL1:
		return cacheeventsv1.FieldSource_L1
	case resolve.FieldSourceL2:
		return cacheeventsv1.FieldSource_L2
	case resolve.FieldSourceShadowCached:
		return cacheeventsv1.FieldSource_SHADOW_CACHED
	default:
		return cacheeventsv1.FieldSource_FIELD_SOURCE_UNSPECIFIED
	}
}
