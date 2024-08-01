package persistedoperation

import (
	"context"
	"fmt"
	"github.com/dgraph-io/ristretto"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

type PersistedOperation struct {
	Version int    `json:"version"`
	Body    string `json:"body"`
}

type PersistentOperationNotFoundError struct {
	ClientName string
	Sha256Hash string
}

func (e *PersistentOperationNotFoundError) Error() string {
	return fmt.Sprintf("operation %s for client %s not found", e.Sha256Hash, e.ClientName)
}

type Client interface {
	PersistedOperation(ctx context.Context, clientName string, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error)
	Close()
}

type Options struct {
	// CacheSize indicates the in-memory cache size, in bytes. If 0, no in-memory
	// cache is used.
	CacheSize uint64
	Logger    *zap.Logger

	ProviderClient Client
}

type client struct {
	options *Options

	cache          *OperationsCache
	providerClient Client
}

func NewClient(opts *Options) (Client, error) {
	cacheSize := int64(opts.CacheSize)

	var cache *ristretto.Cache[string, []byte]
	var err error

	if cacheSize > 0 {
		cache, err = ristretto.NewCache(&ristretto.Config[string, []byte]{
			// assume an average of persistentAverageCacheEntrySize per operation, then
			// multiply by 10 to obtain the recommended number of counters
			NumCounters: (cacheSize * 10) / persistentAverageCacheEntrySize,
			MaxCost:     cacheSize,
			BufferItems: 64,
		})
		if err != nil {
			return nil, fmt.Errorf("initializing CDN cache: %v", err)
		}
	}

	return &client{
		options:        opts,
		providerClient: opts.ProviderClient,
		cache:          &OperationsCache{Cache: cache},
	}, nil
}

func (c client) PersistedOperation(ctx context.Context, clientName string, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error) {
	if data := c.cache.Get(clientName, sha256Hash); data != nil {
		return data, nil
	}

	content, err := c.providerClient.PersistedOperation(ctx, clientName, sha256Hash, attributes)
	if err != nil {
		return nil, err
	}

	c.cache.Set(clientName, sha256Hash, content)

	return content, nil
}

func (c client) Close() {
	c.providerClient.Close()
}
