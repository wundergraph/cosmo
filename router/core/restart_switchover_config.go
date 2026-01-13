package core

import (
	"sync"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

// This file describes any configuration which should persist across router restarts
type SwitchoverConfig struct {
	CacheWarmerQueries *CacheWarmerQueries
}

type CacheWarmerQueries struct {
	maxSize               int // Maximum size of the ring buffer per feature flag
	mu                    sync.RWMutex
	queriesForFeatureFlag map[string]*ringBuffer // Map of feature flag key to ring buffer ("" is default)
}

func NewSwitchoverConfig(config *Config) *SwitchoverConfig {
	switchoverConfig := &SwitchoverConfig{}

	inMemorySwitchoverCacheWarmerEnabled := config.cacheWarmup != nil && config.cacheWarmup.Enabled && config.cacheWarmup.Source.InMemorySwitchover.Enabled

	if inMemorySwitchoverCacheWarmerEnabled {
		switchoverConfig.CacheWarmerQueries = &CacheWarmerQueries{
			maxSize:               config.cacheWarmup.Source.InMemorySwitchover.MaxEntries,
			queriesForFeatureFlag: make(map[string]*ringBuffer),
		}
	}

	return switchoverConfig
}

func (s *SwitchoverConfig) CleanupFeatureFlags(routerCfg *nodev1.RouterConfig) {
	// If not initialized will do nothing
	if s == nil {
		return
	}

	s.CacheWarmerQueries.cleanupUnusedFeatureFlags(routerCfg)
}

func (c *CacheWarmerQueries) getOrCreateBuffer(featureFlagKey string) *ringBuffer {
	// If not initialized will return nil
	if c == nil {
		return nil
	}

	c.mu.RLock()
	buf, exists := c.queriesForFeatureFlag[featureFlagKey]
	c.mu.RUnlock()

	if exists {
		return buf
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check in case another goroutine created it while we were waiting for the write lock
	buf, exists = c.queriesForFeatureFlag[featureFlagKey]
	if exists {
		return buf
	}

	buf = newRingBuffer(c.maxSize)
	c.queriesForFeatureFlag[featureFlagKey] = buf
	return buf
}

func (c *CacheWarmerQueries) cleanupUnusedFeatureFlags(routerCfg *nodev1.RouterConfig) {
	if c == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	ffNames := make(map[string]struct{})
	for ffName, _ := range routerCfg.FeatureFlagConfigs.ConfigByFeatureFlagName {
		ffNames[ffName] = struct{}{}
	}

	for ffName, _ := range c.queriesForFeatureFlag {
		if _, exists := ffNames[ffName]; !exists {
			delete(c.queriesForFeatureFlag, ffName)
		}
	}
}

type ringBuffer struct {
	mu      sync.Mutex
	ring    []string // Ring buffer to track queries
	head    int      // Index where next item will be written
	maxSize int      // Maximum size of the ring buffer
}

func newRingBuffer(maxSize int) *ringBuffer {
	return &ringBuffer{
		ring:    make([]string, 0, maxSize),
		head:    0,
		maxSize: maxSize,
	}
}

func (rb *ringBuffer) Add(query string) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	// If ring buffer is not yet full, append to it
	if len(rb.ring) < rb.maxSize {
		rb.ring = append(rb.ring, query)
		return
	}

	// Add new entry at head position
	rb.ring[rb.head] = query

	// Move head to next position (wrap around)
	rb.head = (rb.head + 1) % rb.maxSize
}

func (rb *ringBuffer) Snapshot() []string {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	snapshot := make([]string, len(rb.ring))
	copy(snapshot, rb.ring)
	return snapshot
}
