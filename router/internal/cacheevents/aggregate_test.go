package cacheevents

import (
	"testing"

	"github.com/stretchr/testify/require"
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
)

func TestBuildRequest(t *testing.T) {
	t.Parallel()

	t.Run("nil batch produces a non-nil request with nil events", func(t *testing.T) {
		req := BuildRequest(nil)
		require.NotNil(t, req)
		require.Nil(t, req.Events)
	})

	t.Run("empty batch produces an empty request", func(t *testing.T) {
		req := BuildRequest([]*cacheeventsv1.CacheEvent{})
		require.NotNil(t, req)
		require.Empty(t, req.Events)
	})

	t.Run("batch is referenced as-is", func(t *testing.T) {
		batch := []*cacheeventsv1.CacheEvent{
			{EventType: cacheeventsv1.EventType_L1_READ, EntityType: "User"},
			{EventType: cacheeventsv1.EventType_L2_WRITE, EntityType: "Product"},
		}
		req := BuildRequest(batch)
		require.NotNil(t, req)
		require.Len(t, req.Events, 2)
		// Same backing slice — wrapping should not allocate or copy.
		require.Same(t, batch[0], req.Events[0])
		require.Same(t, batch[1], req.Events[1])
	})
}
