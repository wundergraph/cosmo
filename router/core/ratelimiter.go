package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"regexp"
	"sync"

	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"

	"github.com/expr-lang/expr/vm"
	"github.com/go-redis/redis_rate/v10"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var (
	ErrRateLimitExceeded = errors.New("rate limit exceeded")
)

type CosmoRateLimiterOptions struct {
	RedisClient rd.RDCloser
	Debug       bool

	RejectStatusCode int

	KeySuffixExpression string
	ExprManager         *expr.Manager

	Overrides []config.RateLimitOverride
}

type compiledOverride struct {
	pattern *regexp.Regexp
	limit   redis_rate.Limit
}

func NewCosmoRateLimiter(opts *CosmoRateLimiterOptions) (rl *CosmoRateLimiter, err error) {
	limiter := redis_rate.NewLimiter(opts.RedisClient)

	rl = &CosmoRateLimiter{
		client:           opts.RedisClient,
		limiter:          limiter,
		debug:            opts.Debug,
		rejectStatusCode: opts.RejectStatusCode,
	}
	if rl.rejectStatusCode == 0 {
		rl.rejectStatusCode = 200
	}

	if opts.KeySuffixExpression != "" {
		rl.keySuffixProgram, err = opts.ExprManager.CompileExpression(opts.KeySuffixExpression, reflect.String)
		if err != nil {
			return nil, err
		}
	}

	for _, o := range opts.Overrides {
		re, err := regexp.Compile(o.Matching)
		if err != nil {
			return nil, fmt.Errorf("invalid regex '%s' for rate limit override: %w", o.Matching, err)
		}

		rl.overrides = append(rl.overrides, compiledOverride{
			pattern: re,
			limit: redis_rate.Limit{
				Rate:   o.Rate,
				Burst:  o.Burst,
				Period: o.Period,
			},
		})
	}

	return rl, nil
}

type CosmoRateLimiter struct {
	client  rd.RDCloser
	limiter *redis_rate.Limiter
	debug   bool

	rejectStatusCode int

	keySuffixProgram *vm.Program
	overrides        []compiledOverride
}

func (c *CosmoRateLimiter) resolveLimit(key string, defaultLimit redis_rate.Limit) redis_rate.Limit {
	for _, o := range c.overrides {
		if o.pattern.MatchString(key) {
			return o.limit
		}
	}

	return defaultLimit
}

func (c *CosmoRateLimiter) RateLimitPreFetch(ctx *resolve.Context, info *resolve.FetchInfo, input json.RawMessage) (result *resolve.RateLimitDeny, err error) {
	if c.isIntrospectionQuery(info.RootFields) {
		return nil, nil
	}

	requestRate := c.calculateRate()
	defaultLimit := redis_rate.Limit{
		Rate:   ctx.RateLimitOptions.Rate,
		Burst:  ctx.RateLimitOptions.Burst,
		Period: ctx.RateLimitOptions.Period,
	}

	key, suffix, err := c.generateKey(ctx)
	if err != nil {
		return nil, err
	}

	limit := c.resolveLimit(suffix, defaultLimit)

	allow, err := c.limiter.AllowN(ctx.Context(), key, limit, requestRate)
	if err != nil {
		return nil, err
	}

	c.setRateLimitStats(ctx, key, requestRate, allow.Remaining, allow.RetryAfter.Milliseconds(), allow.ResetAfter.Milliseconds())

	if allow.Allowed >= requestRate {
		return nil, nil
	}

	if ctx.RateLimitOptions.RejectExceedingRequests {
		return nil, ErrRateLimitExceeded
	}

	return &resolve.RateLimitDeny{}, nil
}

// generateKey returns the full Redis key and the suffix used for override matching.
// When no key_suffix_expression is configured, the suffix equals the full key.
func (c *CosmoRateLimiter) generateKey(ctx *resolve.Context) (fullKey, suffix string, err error) {
	if c.keySuffixProgram == nil {
		key := ctx.RateLimitOptions.RateLimitKey
		return key, key, nil
	}

	rc := getRequestContext(ctx.Context())
	if rc == nil {
		return "", "", errors.New("no request context")
	}

	suffix, err = expr.ResolveStringExpression(c.keySuffixProgram, rc.expressionContext)
	if err != nil {
		return "", "", fmt.Errorf("failed to resolve key suffix expression: %w", err)
	}

	return ctx.RateLimitOptions.RateLimitKey + ":" + suffix, suffix, nil
}

func (c *CosmoRateLimiter) RejectStatusCode() int {
	return c.rejectStatusCode
}

type RateLimitStats struct {
	Key                    string `json:"key,omitempty"`
	RequestRate            int    `json:"requestRate"`
	Remaining              int    `json:"remaining"`
	RetryAfterMilliseconds int64  `json:"retryAfterMs"`
	ResetAfterMilliseconds int64  `json:"resetAfterMs"`
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
	} else {
		stats.Key = "" // hide key when not in debug mode
	}

	return json.Marshal(stats)
}

func (c *CosmoRateLimiter) setRateLimitStats(ctx *resolve.Context, key string, requestRate, remaining int, retryAfter, resetAfter int64) {
	v := ctx.Context().Value(rateLimitStatsCtxKey{})
	if v == nil {
		return
	}

	statsCtx := v.(*rateLimitStatsCtx)
	statsCtx.mux.Lock()
	statsCtx.stats.Key = key
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
	statsCtx.mux.Lock()
	defer statsCtx.mux.Unlock()

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
