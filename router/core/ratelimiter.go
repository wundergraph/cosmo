package core

import (
	"encoding/json"
	"errors"
	"io"

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
	if allow.Allowed >= requestRate {
		return nil, nil
	}
	if ctx.RateLimitOptions.RejectExceedingRequests {
		return nil, ErrRateLimitExceeded
	}
	return &resolve.RateLimitDeny{}, nil
}

type RateLimitStats struct {
	Remaining         int `json:"remaining"`
	RetryAfterSeconds int `json:"retryAfterSeconds"`
	ResetAfterSeconds int `json:"resetAfterSeconds"`
}

func (c *CosmoRateLimiter) RenderStats(ctx *resolve.Context, out io.Writer) error {
	limit := redis_rate.Limit{
		Rate:   ctx.RateLimitOptions.Rate,
		Burst:  ctx.RateLimitOptions.Burst,
		Period: ctx.RateLimitOptions.Period,
	}
	allow, err := c.limiter.AllowN(ctx.Context(), ctx.RateLimitOptions.RateLimitKey, limit, 0)
	if err != nil {
		return err
	}
	data, err := c.statsJSON(allow)
	if err != nil {
		return err
	}
	_, err = out.Write(data)
	return err
}

func (c *CosmoRateLimiter) calculateRate() int {
	return 1
}

func (c *CosmoRateLimiter) statsJSON(allow *redis_rate.Result) ([]byte, error) {
	stats := RateLimitStats{
		Remaining:         allow.Remaining,
		RetryAfterSeconds: int(allow.RetryAfter.Seconds()),
		ResetAfterSeconds: int(allow.ResetAfter.Seconds()),
	}
	if c.debug {
		if stats.RetryAfterSeconds < 0 {
			stats.RetryAfterSeconds = -1
		}
		if stats.RetryAfterSeconds > 0 {
			stats.RetryAfterSeconds = 1
		}
		if stats.ResetAfterSeconds < 0 {
			stats.ResetAfterSeconds = -1
		}
		if stats.ResetAfterSeconds > 0 {
			stats.ResetAfterSeconds = 1
		}
	}
	return json.Marshal(stats)
}
