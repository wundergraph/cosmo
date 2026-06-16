package core

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestGraphQLHandlerRecordEntityCacheAnalyticsCallsGetCacheStatsOnce(t *testing.T) {
	t.Parallel()

	expected := resolve.CacheAnalyticsSnapshot{
		L1Reads: []resolve.CacheKeyEvent{{Key: "user:1", Hit: true, Bytes: 42}},
	}
	stats := &recordingCacheStatsProvider{
		ctx:       context.Background(),
		snapshots: []resolve.CacheAnalyticsSnapshot{expected, {}},
	}
	recorder := &recordingEntityCacheSnapshotRecorder{}
	handler := &GraphQLHandler{entityCacheMetrics: recorder}

	handler.recordEntityCacheAnalytics(stats)

	require.Equal(t, 1, stats.calls)
	require.Equal(t, 1, recorder.calls)
	require.Equal(t, expected, recorder.snapshot)
	require.Equal(t, stats.ctx, recorder.ctx)
}

func TestGraphQLHandlerRecordEntityCacheAnalyticsDisabledDoesNotReadSnapshot(t *testing.T) {
	t.Parallel()

	stats := &recordingCacheStatsProvider{
		ctx:       context.Background(),
		snapshots: []resolve.CacheAnalyticsSnapshot{{L1Reads: []resolve.CacheKeyEvent{{Key: "user:1"}}}},
	}
	handler := &GraphQLHandler{}

	handler.recordEntityCacheAnalytics(stats)

	require.Equal(t, 0, stats.calls)
}

type recordingCacheStatsProvider struct {
	ctx       context.Context
	snapshots []resolve.CacheAnalyticsSnapshot
	calls     int
}

func (p *recordingCacheStatsProvider) Context() context.Context {
	return p.ctx
}

func (p *recordingCacheStatsProvider) GetCacheStats() resolve.CacheAnalyticsSnapshot {
	snapshot := p.snapshots[p.calls]
	p.calls++
	return snapshot
}

type recordingEntityCacheSnapshotRecorder struct {
	ctx      context.Context
	snapshot resolve.CacheAnalyticsSnapshot
	calls    int
}

func (r *recordingEntityCacheSnapshotRecorder) RecordSnapshot(ctx context.Context, snapshot resolve.CacheAnalyticsSnapshot) {
	r.calls++
	r.ctx = ctx
	r.snapshot = snapshot
}

func (r *recordingEntityCacheSnapshotRecorder) Shutdown() error {
	return nil
}
