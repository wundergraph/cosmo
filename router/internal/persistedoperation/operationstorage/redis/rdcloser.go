package rd

import (
	"context"
	"fmt"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"io"
	"net/url"
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

		parsedUrl, err := url.Parse(opts.URLs[0])
		if err != nil {
			return nil, fmt.Errorf("failed to parse the redis connection url: %w", err)
		}
		if len(opts.URLs) > 1 {
			queryVals := parsedUrl.Query()
			for _, rawURL := range opts.URLs[1:] {
				secondaryURL, parseErr := url.Parse(rawURL)
				if parseErr != nil {
					opts.Logger.Warn(fmt.Sprintf("Skipping invalid Redis URL %q: %v", rawURL, parseErr))
					continue
				}

				// Strip schema, username, and password
				addr := secondaryURL.Host
				if secondaryURL.User != nil && parsedUrl.User != nil && parsedUrl.User.String() != "" && secondaryURL.User.Username() != parsedUrl.User.Username() {
					opts.Logger.Warn(fmt.Sprintf("Stripping credentials from secondary Redis address: %q", addr))
				}
				if secondaryURL.Scheme != parsedUrl.Scheme {
					opts.Logger.Warn(fmt.Sprintf("Mismatched Redis schemes provided: %q vs %q", secondaryURL.Scheme, parsedUrl.Scheme))
				}

				queryVals.Add("addr", addr)
			}
			parsedUrl.RawQuery = queryVals.Encode()
		}
		clusterOps, err := redis.ParseClusterURL(parsedUrl.String())

		if err != nil {
			return nil, fmt.Errorf("failed to parse the redis connection url into ops: %w", err)
		}
		if opts.Password != "" {
			clusterOps.Password = opts.Password
		}

		rdb = redis.NewClusterClient(clusterOps)
	} else {
		options, err := redis.ParseURL(opts.URLs[0])
		if err != nil {
			return nil, fmt.Errorf("failed to parse the redis connection url: %w", err)
		}
		if opts.Password != "" {
			options.Password = opts.Password
		}
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
