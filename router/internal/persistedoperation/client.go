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

type PersistentOperationNotFoundError struct {
	ClientName string
	Sha256Hash string
}

func (e PersistentOperationNotFoundError) Error() string {
	return fmt.Sprintf("operation '%s' for client '%s' not found", e.Sha256Hash, e.ClientName)
}

type StorageClient interface {
	PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error)
	Close()
}

type Options struct {
	// CacheSize indicates the in-memory cache size, in bytes. If 0, no in-memory
	// cache is used.
	CacheSize uint64
	Logger    *zap.Logger

	ProviderClient StorageClient
	ApqClient      apq.Client
}

type Client struct {
	cache          *operationstorage.OperationsCache
	providerClient StorageClient
	apqClient      apq.Client
}

func NewClient(opts *Options) (*Client, error) {
	cacheSize := int64(opts.CacheSize)

	cache, err := operationstorage.NewOperationsCache(cacheSize)
	if err != nil {
		return nil, errors.Join(err, fmt.Errorf("initializing CDN cache"))
	}

	return &Client{
		providerClient: opts.ProviderClient,
		cache:          cache,
		apqClient:      opts.ApqClient,
	}, nil
}

func (c *Client) PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, bool, error) {
	if c.apqClient != nil && c.apqClient.Enabled() {
		resp, apqErr := c.apqClient.PersistedOperation(ctx, clientName, sha256Hash)
		if len(resp) > 0 || apqErr != nil {
			return resp, true, apqErr
		}
	}

	if data := c.cache.Get(clientName, sha256Hash); data != nil {
		return data, false, nil
	}

	if c.providerClient == nil {
		// This can happen if we are using APQ client, without any persisted operation client. Otherwise, we should have a provider client and shouldn't reach here.
		return nil, c.apqClient != nil, nil
	}

	var (
		poNotFound *PersistentOperationNotFoundError
	)

	content, err := c.providerClient.PersistedOperation(ctx, clientName, sha256Hash)
	if errors.As(err, &poNotFound) && c.apqClient != nil {
		// This could well be the first time a client is requesting an APQ operation and the query is attached to the request. Return without error here, and we'll verify the operation later.
		return content, true, nil
	}
	if err != nil {
		return nil, false, err
	}

	c.cache.Set(clientName, sha256Hash, content, 0)

	return content, false, nil
}

func (c *Client) SaveOperation(ctx context.Context, clientName, sha256Hash, operationBody string) error {
	if c.apqClient != nil && c.apqClient.Enabled() {
		return c.apqClient.SaveOperation(ctx, clientName, sha256Hash, []byte(operationBody))
	}

	return nil
}

func (c *Client) APQEnabled() bool {
	return c.apqClient != nil && c.apqClient.Enabled()
}

func (c *Client) Close() {
	if c.providerClient != nil {
		c.providerClient.Close()
	}
	if c.cache != nil && c.cache.Cache != nil {
		c.cache.Cache.Close()
	}
	if c.apqClient != nil {
		c.apqClient.Close()
	}
}
