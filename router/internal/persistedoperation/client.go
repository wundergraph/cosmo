package persistedoperation

import (
	"context"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage"
	"go.uber.org/zap"
)

type PersistedOperation struct {
	Version int    `json:"version"`
	Body    string `json:"body"`
}

type Client interface {
	PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error)
	Close()
}

type SaveClient interface {
	Client
	SaveOperation(ctx context.Context, clientName, sha256Hash, operationBody string) error
	ApqEnabled() bool
}

type Options struct {
	// CacheSize indicates the in-memory cache size, in bytes. If 0, no in-memory
	// cache is used.
	CacheSize uint64
	Logger    *zap.Logger

	ProviderClient Client
	ApqClient      apq.Client
}

type client struct {
	cache          *operationstorage.OperationsCache
	providerClient Client
	apqClient      apq.Client
}

func NewClient(opts *Options) (SaveClient, error) {
	cacheSize := int64(opts.CacheSize)

	cache, err := operationstorage.NewOperationsCache(cacheSize)
	if err != nil {
		return nil, errors.Join(err, fmt.Errorf("initializing CDN cache"))
	}

	return &client{
		providerClient: opts.ProviderClient,
		cache:          cache,
		apqClient:      opts.ApqClient,
	}, nil
}

func (c client) PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error) {
	if data := c.cache.Get(clientName, sha256Hash); data != nil {
		return data, nil
	}

	content, err := c.providerClient.PersistedOperation(ctx, clientName, sha256Hash)
	if errors.As(err, &operationstorage.PoNotFoundErr) && c.apqClient != nil {
		return c.apqClient.PersistedOperation(ctx, clientName, sha256Hash)
	}
	if err != nil {
		return nil, err
	}

	c.cache.Set(clientName, sha256Hash, content, 0)

	return content, nil
}

func (c client) ApqEnabled() bool {
	return c.apqClient != nil && c.apqClient.Enabled()
}

func (c client) SaveOperation(ctx context.Context, clientName, sha256Hash, operationBody string) error {
	if c.apqClient != nil && c.apqClient.Enabled() {
		return c.apqClient.SaveOperation(ctx, clientName, sha256Hash, []byte(operationBody))
	}

	return nil
}

func (c client) Close() {
	c.providerClient.Close()
}
