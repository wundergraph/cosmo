package rd

import (
	"context"
	"fmt"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"io"
	"strings"
)

// RDCloser is an interface that combines the redis.Cmdable and io.Closer interfaces, ensuring that we can close the
// client connection.
type RDCloser interface {
	redis.Cmdable
	io.Closer
}

type RedisCloserOptions struct {
	Logger         *zap.Logger
	URLs           []string
	ClusterEnabled bool
	Password       string
}

func NewRedisCloser(opts *RedisCloserOptions) (RDCloser, error) {
	if len(opts.URLs) == 0 {
		return nil, fmt.Errorf("no redis URLs provided")
	}

	var rdb RDCloser
	// If provided, prefer cluster URLs to single URL
	if opts.ClusterEnabled {
		opts.Logger.Info("Detected that redis is running in cluster mode.")
		strippedUrls := []string{}
		for _, url := range opts.URLs {
			strippedUrls = append(strippedUrls, strings.ReplaceAll(url, "redis://", ""))
		}
		rdb = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:    strippedUrls,
			Password: opts.Password,
		})
	} else {
		options, err := redis.ParseURL(opts.URLs[0])
		if err != nil {
			return nil, fmt.Errorf("failed to parse the redis connection url: %w", err)
		}
		options.Password = opts.Password
		rdb = redis.NewClient(options)

		if isClusterClient(rdb) {
			opts.Logger.Warn("Detected that redis is running in cluster mode. You may encounter issues as a result")
		}
	}

	if !IsFunctioningClient(rdb) {
		return rdb, fmt.Errorf("failed to create a functioning redis client")
	}

	return rdb, nil
}

func IsFunctioningClient(rdb RDCloser) bool {
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
