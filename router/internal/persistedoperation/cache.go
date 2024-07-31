package persistedoperation

import (
	"github.com/dgraph-io/ristretto"
)

const (
	persistentAverageCacheEntrySize = 4 * 1024 // 4kb
)

type OperationsCache struct {
	// cache is the backing store for the in-memory cache. Note
	// that if the cache is disabled, this will be nil
	Cache *ristretto.Cache[string, []byte]
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

func (c *OperationsCache) Set(clientName, operationHash string, operationBody []byte) {
	c.Cache.Set(c.key(clientName, operationHash), operationBody, int64(len(operationBody)))
}
