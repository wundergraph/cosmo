package configpoller

import (
	"context"
	"errors"
	"github.com/wundergraph/cosmo/router/internal/routerconfig"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane"
	"go.uber.org/zap"
)

type Option func(cp *configPoller)

var ErrConfigNotModified = errors.New("config not modified")

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
	controlplaneEndpoint      string
	logger                    *zap.Logger
	latestRouterConfigVersion string
	latestRouterConfigDate    time.Time
	poller                    controlplane.Poller
	pollInterval              time.Duration
	configClient              routerconfig.Client
}

func New(endpoint, token string, opts ...Option) ConfigPoller {
	c := &configPoller{
		controlplaneEndpoint: endpoint,
		graphApiToken:        token,
	}

	for _, opt := range opts {
		opt(c)
	}

	if c.logger == nil {
		c.logger = zap.NewNop()
	}

	c.poller = controlplane.NewPoll(c.pollInterval)

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
		cfg, err := c.getRouterConfig(ctx)
		if err != nil {
			c.logger.Sugar().Errorf("Could not fetch for config update. Trying again in %s", c.pollInterval.String())
			return
		}

		if cfg == nil {
			c.logger.Sugar().Debugf("No new router config available. Trying again in %s", c.pollInterval.String())
			return
		}

		newVersion := cfg.Config.GetVersion()
		latestVersion := c.latestRouterConfigVersion

		// If the version hasn't changed, don't invoke the handler
		if newVersion == latestVersion {
			c.logger.Info("Router config version has not changed, skipping handler invocation")
			return
		}

		if err := handler(cfg.Config, c.latestRouterConfigVersion); err != nil {
			c.logger.Error("Error invoking config poll handler", zap.Error(err))
			return
		}

		// Only update the versions if the handler was invoked successfully
		c.latestRouterConfigVersion = cfg.Config.GetVersion()
		c.latestRouterConfigDate = time.Now().UTC()
	})
}

func (c *configPoller) getRouterConfig(ctx context.Context) (*routerconfig.Response, error) {
	config, err := c.configClient.RouterConfig(ctx, c.latestRouterConfigVersion, c.latestRouterConfigDate)
	if err != nil {
		if errors.Is(err, ErrConfigNotModified) {
			return nil, nil
		}
		return nil, err
	}
	return config, nil
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

func WithPollInterval(interval time.Duration) Option {
	return func(s *configPoller) {
		s.pollInterval = interval
	}
}

func WithClient(cdnConfigClient routerconfig.Client) Option {
	return func(s *configPoller) {
		s.configClient = cdnConfigClient
	}
}
