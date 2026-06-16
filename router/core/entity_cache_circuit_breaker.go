package core

import (
	"context"
	"io"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	defaultEntityCacheCircuitBreakerFailureThreshold = 5
	defaultEntityCacheCircuitBreakerCooldownPeriod   = 10 * time.Second
)

type circuitBreakerState uint8

const (
	circuitBreakerClosed circuitBreakerState = iota
	circuitBreakerOpen
	circuitBreakerHalfOpen
)

type circuitBreakerCall uint8

const (
	circuitBreakerClosedCall circuitBreakerCall = iota
	circuitBreakerHalfOpenCall
)

var _ resolve.LoaderCache = (*circuitBreakerCache)(nil)
var _ io.Closer = (*circuitBreakerCache)(nil)

type circuitBreakerCache struct {
	inner resolve.LoaderCache

	mu                  sync.Mutex
	state               circuitBreakerState
	consecutiveFailures int
	openedAt            time.Time
	halfOpenInFlight    bool

	failureThreshold int
	cooldownPeriod   time.Duration
	now              func() time.Time
}

func newCircuitBreakerCache(inner resolve.LoaderCache, cfg config.EntityCachingCircuitBreaker) *circuitBreakerCache {
	failureThreshold := cfg.FailureThreshold
	if failureThreshold <= 0 {
		failureThreshold = defaultEntityCacheCircuitBreakerFailureThreshold
	}
	cooldownPeriod := cfg.CooldownPeriod
	if cooldownPeriod <= 0 {
		cooldownPeriod = defaultEntityCacheCircuitBreakerCooldownPeriod
	}

	return &circuitBreakerCache{
		inner:            inner,
		failureThreshold: failureThreshold,
		cooldownPeriod:   cooldownPeriod,
		now:              time.Now,
	}
}

func (c *circuitBreakerCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	call, ok := c.allowCall()
	if !ok {
		return make([]*resolve.CacheEntry, len(keys)), nil
	}

	entries, err := c.inner.Get(ctx, keys)
	c.recordResult(call, err)
	return entries, err
}

func (c *circuitBreakerCache) Set(ctx context.Context, entries []*resolve.CacheEntry) error {
	call, ok := c.allowCall()
	if !ok {
		return nil
	}

	err := c.inner.Set(ctx, entries)
	c.recordResult(call, err)
	return err
}

func (c *circuitBreakerCache) Delete(ctx context.Context, keys []string) error {
	call, ok := c.allowCall()
	if !ok {
		return nil
	}

	err := c.inner.Delete(ctx, keys)
	c.recordResult(call, err)
	return err
}

func (c *circuitBreakerCache) Close() error {
	if closer, ok := c.inner.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}

func (c *circuitBreakerCache) allowCall() (circuitBreakerCall, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	switch c.state {
	case circuitBreakerClosed:
		return circuitBreakerClosedCall, true
	case circuitBreakerOpen:
		if now.Sub(c.openedAt) < c.cooldownPeriod {
			return circuitBreakerClosedCall, false
		}
		c.state = circuitBreakerHalfOpen
		c.halfOpenInFlight = true
		return circuitBreakerHalfOpenCall, true
	case circuitBreakerHalfOpen:
		if c.halfOpenInFlight {
			return circuitBreakerClosedCall, false
		}
		c.halfOpenInFlight = true
		return circuitBreakerHalfOpenCall, true
	default:
		return circuitBreakerClosedCall, true
	}
}

func (c *circuitBreakerCache) recordResult(call circuitBreakerCall, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if call == circuitBreakerHalfOpenCall {
		c.halfOpenInFlight = false
		if err == nil {
			c.close()
			return
		}
		c.open(c.now())
		return
	}

	if c.state != circuitBreakerClosed {
		return
	}

	if err == nil {
		c.consecutiveFailures = 0
		return
	}

	c.consecutiveFailures++
	if c.consecutiveFailures >= c.failureThreshold {
		c.open(c.now())
	}
}

func (c *circuitBreakerCache) open(now time.Time) {
	c.state = circuitBreakerOpen
	c.consecutiveFailures = 0
	c.openedAt = now
	c.halfOpenInFlight = false
}

func (c *circuitBreakerCache) close() {
	c.state = circuitBreakerClosed
	c.consecutiveFailures = 0
	c.openedAt = time.Time{}
	c.halfOpenInFlight = false
}
