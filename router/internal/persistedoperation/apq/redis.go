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
	ApqConfig     *config.AutomaticPersistedQueriesConfig
	Prefix        string
}

type redisClient struct {
	logger *zap.Logger
	client rd.RDCloser
	prefix string
}

func NewRedisClient(opts *RedisOptions) (KVClient, error) {
	if opts.StorageConfig == nil {
		return nil, errors.New("storage config is nil")
	}

	rdb, err := rd.NewRedisCloser(&rd.RedisCloserOptions{
		Logger:         opts.Logger,
		URLs:           opts.StorageConfig.URLs,
		ClusterEnabled: opts.StorageConfig.ClusterEnabled,
	})

	rclient := &redisClient{
		logger: opts.Logger,
		client: rdb,
		prefix: opts.Prefix,
	}

	return rclient, err
}

func (r *redisClient) Get(ctx context.Context, operationHash string) ([]byte, error) {
	cmd := r.client.Get(ctx, r.prefix+operationHash)
	if errors.Is(cmd.Err(), redis.Nil) {
		return nil, nil
	}
	return cmd.Bytes()
}

func (r *redisClient) Set(ctx context.Context, operationHash string, operationBody []byte, ttl int) error {
	ttlD := time.Duration(float64(ttl)) * time.Second
	status := r.client.Set(ctx, r.prefix+operationHash, operationBody, ttlD)
	return status.Err()
}

func (r *redisClient) Close() {
	_ = r.client.Close()
}
