package apq

import (
	"context"
	"errors"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"sync"
)

type PersistedOperation struct {
	Version int    `json:"version"`
	Body    string `json:"body"`
}

type Client interface {
	Enabled() bool
	PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error)
	SaveOperation(ctx context.Context, clientName, sha256Hash string, operationBody []byte) error
	Close()
}

type KVClient interface {
	Get(ctx context.Context, clientName, operationHash string) ([]byte, error)
	Set(ctx context.Context, operationHash string, operationBody []byte, ttl int) error
	Close()
}

type Options struct {
	// CacheSize indicates the in-memory cache size, in bytes. If 0, no in-memory
	// cache is used.
	Logger    *zap.Logger
	ApqConfig *config.AutomaticPersistedQueriesConfig
	KVClient  KVClient
}

type client struct {
	enabled   bool
	ttl       int
	cache     *operationstorage.OperationsCache
	kvClient  KVClient
	cacheLock *sync.RWMutex
}

func NewClient(opts *Options) (Client, error) {
	if opts.ApqConfig == nil {
		return nil, errors.New("APQ config is nil")
	}
	cl := &client{
		enabled:  opts.ApqConfig.Enabled,
		kvClient: opts.KVClient,
		ttl:      opts.ApqConfig.Cache.TTL,
	}

	if opts.ApqConfig == nil {
		return nil, errors.New("APQ config is nil")
	} else if !opts.ApqConfig.Enabled || opts.KVClient != nil {
		return cl, nil
	}

	var err error
	cl.cache, err = operationstorage.NewOperationsCache(int64(opts.ApqConfig.Cache.Size.Uint64()))
	cl.cacheLock = &sync.RWMutex{}

	return cl, err
}

func (c client) Enabled() bool {
	return c.enabled
}

func (c client) PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error) {
	if c.kvClient != nil {
		return c.kvClient.Get(ctx, clientName, sha256Hash)
	}

	c.cacheLock.RLock()
	defer c.cacheLock.RUnlock()
	return c.cache.Get(clientName, sha256Hash), nil
}

func (c client) SaveOperation(ctx context.Context, clientName, sha256Hash string, operationBody []byte) error {
	if c.kvClient != nil {
		return c.kvClient.Set(ctx, sha256Hash, operationBody, c.ttl)
	}

	c.cacheLock.RLock()
	defer c.cacheLock.RUnlock()
	c.cache.Set(clientName, sha256Hash, operationBody, c.ttl)
	return nil
}

func (c client) Close() {
	c.kvClient.Close()
}
