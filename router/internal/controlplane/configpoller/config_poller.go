package configpoller

import (
	"context"
	"net/http"
	"time"

	"github.com/hashicorp/go-retryablehttp"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/controlplane"
	"go.uber.org/zap"
)

type Option func(cp *configPoller)

type ConfigPoller interface {
	// Subscribe subscribes to the config poller with a handler function that will be invoked
	// with the latest router config and the previous version string. If the handler takes longer than the poll interval
	// to execute, the next invocation will be skipped.
	Subscribe(ctx context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersion string) error)
	// GetRouterConfig returns the latest router config from the CDN
	// If the Config is nil, no new config is available and the current config should be used.
	// and updates the latest router config version. This method is only used for the initial config
	GetRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error)
	// Stop stops the config poller. After calling stop, the config poller cannot be used again.
	Stop(ctx context.Context) error
}

type configPoller struct {
	graphApiToken             string
	controlplaneEndpoint      string
	logger                    *zap.Logger
	latestRouterConfigVersion string
	poller                    controlplane.Poller
	pollInterval              time.Duration
	cdnConfigClient           *cdn.RouterConfigClient
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

	retryClient := retryablehttp.NewClient()
	retryClient.RetryWaitMax = 60 * time.Second
	retryClient.RetryMax = 5
	retryClient.Backoff = retryablehttp.DefaultBackoff
	retryClient.Logger = nil
	retryClient.RequestLogHook = func(_ retryablehttp.Logger, _ *http.Request, retry int) {
		if retry > 0 {
			c.logger.Info("Fetch router config from controlplane", zap.Int("retry", retry))
		}
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

		newVersion := cfg.GetVersion()
		latestVersion := c.latestRouterConfigVersion

		// If the version hasn't changed, don't invoke the handler
		if newVersion == latestVersion {
			c.logger.Info("Router config version has not changed, skipping handler invocation")
			return
		}

		if err := handler(cfg, c.latestRouterConfigVersion); err != nil {
			c.logger.Error("Error invoking config poll handler", zap.Error(err))
			return
		}

		// only update the version if the handler was invoked successfully
		c.latestRouterConfigVersion = cfg.GetVersion()
	})
}

func (c *configPoller) getRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error) {
	cfg, err := c.cdnConfigClient.RouterConfig(ctx, c.latestRouterConfigVersion)
	if err != nil {
		return nil, err
	}

	return cfg, nil
}

// GetRouterConfig returns the latest router config from the CDN first, if not found then it fetches from the controlplane.
// Not safe for concurrent use.
func (c *configPoller) GetRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error) {
	cfg, err := c.getRouterConfig(ctx)
	if err == nil {
		c.latestRouterConfigVersion = cfg.GetVersion()
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

func WithCDNClient(cdnConfigClient *cdn.RouterConfigClient) Option {
	return func(s *configPoller) {
		s.cdnConfigClient = cdnConfigClient
	}
}
