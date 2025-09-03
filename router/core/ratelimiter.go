package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sync"

	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"

	"github.com/expr-lang/expr/vm"
	"github.com/go-redis/redis_rate/v10"
	"github.com/wundergraph/cosmo/router/internal/expr"
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
	return rl, nil
}

type CosmoRateLimiter struct {
	client  rd.RDCloser
	limiter *redis_rate.Limiter
	debug   bool

	rejectStatusCode int

	keySuffixProgram *vm.Program
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
	key, err := c.generateKey(ctx)
	if err != nil {
		return nil, err
	}
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

func (c *CosmoRateLimiter) generateKey(ctx *resolve.Context) (string, error) {
	if c.keySuffixProgram == nil {
		return ctx.RateLimitOptions.RateLimitKey, nil
	}
	rc := getRequestContext(ctx.Context())
	if rc == nil {
		return "", errors.New("no request context")
	}
	str, err := expr.ResolveStringExpression(c.keySuffixProgram, rc.expressionContext)
	if err != nil {
		return "", fmt.Errorf("failed to resolve key suffix expression: %w", err)
	}
	buf := bytes.NewBuffer(make([]byte, 0, len(ctx.RateLimitOptions.RateLimitKey)+len(str)+1))
	_, _ = buf.WriteString(ctx.RateLimitOptions.RateLimitKey)
	_ = buf.WriteByte(':')
	_, _ = buf.WriteString(str)
	return buf.String(), nil
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
