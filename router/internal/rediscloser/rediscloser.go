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
}

func NewRedisCloser(opts *RedisCloserOptions) (RDCloser, error) {
	if len(opts.URLs) == 0 {
		return nil, fmt.Errorf("no redis URLs provided")
	}

	var rdb RDCloser
	// If provided, we create a cluster client
	if opts.ClusterEnabled {
		opts.Logger.Info("Detected that redis is running in cluster mode.")

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

		rdb = redis.NewClusterClient(clusterOps)
	} else {
		urlEncodedOpts, err := redis.ParseURL(opts.URLs[0])
		if err != nil {
			return nil, fmt.Errorf("failed to parse the redis connection url: %w", err)
		}
		if opts.Password != "" {
			// If they explicitly provide a password, assume that it's overwriting the URL password or that none was
			// provided in the URL
			urlEncodedOpts.Password = opts.Password
		}
		rdb = redis.NewClient(urlEncodedOpts)

		if isClusterClient(rdb) {
			opts.Logger.Warn("Detected that redis is running in cluster mode. You may encounter issues as a result")
		}
	}

	if isFunctioning, err := IsFunctioningClient(rdb); !isFunctioning {
		return rdb, fmt.Errorf("failed to create a functioning redis client with the provided URLs: %w", err)
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
