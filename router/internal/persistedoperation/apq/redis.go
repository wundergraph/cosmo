package apq

import (
	"context"
	"errors"
	"fmt"
	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"time"
)

type RedisOptions struct {
	Logger        *zap.Logger
	StorageConfig *config.BaseStorageProvider
	ApqConfig     *config.AutomaticPersistedQueriesConfig
	Prefix        string
}

type redisClient struct {
	logger *zap.Logger
	client *redis.Client
	prefix string
}

func NewRedisClient(opts *RedisOptions) (KVClient, error) {
	if opts.StorageConfig == nil {
		return nil, errors.New("storage config is nil")
	}

	options, err := redis.ParseURL(opts.StorageConfig.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse the redis connection url: %w", err)
	}

	innerClient := redis.NewClient(options)

	rclient := &redisClient{
		logger: opts.Logger,
		client: innerClient,
		prefix: opts.Prefix,
	}

	return rclient, nil
}

func (r *redisClient) Get(ctx context.Context, clientName, operationHash string) ([]byte, error) {
	cmd := r.client.Get(ctx, r.prefix+operationHash)
	if errors.Is(cmd.Err(), redis.Nil) {
		//return nil, &operationstorage.PersistentOperationNotFoundError{
		//	ClientName: clientName,
		//	Sha256Hash: operationHash,
		//}
		return nil, nil
	}
	return cmd.Bytes()
}

func (r *redisClient) Set(ctx context.Context, operationHash string, operationBody []byte, ttl int) error {
	ttlD := time.Duration(float64(ttl) * float64(time.Second))
	status := r.client.Set(ctx, r.prefix+operationHash, operationBody, ttlD)
	return status.Err()
}

func (r *redisClient) Close() {
	_ = r.client.Close()
}
