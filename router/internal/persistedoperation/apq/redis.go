package apq

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

type RedisOptions struct {
	Logger        *zap.Logger
	StorageConfig *config.RedisStorageProvider
	Prefix        string
	TTL           time.Duration
}

type redisStore struct {
	client rd.RDCloser
	prefix string
	ttl    time.Duration
}

func NewRedisStore(opts *RedisOptions) (*redisStore, error) {
	if opts.StorageConfig == nil {
		return nil, errors.New("storage config is nil")
	}

	rdb, err := rd.NewRedisCloser(&rd.RedisCloserOptions{
		Logger:         opts.Logger,
		URLs:           opts.StorageConfig.URLs,
		ClusterEnabled: opts.StorageConfig.ClusterEnabled,
	})

	store := &redisStore{
		client: rdb,
		prefix: opts.Prefix,
		ttl:    opts.TTL,
	}

	return store, err
}

func (r *redisStore) Get(ctx context.Context, operationHash string) ([]byte, error) {
	cmd := r.client.Get(ctx, r.prefix+operationHash)
	if errors.Is(cmd.Err(), redis.Nil) {
		return nil, nil
	}
	return cmd.Bytes()
}

func (r *redisStore) Set(ctx context.Context, operationHash string, operationBody []byte) error {
	status := r.client.Set(ctx, r.prefix+operationHash, operationBody, r.ttl)
	return status.Err()
}

func (r *redisStore) Renew(ctx context.Context, operationHash string) error {
	if r.ttl <= 0 {
		return nil
	}
	return r.client.Expire(ctx, r.prefix+operationHash, r.ttl).Err()
}

func (r *redisStore) IsDistributed() bool {
	return true
}

func (r *redisStore) Close() error {
	if r.client != nil {
		return r.client.Close()
	}

	return nil
}
