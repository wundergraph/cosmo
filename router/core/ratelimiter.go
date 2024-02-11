package core

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"

	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var (
	ErrRateLimitExceeded = errors.New("rate limit exceeded")
)

type CosmoRateLimiterOptions struct {
	RedisClient *redis.Client
	Debug       bool
}

func NewCosmoRateLimiter(opts *CosmoRateLimiterOptions) *CosmoRateLimiter {
	limiter := redis_rate.NewLimiter(opts.RedisClient)
	return &CosmoRateLimiter{
		client:  opts.RedisClient,
		limiter: limiter,
		debug:   opts.Debug,
	}
}

type CosmoRateLimiter struct {
	client  *redis.Client
	limiter *redis_rate.Limiter
	debug   bool
}

func (c *CosmoRateLimiter) RateLimitPreFetch(ctx *resolve.Context, info *resolve.FetchInfo, input json.RawMessage) (result *resolve.RateLimitDeny, err error) {
	if c.isIntrospectionQuery(info.RootFields) {
		return nil, nil
	}
	requestRate := c.calculateRate()
	limit := redis_rate.Limit{
		Rate:   ctx.RateLimitOptions.Rate,
		Burst:  ctx.RateLimitOptions.Burst,
		Period: ctx.RateLimitOptions.Period,
	}
	allow, err := c.limiter.AllowN(ctx.Context(), ctx.RateLimitOptions.RateLimitKey, limit, requestRate)
	if err != nil {
		return nil, err
	}
	c.setRateLimitStats(ctx, requestRate, allow.Remaining, allow.RetryAfter.Milliseconds(), allow.ResetAfter.Milliseconds())
	if allow.Allowed >= requestRate {
		return nil, nil
	}
	if ctx.RateLimitOptions.RejectExceedingRequests {
		return nil, ErrRateLimitExceeded
	}
	return &resolve.RateLimitDeny{}, nil
}

type RateLimitStats struct {
	RequestRate            int   `json:"requestRate"`
	Remaining              int   `json:"remaining"`
	RetryAfterMilliseconds int64 `json:"retryAfterMs"`
	ResetAfterMilliseconds int64 `json:"resetAfterMs"`
}

func (c *CosmoRateLimiter) RenderResponseExtension(ctx *resolve.Context, out io.Writer) error {
	data, err := c.statsJSON(ctx)
	if err != nil {
		return err
	}
	_, err = out.Write(data)
	return err
}

func (c *CosmoRateLimiter) isIntrospectionQuery(rootFields []resolve.GraphCoordinate) bool {
	if len(rootFields) != 1 {
		return false
	}
	if rootFields[0].TypeName == "Query" {
		return rootFields[0].FieldName == "__schema" || rootFields[0].FieldName == "__type"
	}
	if rootFields[0].TypeName == "__Type" {
		return true
	}
	return false
}

func (c *CosmoRateLimiter) calculateRate() int {
	return 1
}

func (c *CosmoRateLimiter) statsJSON(ctx *resolve.Context) ([]byte, error) {
	stats := c.getRateLimitStats(ctx)
	if c.debug {
		stats.ResetAfterMilliseconds = 1234
		stats.RetryAfterMilliseconds = 1234
	}
	return json.Marshal(stats)
}

func (c *CosmoRateLimiter) setRateLimitStats(ctx *resolve.Context, requestRate, remaining int, retryAfter, resetAfter int64) {
	v := ctx.Context().Value(rateLimitStatsCtxKey{})
	if v == nil {
		return
	}
	statsCtx := v.(*rateLimitStatsCtx)
	statsCtx.mux.Lock()
	statsCtx.stats.RequestRate = statsCtx.stats.RequestRate + requestRate
	statsCtx.stats.Remaining = remaining
	statsCtx.stats.RetryAfterMilliseconds = retryAfter
	statsCtx.stats.ResetAfterMilliseconds = resetAfter
	statsCtx.mux.Unlock()
}

func (c *CosmoRateLimiter) getRateLimitStats(ctx *resolve.Context) RateLimitStats {
	v := ctx.Context().Value(rateLimitStatsCtxKey{})
	if v == nil {
		return RateLimitStats{}
	}
	statsCtx := v.(*rateLimitStatsCtx)
	return statsCtx.stats
}

type rateLimitStatsCtx struct {
	stats RateLimitStats
	mux   sync.Mutex
}

type rateLimitStatsCtxKey struct{}

func WithRateLimiterStats(ctx *resolve.Context) *resolve.Context {
	stats := &rateLimitStatsCtx{}
	withStats := context.WithValue(ctx.Context(), rateLimitStatsCtxKey{}, stats)
	return ctx.WithContext(withStats)
}
