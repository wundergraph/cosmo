package routerconfig

import (
	"context"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"time"
)

type Response struct {
	// Config is the marshaled router config
	Config *nodev1.RouterConfig
	// ETag is the ETag of the config. Only set if the config is fetched from the S3 client
	ETag string
}

type Client interface {
	RouterConfig(ctx context.Context, version string, modifiedSince time.Time) (*Response, error)
}

type ConfigNotFoundError interface {
	error
	FederatedGraphId() string
}
