package metric

import (
	"context"
	"time"
)

type NoopResponseCacheMetricStore struct{}

var _ ResponseCacheMetricStore = (*NoopResponseCacheMetricStore)(nil)

func (n *NoopResponseCacheMetricStore) MeasureOperation(ctx context.Context, operation string, duration time.Duration, errorType string) {
}
func (n *NoopResponseCacheMetricStore) MeasureEngineError(ctx context.Context) {}
func (n *NoopResponseCacheMetricStore) MeasureKeys(ctx context.Context, operation, result string, count int64) {
}
func (n *NoopResponseCacheMetricStore) MeasureWriteTTL(ctx context.Context, ttl time.Duration) {}
