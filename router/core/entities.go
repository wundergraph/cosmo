package core

import (
	"net/http"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

/* hook specific entities that are implemented by the open core module system */

// ApplicationParams is passed to ApplicationStartHook/ApplicationStopHook
type ApplicationParams struct {
	// the global configuration
	Config *config.Config
	Logger *zap.Logger
}

// GraphQLServerParams is passed to GraphQLServerStartHook/GraphQLServerStopHook
type GraphQLServerParams struct {
	// The HTTP Handler that actually serves /graphql
	Handler http.Handler

	// The router-level configuration
	Config *nodev1.RouterConfig

	Logger *zap.Logger
}


/* common entities for the open core module system */

// ExitError is a struct for holding the exit code and error of the router
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }
  