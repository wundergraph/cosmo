package cacheevents

import (
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
)

// BuildRequest wraps a finished batch of events into the wire-format request
// the backend expects. Events are already at finest grain — there is no
// further aggregation worth doing on the router side.
func BuildRequest(batch []*cacheeventsv1.CacheEvent) *cacheeventsv1.PublishEntityCacheEventsRequest {
	return &cacheeventsv1.PublishEntityCacheEventsRequest{
		Events: batch,
	}
}
