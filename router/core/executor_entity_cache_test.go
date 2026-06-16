package core

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestConfigureSubscriptionEntityCacheCallbacksRecordsSnapshots(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	recorder := &recordingEntityCacheSnapshotRecorder{}
	options := &resolve.ResolverOptions{}

	configureSubscriptionEntityCacheCallbacks(ctx, options, config.EntityCachingConfiguration{
		Enabled: true,
	}, recorder)

	require.NotNil(t, options.OnSubscriptionCacheWrite)
	require.NotNil(t, options.OnSubscriptionCacheInvalidate)

	writeEvent := resolve.CacheWriteEvent{
		Key:        "User:1",
		CacheKey:   "cache:User:1",
		EntityType: "User",
		Kind:       resolve.CacheAnalyticsEventKindL2Write,
		Bytes:      42,
		ByteSize:   42,
		TTL:        7 * time.Minute,
		DataSource: "accounts",
		CacheLevel: resolve.CacheLevelL2,
		Source:     resolve.CacheSourceSubscription,
	}
	options.OnSubscriptionCacheWrite(writeEvent)

	require.Equal(t, 1, recorder.calls)
	assert.Equal(t, ctx, recorder.ctx)
	assert.Equal(t, resolve.CacheAnalyticsSnapshot{
		L2Writes: []resolve.CacheWriteEvent{writeEvent},
	}, recorder.snapshot)

	options.OnSubscriptionCacheInvalidate("User", []string{"cache:User:1", "cache:User:2"})

	require.Equal(t, 2, recorder.calls)
	assert.Equal(t, ctx, recorder.ctx)
	assert.Equal(t, resolve.CacheAnalyticsSnapshot{
		CacheInvalidations: []resolve.CacheInvalidationEvent{
			{EntityType: "User", Key: "cache:User:1", Source: string(resolve.CacheSourceSubscription), Deleted: true},
			{EntityType: "User", Key: "cache:User:2", Source: string(resolve.CacheSourceSubscription), Deleted: true},
		},
	}, recorder.snapshot)
}

func TestConfigureSubscriptionEntityCacheCallbacksSkipsWhenEntityCachingDisabled(t *testing.T) {
	t.Parallel()

	recorder := &recordingEntityCacheSnapshotRecorder{}
	options := &resolve.ResolverOptions{}

	configureSubscriptionEntityCacheCallbacks(context.Background(), options, config.EntityCachingConfiguration{
		Enabled: false,
	}, recorder)

	assert.Nil(t, options.OnSubscriptionCacheWrite)
	assert.Nil(t, options.OnSubscriptionCacheInvalidate)
	assert.Equal(t, 0, recorder.calls)
}
