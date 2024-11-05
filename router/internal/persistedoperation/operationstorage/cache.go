package operationstorage

import (
	"fmt"
	"github.com/dgraph-io/ristretto"
	"time"
)

type OperationsCache struct {
	// cache is the backing store for the in-memory cache. Note
	// that if the cache is disabled, this will be nil
	Cache *ristretto.Cache[string, []byte]
}

func NewOperationsCache(cacheSize int64) (*OperationsCache, error) {
	if cacheSize <= 0 {
		return &OperationsCache{}, nil
	}

	cache, err := ristretto.NewCache(&ristretto.Config[string, []byte]{
		NumCounters: cacheSize * 10,
		MaxCost:     cacheSize,
		Cost: func(value []byte) int64 {
			return int64(len(value))
		},
		BufferItems: 64,
	})
	if err != nil {
		return nil, fmt.Errorf("initializing operations cache: %v", err)
	}

	return &OperationsCache{Cache: cache}, nil
}

func (c *OperationsCache) key(clientName string, operationHash string) string {
	return clientName + operationHash
}

func (c *OperationsCache) Get(clientName string, operationHash string) []byte {
	// Since we're returning nil when the item is not found, we don't need to
	// check the return value from the cache nor the type assertion
	item, _ := c.Cache.Get(c.key(clientName, operationHash))
	return item
}

func (c *OperationsCache) Set(clientName, operationHash string, operationBody []byte, ttl int) {
	if ttl > 0 {
		ttlD := time.Duration(float64(ttl) * float64(time.Second))
		c.Cache.SetWithTTL(c.key(clientName, operationHash), operationBody, int64(len(operationBody)), ttlD)
		return
	}
	c.Cache.Set(c.key(clientName, operationHash), operationBody, int64(len(operationBody)))
}
