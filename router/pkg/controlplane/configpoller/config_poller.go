package configpoller

import (
	"context"
	"errors"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/routerconfig"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane"
	"go.uber.org/zap"
)

type Option func(cp *configPoller)

var ErrConfigNotModified = errors.New("config not modified")
var ErrConfigNotFound = errors.New("config not found")

type ConfigPoller interface {
	// Subscribe subscribes to the config poller with a handler function that will be invoked
	// with the latest router config and the previous version string. If the handler takes longer than the poll interval
	// to execute, the next invocation will be skipped.
	Subscribe(ctx context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersion string) error)
	// GetRouterConfig returns the latest router config from the CDN
	// If the Config is nil, no new config is available and the current config should be used.
	// and updates the latest router config version. This method is only used for the initial config
	GetRouterConfig(ctx context.Context) (*routerconfig.Response, error)
	// Stop stops the config poller. After calling stop, the config poller cannot be used again.
	Stop(ctx context.Context) error
}

type configPoller struct {
	graphApiToken             string
	logger                    *zap.Logger
	latestRouterConfigVersion string
	latestRouterConfigDate    time.Time
	poller                    controlplane.Poller
	pollInterval              time.Duration
	pollJitter                time.Duration
	configClient              routerconfig.Client
	fallbackConfigClient      *routerconfig.Client
	demoMode                  bool
}

func New(token string, opts ...Option) ConfigPoller {
	c := &configPoller{
		graphApiToken: token,
	}

	for _, opt := range opts {
		opt(c)
	}

	if c.logger == nil {
		c.logger = zap.NewNop()
	}

	c.poller = controlplane.NewPoll(c.pollInterval, c.pollJitter)

	return c
}

func (c *configPoller) Version() string {
	return c.latestRouterConfigVersion
}

// Stop stops the config poller
func (c *configPoller) Stop(_ context.Context) error {
	return c.poller.Stop()
}

func (c *configPoller) Subscribe(ctx context.Context, handler func(newConfig *nodev1.RouterConfig, _ string) error) {
	c.poller.Subscribe(ctx, func() {
		start := time.Now()

		cfg, err := c.getRouterConfig(ctx)
		if err != nil {
			if errors.Is(err, ErrConfigNotModified) {
				c.logger.Debug("No new router config available. Trying again ...",
					zap.String("poll_interval", c.pollInterval.String()),
					zap.String("fetch_time", time.Since(start).String()),
				)
				return
			}
			c.logger.Error("Error fetching router config", zap.Error(err))
			return
		}

		c.logger.Debug("Fetched router config", zap.String("version", cfg.Config.GetVersion()))

		newVersion := cfg.Config.GetVersion()
		latestVersion := c.latestRouterConfigVersion

		// If the version hasn't changed, don't invoke the handler
		if newVersion == latestVersion {
			c.logger.Debug("Router config version has not changed, skipping handler invocation")
			return
		}

		c.logger.Info("Router execution config has changed, hot reloading server",
			zap.String("old_version", latestVersion),
			zap.String("new_version", newVersion),
			zap.String("fetch_time", time.Since(start).String()),
		)

		start = time.Now()

		if err := handler(cfg.Config, c.latestRouterConfigVersion); err != nil {
			c.logger.Error("Error invoking config poll handler", zap.Error(err))
			return
		}

		c.logger.Debug(
			"New graph server swapped",
			zap.String("duration", time.Since(start).String()),
			zap.String("config_version", newVersion),
		)

		// Only update the versions if the handler was invoked successfully
		c.latestRouterConfigVersion = cfg.Config.GetVersion()
		c.latestRouterConfigDate = time.Now().UTC()
	})
}

func (c *configPoller) getRouterConfig(ctx context.Context) (*routerconfig.Response, error) {
	if c.configClient == nil && c.demoMode {
		c.logger.Warn("The router is running in demo mode without an execution configuration source, using a demo execution config for testing purposes.")
		return &routerconfig.Response{Config: routerconfig.GetDefaultConfig()}, nil
	}

	if c.configClient == nil {
		return nil, errors.New("no execution configuration source found")
	}

	config, err := c.configClient.RouterConfig(ctx, c.latestRouterConfigVersion, c.latestRouterConfigDate)
	if err == nil {
		return config, nil
	}

	if errors.Is(err, ErrConfigNotModified) {
		return nil, err
	}

	if c.demoMode && c.fallbackConfigClient == nil && errors.Is(err, ErrConfigNotFound) {
		c.logger.Warn("The router is running in demo mode and no execution config has been found, using a demo execution config for testing purposes.")
		return &routerconfig.Response{Config: routerconfig.GetDefaultConfig()}, nil
	}

	if c.fallbackConfigClient == nil {
		return nil, err
	}

	c.logger.Warn("Failed to retrieve execution config. Attempting with fallback storage")

	config, err = (*c.fallbackConfigClient).RouterConfig(ctx, c.latestRouterConfigVersion, c.latestRouterConfigDate)
	if c.demoMode && errors.Is(err, ErrConfigNotFound) {
		return &routerconfig.Response{Config: routerconfig.GetDefaultConfig()}, nil
	}
	if err != nil {
		return nil, err
	}

	return config, err
}

// GetRouterConfig fetches the latest router config from the provider. Not safe for concurrent use.
func (c *configPoller) GetRouterConfig(ctx context.Context) (*routerconfig.Response, error) {
	cfg, err := c.getRouterConfig(ctx)
	if err == nil {
		c.latestRouterConfigVersion = cfg.Config.GetVersion()
		c.latestRouterConfigDate = time.Now().UTC()
	}
	return cfg, err
}

func WithLogger(logger *zap.Logger) Option {
	return func(s *configPoller) {
		s.logger = logger
	}
}

func WithPolling(interval time.Duration, jitter time.Duration) Option {
	return func(s *configPoller) {
		s.pollInterval = interval
		s.pollJitter = jitter
	}
}

func WithClient(client routerconfig.Client) Option {
	return func(s *configPoller) {
		s.configClient = client
	}
}

func WithFallbackClient(client *routerconfig.Client) Option {
	return func(s *configPoller) {
		s.fallbackConfigClient = client
	}
}

func WithDemoMode(demoMode bool) Option {
	return func(s *configPoller) {
		s.demoMode = demoMode
	}
}
