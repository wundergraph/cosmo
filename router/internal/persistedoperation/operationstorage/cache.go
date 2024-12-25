package operationstorage

import (
	"fmt"
	"github.com/dgraph-io/ristretto/v2"
	"sync"
	"time"
)

var (
	persistentAverageCacheEntrySize = int64(4 * 1024) // 4kb
)

type OperationsCache struct {
	// cache is the backing store for the in-memory cache. Note
	// that if the cache is disabled, this will be nil
	Cache     *ristretto.Cache[string, []byte]
	cacheLock *sync.RWMutex
}

func NewOperationsCache(cacheSize int64) (*OperationsCache, error) {
	oc := &OperationsCache{
		cacheLock: &sync.RWMutex{},
	}

	if cacheSize <= 0 {
		return oc, nil
	}

	var err error
	oc.Cache, err = ristretto.NewCache(&ristretto.Config[string, []byte]{
		NumCounters:        (cacheSize * 10) / persistentAverageCacheEntrySize,
		MaxCost:            cacheSize,
		IgnoreInternalCost: true,
		BufferItems:        64,
	})
	if err != nil {
		return nil, fmt.Errorf("initializing operations cache: %v", err)
	}

	return oc, nil
}

func (c *OperationsCache) key(clientName string, operationHash string) string {
	return clientName + operationHash
}

func (c *OperationsCache) Get(clientName string, operationHash string) []byte {
	// Since we're returning nil when the item is not found, we don't need to
	// check the return value from the cache nor the type assertion
	c.cacheLock.RLock()
	item, _ := c.Cache.Get(c.key(clientName, operationHash))
	c.cacheLock.RUnlock()
	return item
}

func (c *OperationsCache) Set(clientName, operationHash string, operationBody []byte, ttl int) {
	if ttl > 0 {
		ttlD := time.Duration(float64(ttl)) * time.Second
		c.cacheLock.Lock()
		c.Cache.SetWithTTL(c.key(clientName, operationHash), operationBody, int64(len(operationBody)), ttlD)
		c.cacheLock.Unlock()
		return
	}
	c.cacheLock.Lock()
	c.Cache.Set(c.key(clientName, operationHash), operationBody, int64(len(operationBody)))
	c.cacheLock.Unlock()
}
