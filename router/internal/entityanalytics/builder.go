package entityanalytics

import (
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	entityanalyticsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/entityanalytics/v1"
)

// DetailLevel controls which snapshot events are processed.
type DetailLevel int

const (
	// DetailLevelBasic processes CacheKeyEvents, CacheWriteEvents, and FetchTimingEvents.
	DetailLevelBasic DetailLevel = iota
	// DetailLevelStandard adds EntityFieldHash, EntityTypeInfo, and MutationEvent processing.
	DetailLevelStandard
	// DetailLevelFull adds ShadowComparisonEvent, HeaderImpactEvent, and SubgraphErrorEvent processing.
	DetailLevelFull
)

// ParseDetailLevel converts a string to a DetailLevel.
func ParseDetailLevel(s string) DetailLevel {
	switch s {
	case "basic":
		return DetailLevelBasic
	case "full":
		return DetailLevelFull
	default:
		return DetailLevelStandard
	}
}

// OperationMeta holds the operation context needed to build an EntityAnalyticsInfo record.
type OperationMeta struct {
	Hash          string
	Name          string
	Type          entityanalyticsv1.OperationType
	ClientName    string
	ClientVersion string
	SchemaVersion string
}

type entityTypeKey struct {
	entityType string
	dataSource string
}

// BuildEntityAnalyticsInfo transforms a CacheAnalyticsSnapshot into an EntityAnalyticsInfo protobuf record.
// It groups all events by (entityType, dataSource) and populates fields based on the detail level.
func BuildEntityAnalyticsInfo(
	snapshot resolve.CacheAnalyticsSnapshot,
	meta OperationMeta,
	detailLevel DetailLevel,
) *entityanalyticsv1.EntityAnalyticsInfo {
	groups := make(map[entityTypeKey]*entityanalyticsv1.EntityTypeAnalytics)

	getOrCreate := func(key entityTypeKey) *entityanalyticsv1.EntityTypeAnalytics {
		if eta, ok := groups[key]; ok {
			return eta
		}
		eta := &entityanalyticsv1.EntityTypeAnalytics{
			EntityType:  key.entityType,
			SubgraphId:  key.dataSource,
		}
		groups[key] = eta
		return eta
	}

	ensureCache := func(eta *entityanalyticsv1.EntityTypeAnalytics) *entityanalyticsv1.CacheStats {
		if eta.Cache == nil {
			eta.Cache = &entityanalyticsv1.CacheStats{}
		}
		return eta.Cache
	}

	ensureFetch := func(eta *entityanalyticsv1.EntityTypeAnalytics) *entityanalyticsv1.FetchPerformance {
		if eta.Fetch == nil {
			eta.Fetch = &entityanalyticsv1.FetchPerformance{}
		}
		return eta.Fetch
	}

	// --- Basic level: cache reads, writes, fetch timings ---

	// L1 reads
	for _, event := range snapshot.L1Reads {
		key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
		cache := ensureCache(getOrCreate(key))
		switch event.Kind {
		case resolve.CacheKeyHit:
			cache.L1Hits++
			cache.CachedBytesServed += uint64(event.ByteSize)
		case resolve.CacheKeyMiss, resolve.CacheKeyPartialHit:
			cache.L1Misses++
		}
	}

	// L2 reads
	var l2HitAgeSum int64
	var l2HitAgeCount int64
	for _, event := range snapshot.L2Reads {
		key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
		cache := ensureCache(getOrCreate(key))
		switch event.Kind {
		case resolve.CacheKeyHit:
			cache.L2Hits++
			cache.CachedBytesServed += uint64(event.ByteSize)
			if event.CacheAgeMs > 0 {
				l2HitAgeSum += event.CacheAgeMs
				l2HitAgeCount++
			}
		case resolve.CacheKeyMiss, resolve.CacheKeyPartialHit:
			cache.L2Misses++
		}
	}

	// L1 writes
	for _, event := range snapshot.L1Writes {
		key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
		cache := ensureCache(getOrCreate(key))
		cache.Populations++
	}

	// L2 writes
	for _, event := range snapshot.L2Writes {
		key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
		cache := ensureCache(getOrCreate(key))
		cache.L2Writes++
		cache.Populations++
	}

	// Fetch timings
	for _, event := range snapshot.FetchTimings {
		key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
		fetch := ensureFetch(getOrCreate(key))
		switch event.Source {
		case resolve.FieldSourceSubgraph:
			fetch.SubgraphLatencyMs += float64(event.DurationMs)
			fetch.SubgraphItemCount += uint32(event.ItemCount)
			if event.HTTPStatusCode > 0 {
				fetch.HttpStatusCode = int32(event.HTTPStatusCode)
			}
			fetch.ResponseBytes += uint64(event.ResponseBytes)
			if event.TTFBMs > 0 {
				fetch.TtfbMs = float64(event.TTFBMs)
			}
		case resolve.FieldSourceL2:
			fetch.L2LatencyMs += float64(event.DurationMs)
			fetch.CachedItemCount += uint32(event.ItemCount)
		}
	}

	// --- Standard level: field hashes, entity type info, mutation events ---

	if detailLevel >= DetailLevelStandard {
		for _, event := range snapshot.FieldHashes {
			key := entityTypeKey{entityType: event.EntityType}
			eta := getOrCreate(key)
			if eta.Behavior == nil {
				eta.Behavior = &entityanalyticsv1.EntityBehavior{}
			}
			eta.Behavior.FieldSnapshots = append(eta.Behavior.FieldSnapshots, &entityanalyticsv1.FieldSnapshot{
				FieldName: event.FieldName,
				FieldHash: event.FieldHash,
				Source:    toProtoFieldSource(event.Source),
			})
		}

		for _, event := range snapshot.EntityTypes {
			key := entityTypeKey{entityType: event.TypeName}
			eta := getOrCreate(key)
			if eta.Behavior == nil {
				eta.Behavior = &entityanalyticsv1.EntityBehavior{}
			}
			eta.Behavior.InstanceCount = uint32(event.Count)
			eta.Behavior.UniqueKeys = uint32(event.UniqueKeys)
		}

		for _, event := range snapshot.MutationEvents {
			key := entityTypeKey{entityType: event.EntityType}
			eta := getOrCreate(key)
			eta.MutationImpact = &entityanalyticsv1.MutationImpact{
				MutationField:  event.MutationRootField,
				HadCachedValue: event.HadCachedValue,
				EntityChanged:  event.IsStale,
				CachedHash:     event.CachedHash,
				FreshHash:      event.FreshHash,
			}
		}
	}

	// --- Full level: shadow comparisons, header impact, errors ---

	if detailLevel >= DetailLevelFull {
		for _, event := range snapshot.ShadowComparisons {
			key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
			eta := getOrCreate(key)
			if eta.Shadow == nil {
				eta.Shadow = &entityanalyticsv1.ShadowAnalysis{}
			}
			eta.Shadow.Comparisons++
			if event.IsFresh {
				eta.Shadow.FreshCount++
			} else {
				eta.Shadow.StaleCount++
				if event.CacheAgeMs > 0 {
					// Running sum; we compute average below
					eta.Shadow.AvgCacheAgeAtStaleMs += float64(event.CacheAgeMs)
				}
			}
			eta.Shadow.ConfiguredTtlMs = float64(event.ConfiguredTTL.Milliseconds())
		}

		// Finalize shadow averages
		for _, eta := range groups {
			if eta.Shadow != nil && eta.Shadow.StaleCount > 0 && eta.Shadow.AvgCacheAgeAtStaleMs > 0 {
				eta.Shadow.AvgCacheAgeAtStaleMs /= float64(eta.Shadow.StaleCount)
			}
		}

		for _, event := range snapshot.HeaderImpactEvents {
			key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
			eta := getOrCreate(key)
			if eta.HeaderImpact == nil {
				eta.HeaderImpact = &entityanalyticsv1.HeaderImpact{}
			}
			eta.HeaderImpact.DistinctHeaderVariants++
		}

		for _, event := range snapshot.ErrorEvents {
			key := entityTypeKey{entityType: event.EntityType, dataSource: event.DataSource}
			eta := getOrCreate(key)
			eta.Errors = append(eta.Errors, &entityanalyticsv1.SubgraphError{
				Message: event.Message,
				Code:    event.Code,
			})
		}
	}

	// Compute latency saved and error counts per entity type
	for _, eta := range groups {
		if eta.Fetch != nil && eta.Fetch.CachedItemCount > 0 && eta.Fetch.SubgraphItemCount > 0 {
			avgSubgraphLatency := eta.Fetch.SubgraphLatencyMs / float64(eta.Fetch.SubgraphItemCount)
			avgL2Latency := eta.Fetch.L2LatencyMs / float64(eta.Fetch.CachedItemCount)
			eta.Fetch.LatencySavedMs = (avgSubgraphLatency - avgL2Latency) * float64(eta.Fetch.CachedItemCount)
		}
		if detailLevel >= DetailLevelFull {
			eta.Fetch = ensureFetch(eta)
			eta.Fetch.SubgraphErrors = uint32(len(eta.Errors))
		}
	}

	// Set average cache age
	if l2HitAgeCount > 0 {
		avgAge := float64(l2HitAgeSum) / float64(l2HitAgeCount)
		for _, eta := range groups {
			if eta.Cache != nil && eta.Cache.L2Hits > 0 {
				eta.Cache.AvgCacheAgeMs = avgAge
			}
		}
	}

	// Build result
	entityTypes := make([]*entityanalyticsv1.EntityTypeAnalytics, 0, len(groups))
	for _, eta := range groups {
		entityTypes = append(entityTypes, eta)
	}

	summary := buildRequestSummary(entityTypes)

	return &entityanalyticsv1.EntityAnalyticsInfo{
		Operation: &entityanalyticsv1.OperationInfo{
			Hash: meta.Hash,
			Name: meta.Name,
			Type: meta.Type,
		},
		Client: &entityanalyticsv1.ClientInfo{
			Name:    meta.ClientName,
			Version: meta.ClientVersion,
		},
		Schema: &entityanalyticsv1.SchemaInfo{
			Version: meta.SchemaVersion,
		},
		EntityTypes: entityTypes,
		Summary:     summary,
	}
}

func buildRequestSummary(entityTypes []*entityanalyticsv1.EntityTypeAnalytics) *entityanalyticsv1.RequestSummary {
	summary := &entityanalyticsv1.RequestSummary{}
	for _, eta := range entityTypes {
		if eta.Cache != nil {
			summary.TotalCacheHits += eta.Cache.L1Hits + eta.Cache.L2Hits
			summary.TotalCacheMisses += eta.Cache.L1Misses + eta.Cache.L2Misses
			summary.TotalCachedBytes += eta.Cache.CachedBytesServed
		}
		if eta.Fetch != nil {
			summary.TotalEntitiesResolved += eta.Fetch.SubgraphItemCount + eta.Fetch.CachedItemCount
			summary.SubgraphFetchesAvoided += eta.Fetch.CachedItemCount
			summary.TotalL2LatencyMs += eta.Fetch.L2LatencyMs
			summary.TotalSubgraphLatencyMs += eta.Fetch.SubgraphLatencyMs
			summary.TotalFetchedBytes += eta.Fetch.ResponseBytes
			summary.TotalLatencySavedMs += eta.Fetch.LatencySavedMs
			summary.TotalSubgraphErrors += eta.Fetch.SubgraphErrors
		}
		if len(eta.Errors) > 0 {
			summary.HadErrors = true
		}
	}
	return summary
}

func toProtoFieldSource(s resolve.FieldSource) entityanalyticsv1.FieldSource {
	switch s {
	case resolve.FieldSourceL1:
		return entityanalyticsv1.FieldSource_L1_CACHE
	case resolve.FieldSourceL2:
		return entityanalyticsv1.FieldSource_L2_CACHE
	default:
		return entityanalyticsv1.FieldSource_SUBGRAPH
	}
}
