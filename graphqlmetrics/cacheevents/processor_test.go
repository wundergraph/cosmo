package cacheevents

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
)

func TestDefaultProcessorConfig(t *testing.T) {
	t.Parallel()

	cfg := DefaultProcessorConfig()
	require.Equal(t, 8192, cfg.MaxBatchSize)
	require.Equal(t, 131072, cfg.MaxQueueSize)
	require.Equal(t, 4, cfg.MaxWorkers)
	require.Equal(t, 5*time.Second, cfg.Interval)
}

func TestBatchCost(t *testing.T) {
	t.Parallel()

	t.Run("nil slice has zero cost", func(t *testing.T) {
		require.Equal(t, 0, batchCost(nil))
	})

	t.Run("empty slice has zero cost", func(t *testing.T) {
		require.Equal(t, 0, batchCost([]BatchItem{}))
	})

	t.Run("sums event counts across items", func(t *testing.T) {
		items := []BatchItem{
			{Events: []*cacheeventsv1.CacheEvent{{}, {}, {}}},
			{Events: []*cacheeventsv1.CacheEvent{{}}},
			{Events: nil},
			{Events: []*cacheeventsv1.CacheEvent{{}, {}}},
		}
		require.Equal(t, 6, batchCost(items))
	})

	t.Run("item with nil events contributes zero", func(t *testing.T) {
		items := []BatchItem{{Events: nil}, {Events: nil}}
		require.Equal(t, 0, batchCost(items))
	})
}
