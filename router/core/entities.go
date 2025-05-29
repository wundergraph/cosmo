package core

import (
    "go.uber.org/zap"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

/* hook specific entities that are implemented by the core module system */

// ApplicationParams is passed to ApplicationStartHook/ApplicationStopHook
type ApplicationParams struct {
	Config *config.Config
	Logger *zap.Logger
}


/* common entities for the core module system */

// ExitError is a struct for holding the exit code and error of the router
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }
  