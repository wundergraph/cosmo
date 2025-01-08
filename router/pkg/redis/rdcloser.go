package rd

import (
	"context"
	"fmt"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"strings"
)

type RDCloser interface {
	redis.Cmdable
	Close() error
}

type RedisCloserOptions struct {
	Logger   *zap.Logger
	URL      string
	Password string
}

func NewRedisCloser(opts *RedisCloserOptions) (RDCloser, error) {
	var rdb RDCloser
	if !strings.Contains(opts.URL, ",") {
		options, err := redis.ParseURL(opts.URL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse the redis connection url %s: %w", opts.URL, err)
		}

		if opts.Password != "" {
			options.Password = opts.Password
		}
		rdb = redis.NewClient(options)
	}

	if !isFunctioningClient(rdb) || isClusterClient(rdb) {
		opts.Logger.Info("Detected that redis is running in cluster mode.")
		stripped := strings.ReplaceAll(opts.URL, "redis://", "")
		rdb = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:    strings.Split(stripped, ","),
			Password: opts.Password,
		})
		if !isFunctioningClient(rdb) {
			return rdb, fmt.Errorf("failed to create a functioning redis client")
		}
	}

	return rdb, nil
}

func isFunctioningClient(rdb RDCloser) bool {
	if rdb == nil {
		return false
	}

	res, err := rdb.Ping(context.Background()).Result()
	return err == nil && res == "PONG"
}

func isClusterClient(rdb RDCloser) bool {
	if rdb == nil {
		return false
	}

	info, err := rdb.Info(context.Background(), "cluster").Result()
	if err != nil {
		return false
	}

	// Check if the response indicates cluster mode
	return strings.Contains(info, "cluster_enabled:1")
}
