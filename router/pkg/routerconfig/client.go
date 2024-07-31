package routerconfig

import (
	"context"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"time"
)

type Response struct {
	// Config is the marshaled router config
	Config *nodev1.RouterConfig
}

type Client interface {
	// RouterConfig returns the latest router config from the config provider
	// Version and last fetch time information can be used from different providers to determine if the config has changed
	RouterConfig(ctx context.Context, prevVersion string, prevFetchTime time.Time) (*Response, error)
}

type ConfigNotFoundError interface {
	error
	FederatedGraphId() string
}
