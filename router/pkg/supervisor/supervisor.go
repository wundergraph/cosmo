package supervisor

import (
	"context"
	"errors"
	"fmt"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

// RouterSupervisor is a supervisor for the router.
type RouterSupervisor struct {
	logger *zap.Logger

	router       *core.Router
	routerCtx    context.Context
	routerCancel context.CancelFunc

	// Sending to this channel will trigger a graceful shutdown of the router
	// Sending true will result in a Reload, false will result in a Shutdown
	// Value means "to kill or not to kill"
	shutdownChan chan bool

	lifecycleHooks *LifecycleHooks

	resources *RouterResources
}

// LifecycleHooks is a struct for holding router lifecycle hooks.
type LifecycleHooks struct {
	LoadResources func(*RouterResources) error
}

// RouterResources is a struct for holding resources used by the router.
type RouterResources struct {
	Config *config.Config
	Logger *zap.Logger
}

// RouterSupervisorOpts is a struct for configuring the router supervisor.
type RouterSupervisorOpts struct {
	ConfigPath     string
	Logger         *zap.Logger
	LifecycleHooks *LifecycleHooks
}

// NewRouterSupervisor creates a new RouterSupervisor instance.
func NewRouterSupervisor(opts *RouterSupervisorOpts) *RouterSupervisor {
	return &RouterSupervisor{
		shutdownChan:   make(chan bool),
		logger:         opts.Logger,
		lifecycleHooks: opts.LifecycleHooks,
		resources:      &RouterResources{},
	}
}

func (rs *RouterSupervisor) createRouter() error {
	// Provide a way to cancel all running components of the router after graceful shutdown
	// Don't use the parent context that is canceled by the signal handler
	routerCtx, routerCancel := context.WithCancel(context.Background())

	// TODO: Test if this actually allows router failure and recovery
	router, err := newRouter(routerCtx, Params{
		Config: rs.resources.Config,
		Logger: rs.resources.Logger,
	})
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

	if err := rs.router.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to shutdown router gracefully: %w", err)
	}

	return nil
}

// Start starts the router supervisor.
func (rs *RouterSupervisor) Start() error {
	for {

		if err := rs.lifecycleHooks.LoadResources(rs.resources); err != nil {
			return fmt.Errorf("failed to load resources: %w", err)
		}

		rs.logger.Debug("Creating Router")
		if err := rs.createRouter(); err != nil {
			return fmt.Errorf("failed to create router: %w", err)
		}

		rs.logger.Debug("Starting Router")
		if err := rs.startRouter(); err != nil {
			return fmt.Errorf("failed to start router: %w", err)
		}
		rs.logger.Info("Router started")

		shutdown := <-rs.shutdownChan

		rs.logger.Debug("Stopping Router")
		if err := rs.stopRouter(); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				rs.logger.Warn("Router shutdown deadline exceeded. Consider increasing the shutdown delay")
			}

			return fmt.Errorf("failed to stop router: %w", err)
		}

		if shutdown {
			rs.logger.Info("Router exiting")
			break
		}
	}

	return nil
}

// Stop stops the router supervisor.
func (rs *RouterSupervisor) Stop() {
	rs.logger.Info("Stopping Router")

	rs.shutdownChan <- true
}

// Reload restarts the router supervisor.
func (rs *RouterSupervisor) Reload() {
	rs.logger.Info("Reloading Router")

	rs.shutdownChan <- false
}
