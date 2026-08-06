package apq

import (
	"context"
	"errors"

	"github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

type PersistedOperation struct {
	Version int    `json:"version"`
	Body    string `json:"body"`
}

type Client interface {
	Enabled() bool
	// IsDistributed returns true when the APQ store is shared across router instances (e.g. Redis).
	IsDistributed() bool
	PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error)
	SaveOperation(ctx context.Context, clientName, sha256Hash string, operationBody []byte) error
	// RenewTTL refreshes the store TTL of an existing APQ entry without altering
	// its stored body. It is a no-op if the entry is absent.
	RenewTTL(ctx context.Context, clientName, sha256Hash string) error
	Close()
}

type KVClient interface {
	// Get retrieves the operation body from the KV store with the given operation hash as the key
	Get(ctx context.Context, operationHash string) ([]byte, error)
	// Set saves the operation body in the KV store with the given operation hash as the key and the ttl in seconds
	Set(ctx context.Context, operationHash string, operationBody []byte, ttl int) error
	// Close closes the KV store connection
	Close()
}

type Options struct {
	Logger    *zap.Logger
	ApqConfig *config.AutomaticPersistedQueriesConfig
	KVClient  KVClient
}

type client struct {
	enabled  bool
	ttl      int
	cache    *operationstorage.OperationsCache
	kvClient KVClient
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

	return cl, err
}

func (c *client) Enabled() bool {
	return c.enabled
}

func (c *client) IsDistributed() bool {
	return c.kvClient != nil
}

func (c *client) PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error) {
	if c.kvClient != nil {
		return c.kvClient.Get(ctx, sha256Hash)
	}

	// we don't use the client name in the APQ cache, because operations should be persisted across all clients
	return c.cache.Get("", sha256Hash), nil
}

func (c *client) SaveOperation(ctx context.Context, clientName, sha256Hash string, operationBody []byte) error {
	if c.kvClient != nil {
		return c.kvClient.Set(ctx, sha256Hash, operationBody, c.ttl)
	}

	// we don't use the client name in the APQ cache, because operations should be persisted across all clients
	c.cache.Set("", sha256Hash, operationBody, c.ttl)
	return nil
}

// RenewTTL refreshes the store TTL of an existing APQ entry by re-writing the
// body already present in the store. APQ operations are content-addressed by
// sha256(rawQuery), so the stored body is invariant and re-writing it is safe.
// This must not be given the normalized representation, which has @skip/@include
// directives evaluated for the current request's variables (see issue #3062).
func (c *client) RenewTTL(ctx context.Context, _, sha256Hash string) error {
	if c.kvClient != nil {
		body, err := c.kvClient.Get(ctx, sha256Hash)
		if err != nil {
			return err
		}
		if len(body) == 0 {
			// Nothing stored (e.g. evicted); nothing to renew.
			return nil
		}
		return c.kvClient.Set(ctx, sha256Hash, body, c.ttl)
	}

	// in-memory APQ (clientName intentionally unused; APQ keys on hash only)
	if body := c.cache.Get("", sha256Hash); len(body) > 0 {
		c.cache.Set("", sha256Hash, body, c.ttl)
	}
	return nil
}

func (c *client) Close() {
	if c.kvClient != nil {
		c.kvClient.Close()
	}
	if c.cache != nil {
		c.cache.Cache.Close()
	}
}
