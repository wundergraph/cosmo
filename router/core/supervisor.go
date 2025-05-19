package core

import (
	"context"
	"errors"
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

// RouterSupervisor is a supervisor for the router.
type RouterSupervisor struct {
	logger *zap.Logger

	router       *Router
	routerCtx    context.Context
	routerCancel context.CancelFunc

	// Sending to this channel will trigger a graceful shutdown of the router
	// Sending true will result in a Reload, false will result in a Shutdown
	// Value means "to kill or not to kill"
	shutdownChan chan bool

	configFactory func() (*config.Config, error)
	routerFactory func(ctx context.Context, res *RouterResources) (*Router, error)

	resources *RouterResources
}

// RouterResources is a struct for holding resources used by the router.
type RouterResources struct {
	Config *config.Config
	Logger *zap.Logger
}

// RouterSupervisorOpts is a struct for configuring the router supervisor.
type RouterSupervisorOpts struct {
	BaseLogger    *zap.Logger
	ConfigFactory func() (*config.Config, error)
	RouterFactory func(ctx context.Context, res *RouterResources) (*Router, error)
}

// NewRouterSupervisor creates a new RouterSupervisor instance.
func NewRouterSupervisor(opts *RouterSupervisorOpts) (*RouterSupervisor, error) {
	rs := &RouterSupervisor{
		shutdownChan:  make(chan bool),
		logger:        opts.BaseLogger.With(zap.String("component", "supervisor")),
		configFactory: opts.ConfigFactory,
		resources: &RouterResources{
			Logger: opts.BaseLogger,
		},
	}

	if rs.configFactory == nil {
		return nil, errors.New("a config factory is required")
	}

	if opts.RouterFactory == nil {
		rs.routerFactory = DefaultRouterFactory
	} else {
		rs.routerFactory = opts.RouterFactory
	}

	return rs, nil
}

func DefaultRouterFactory(ctx context.Context, res *RouterResources) (*Router, error) {
	router, err := newRouter(ctx, *res)
	if err != nil {
		return nil, fmt.Errorf("failed to create router: %w", err)
	}

	return router, nil
}

func (rs *RouterSupervisor) createRouter() error {
	// Provide a way to cancel all running components of the router after graceful shutdown
	// Don't use the parent context that is canceled by the signal handler
	routerCtx, routerCancel := context.WithCancel(context.Background())

	router, err := rs.routerFactory(routerCtx, rs.resources)
	if err != nil {
		routerCancel()
		return fmt.Errorf("failed to create router: %w", err)
	}

	rs.router = router
	rs.routerCtx = routerCtx
	rs.routerCancel = routerCancel

	return nil
}

func (rs *RouterSupervisor) startRouter() error {
	if err := rs.router.Start(rs.routerCtx); err != nil {
		return err
	}

	return nil
}

func (rs *RouterSupervisor) stopRouter() error {
	// Enforce a maximum shutdown delay to avoid waiting forever
	// Don't use the parent context that is canceled by the signal handler
	shutdownCtx, cancel := context.WithTimeout(context.Background(), rs.resources.Config.ShutdownDelay)
	defer cancel()

	rs.logger.Info("Graceful shutdown of router initiated", zap.String("shutdown_delay", rs.resources.Config.ShutdownDelay.String()))

	if err := rs.router.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to shutdown router gracefully: %w", err)
	}

	rs.routerCancel()

	return nil
}

func (rs *RouterSupervisor) loadConfig() error {
	cfg, err := rs.configFactory()
	if err != nil {
		return err
	}

	rs.resources.Config = cfg

	return nil
}

var (
	ErrStartupFailed = errors.New("router start error")
)

// Start starts the router supervisor.
func (rs *RouterSupervisor) Start() error {
	if err := rs.loadConfig(); err != nil {
		return fmt.Errorf("%w: failed to load config: %w", ErrStartupFailed, err)
	}

	for {
		rs.logger.Debug("Creating Router")
		if err := rs.createRouter(); err != nil {
			return fmt.Errorf("%w: failed to create router: %w", ErrStartupFailed, err)
		}

		rs.logger.Debug("Starting Router")
		if err := rs.startRouter(); err != nil {
			return fmt.Errorf("%w: failed to start router: %w", ErrStartupFailed, err)
		}

		rs.logger.Info("Router started")

		shutdown := <-rs.shutdownChan

		rs.logger.Debug("Got shutdown signal", zap.Bool("shutdown", shutdown))
		if err := rs.stopRouter(); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				rs.logger.Warn("Router shutdown deadline exceeded. Consider increasing the shutdown delay")
			}

			return fmt.Errorf("failed to stop router: %w", err)
		}

		rs.logger.Info("Router shutdown successfully")

		if shutdown {
			rs.logger.Debug("Router exiting")
			break
		}

		// Reload resources for new router, if failed, continue to restart with the old resources
		if err := rs.loadConfig(); err != nil {
			rs.logger.Warn("reloading resources failed, keeping old ones", zap.Error(err))
			continue
		}
	}

	return nil
}

// Stop stops the router supervisor.
func (rs *RouterSupervisor) Stop() {
	rs.logger.Info("Stopping Router")

	// true == kill
	rs.shutdownChan <- true
}

// Reload restarts the router supervisor.
func (rs *RouterSupervisor) Reload() {
	rs.logger.Info("Reloading Router")

	// false == don't kill
	rs.shutdownChan <- false
}
