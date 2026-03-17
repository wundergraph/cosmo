package entitycache

import (
	"context"
	"io"
	"sync/atomic"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

var _ resolve.LoaderCache = (*CircuitBreakerCache)(nil)
var _ io.Closer = (*CircuitBreakerCache)(nil)

const (
	stateClosed   int32 = 0
	stateOpen     int32 = 1
	stateHalfOpen int32 = 2
)

// CircuitBreakerConfig holds the configuration for a cache circuit breaker.
type CircuitBreakerConfig struct {
	Enabled          bool
	FailureThreshold int
	CooldownPeriod   time.Duration
}

// CircuitBreakerCache wraps a LoaderCache with circuit breaker protection.
// When the underlying cache fails repeatedly (FailureThreshold consecutive failures),
// the breaker opens and all cache operations return nil/no-op, falling back to subgraph fetches.
// After CooldownPeriod, one probe request is allowed through (half-open state).
type CircuitBreakerCache struct {
	cache            resolve.LoaderCache
	failureThreshold int32
	cooldownPeriod   time.Duration

	state            atomic.Int32
	consecutiveFails atomic.Int32
	lastStateChange  atomic.Int64 // unix nanos
}

// NewCircuitBreakerCache wraps the given cache with circuit breaker logic.
func NewCircuitBreakerCache(cache resolve.LoaderCache, cfg CircuitBreakerConfig) *CircuitBreakerCache {
	cb := &CircuitBreakerCache{
		cache:            cache,
		failureThreshold: int32(cfg.FailureThreshold),
		cooldownPeriod:   cfg.CooldownPeriod,
	}
	cb.lastStateChange.Store(time.Now().UnixNano())
	return cb
}

// IsOpen returns true if the circuit breaker is in the open state.
func (cb *CircuitBreakerCache) IsOpen() bool {
	return cb.state.Load() == stateOpen
}

func (cb *CircuitBreakerCache) Get(ctx context.Context, keys []string) ([]*resolve.CacheEntry, error) {
	if !cb.allowRequest() {
		return make([]*resolve.CacheEntry, len(keys)), nil
	}
	entries, err := cb.cache.Get(ctx, keys)
	cb.recordResult(err)
	if err != nil {
		return make([]*resolve.CacheEntry, len(keys)), nil
	}
	return entries, nil
}

func (cb *CircuitBreakerCache) Set(ctx context.Context, entries []*resolve.CacheEntry, ttl time.Duration) error {
	if !cb.allowRequest() {
		return nil
	}
	err := cb.cache.Set(ctx, entries, ttl)
	cb.recordResult(err)
	return nil
}

func (cb *CircuitBreakerCache) Delete(ctx context.Context, keys []string) error {
	if !cb.allowRequest() {
		return nil
	}
	err := cb.cache.Delete(ctx, keys)
	cb.recordResult(err)
	return nil
}

func (cb *CircuitBreakerCache) allowRequest() bool {
	switch cb.state.Load() {
	case stateClosed:
		return true
	case stateOpen:
		if time.Since(time.Unix(0, cb.lastStateChange.Load())) >= cb.cooldownPeriod {
			// Transition to half-open: allow one probe
			if cb.state.CompareAndSwap(stateOpen, stateHalfOpen) {
				cb.lastStateChange.Store(time.Now().UnixNano())
				return true
			}
		}
		return false
	case stateHalfOpen:
		// Only one probe at a time; additional requests are rejected
		return false
	}
	return true
}

func (cb *CircuitBreakerCache) recordResult(err error) {
	if err == nil {
		cb.onSuccess()
	} else {
		cb.onFailure()
	}
}

func (cb *CircuitBreakerCache) onSuccess() {
	cb.consecutiveFails.Store(0)
	state := cb.state.Load()
	if state == stateHalfOpen {
		cb.state.Store(stateClosed)
		cb.lastStateChange.Store(time.Now().UnixNano())
	}
}

func (cb *CircuitBreakerCache) onFailure() {
	fails := cb.consecutiveFails.Add(1)
	state := cb.state.Load()
	if state == stateHalfOpen {
		cb.state.Store(stateOpen)
		cb.lastStateChange.Store(time.Now().UnixNano())
		return
	}
	if state == stateClosed && fails >= cb.failureThreshold {
		cb.state.Store(stateOpen)
		cb.lastStateChange.Store(time.Now().UnixNano())
		cb.consecutiveFails.Store(0)
	}
}

func (cb *CircuitBreakerCache) Close() error {
	if closer, ok := cb.cache.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}
