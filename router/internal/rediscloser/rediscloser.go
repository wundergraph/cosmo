package rediscloser

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// RDCloser is an interface that combines the redis.Cmdable and io.Closer interfaces, ensuring that we can close the
// client connection.
type RDCloser interface {
	redis.UniversalClient
}

type RedisCloserOptions struct {
	Logger         *zap.Logger
	URLs           []string
	ClusterEnabled bool
	Password       string
	
	// Redis Sentinel configuration
	SentinelEnabled  bool
	MasterName       string
	SentinelAddrs    []string
	SentinelPassword string
}

func NewRedisCloser(opts *RedisCloserOptions) (RDCloser, error) {
	if opts == nil { 
		return nil, fmt.Errorf("nil RedisCloserOptions") 
	} 
	if opts.Logger == nil {
		 opts.Logger = zap.NewNop() 
	}
	if err := validateRedisConfig(opts); err != nil {
		return nil, err
	}

	switch {
	case opts.SentinelEnabled:
		return createSentinelClient(opts)
	case opts.ClusterEnabled:
		return createClusterClient(opts)
	default:
		return createDirectClient(opts)
	}
}

// validateRedisConfig validates the Redis configuration options
func validateRedisConfig(opts *RedisCloserOptions) error {
	switch {
	case opts.SentinelEnabled:
		if opts.MasterName == "" {
			return fmt.Errorf("master_name is required when sentinel_enabled is true")
		}
		if len(opts.SentinelAddrs) == 0 {
			return fmt.Errorf("sentinel_addrs is required when sentinel_enabled is true")
		}
		if opts.ClusterEnabled {
			return fmt.Errorf("cannot enable both sentinel_enabled and cluster_enabled")
		}
	case opts.ClusterEnabled:
		if len(opts.URLs) == 0 {
			return fmt.Errorf("urls is required when cluster_enabled is true")
		}
	default:
		if len(opts.URLs) == 0 {
			return fmt.Errorf("urls is required for direct Redis")
		}
	}
	return nil
}

// createSentinelClient creates a Redis sentinel client
func createSentinelClient(opts *RedisCloserOptions) (RDCloser, error) {
	opts.Logger.Info("Creating Redis client in sentinel mode.", 
		zap.String("master_name", opts.MasterName),
		zap.Int("sentinel_count", len(opts.SentinelAddrs)))

	rdb := redis.NewFailoverClient(&redis.FailoverOptions{
		MasterName:       opts.MasterName,
		SentinelAddrs:    opts.SentinelAddrs,
		SentinelPassword: opts.SentinelPassword,
		Password:         opts.Password,
	})

	if isFunctioning, err := IsFunctioningClient(rdb); !isFunctioning {
		_ = rdb.Close()
		return rdb, fmt.Errorf("failed to create a functioning Redis sentinel client: %w", err)
	}

	return rdb, nil
}

// createClusterClient creates a Redis cluster client
func createClusterClient(opts *RedisCloserOptions) (RDCloser, error) {
	opts.Logger.Info("Creating Redis client in cluster mode.")

	// Parse the first URL to get the cluster options. We assume that the first URL provided is the primary URL
	// and append further URLs as secondary addr params to the URL, as required by the go-redis library.
	// e.g. redis://user:password@localhost:6789?dial_timeout=3&read_timeout=6s&addr=localhost:6790&addr=localhost:6791
	parsedUrl, err := url.Parse(opts.URLs[0])
	if err != nil {
		return nil, fmt.Errorf("failed to parse the redis connection url: %w", err)
	}

	// This operates on the URL query, and if there are more urls, appends them to the addr param
	addClusterUrlsToQuery(opts, parsedUrl)
	// Parse the cluster URL using the library method, to pick up all of the options encoded
	clusterOps, err := redis.ParseClusterURL(parsedUrl.String())

	if err != nil {
		return nil, fmt.Errorf("failed to parse the redis connection url into ops: %w", err)
	}
	if opts.Password != "" {
		// If they explicitly provide a password, assume that it's overwriting the URL password or that none was
		// provided in the URL
		clusterOps.Password = opts.Password
	}

	rdb := redis.NewClusterClient(clusterOps)

	if isFunctioning, err := IsFunctioningClient(rdb); !isFunctioning {
		_ = rdb.Close()
		return rdb, fmt.Errorf("failed to create a functioning Redis cluster client: %w", err)
	}

	return rdb, nil
}

// createDirectClient creates a direct Redis client (single instance or master-slave without automatic failover)
func createDirectClient(opts *RedisCloserOptions) (RDCloser, error) {
	opts.Logger.Info("Creating Redis client in direct mode.")

	urlEncodedOpts, err := redis.ParseURL(opts.URLs[0])
	if err != nil {
		return nil, fmt.Errorf("failed to parse the redis connection url: %w", err)
	}
	if opts.Password != "" {
		// If they explicitly provide a password, assume that it's overwriting the URL password or that none was
		// provided in the URL
		urlEncodedOpts.Password = opts.Password
	}
	rdb := redis.NewClient(urlEncodedOpts)

	if isClusterClient(rdb) {
		opts.Logger.Warn("Detected that redis is running in cluster mode. You may encounter issues as a result")
	}

	if isFunctioning, err := IsFunctioningClient(rdb); !isFunctioning {
		return rdb, fmt.Errorf("failed to create a functioning Redis direct client: %w", err)
	}

	return rdb, nil
}

// addClusterUrlsToQuery iterates over all the provided URLs, after the first one, and ensures that they are
// appended to the URL as required by the go-redis library.
// e.g. redis://user:password@localhost:6789?dial_timeout=3&read_timeout=6s&addr=localhost:6790&addr=localhost:6791
func addClusterUrlsToQuery(opts *RedisCloserOptions, parsedUrl *url.URL) {
	if len(opts.URLs) <= 1 {
		return
	}

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
			opts.Logger.Warn("Stripping credentials from secondary Redis address", zap.String("address", addr))
		}
		if secondaryURL.Scheme != parsedUrl.Scheme {
			opts.Logger.Warn("Mismatched Redis schemes provided", zap.String("firstScheme", parsedUrl.Scheme), zap.String("secondScheme", secondaryURL.Scheme))
		}

		queryVals.Add("addr", addr)
	}
	parsedUrl.RawQuery = queryVals.Encode()
}

func IsFunctioningClient(rdb RDCloser) (bool, error) {
	if rdb == nil {
		return false, nil
	}

	res, err := rdb.Ping(context.Background()).Result()
	return err == nil && res == "PONG", err
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
