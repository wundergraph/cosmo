package configpoller

import (
	"connectrpc.com/connect"
	"context"
	"fmt"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	"github.com/wundergraph/cosmo/router/internal/controlplane"
	"go.uber.org/zap"
	brotli "go.withmatt.com/connect-brotli"
	"net/http"
	"sync"
	"time"
)

type Option func(cp *configPoller)

type ConfigPoller interface {
	// Subscribe subscribes to the config poller with a handler function that will be invoked
	// with the latest router config and the previous version string. If the handler takes longer than the poll interval
	// to execute, the next invocation will be skipped.
	Subscribe(ctx context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersion string) error)
	// GetRouterConfig returns the latest router config from the controlplane
	// and updates the latest router config version. This method is only used for the initial config
	GetRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error)
	// Stop stops the config poller. After calling stop, the config poller cannot be used again.
	Stop(ctx context.Context) error
}

type configPoller struct {
	nodeServiceClient         nodev1connect.NodeServiceClient
	graphApiToken             string
	controlplaneEndpoint      string
	federatedGraphName        string
	logger                    *zap.Logger
	latestRouterConfigVersion string
	mu                        sync.Mutex
	poller                    controlplane.Poller
	pollInterval              time.Duration
}

func New(graphName, endpoint, token string, opts ...Option) ConfigPoller {
	c := &configPoller{
		controlplaneEndpoint: endpoint,
		graphApiToken:        token,
		federatedGraphName:   graphName,
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

	// Uses connect binary protocol by default + gzip compression
	c.nodeServiceClient = nodev1connect.NewNodeServiceClient(retryClient.StandardClient(), c.controlplaneEndpoint,
		brotli.WithCompression(),
		// Compress requests with Brotli.
		connect.WithSendCompression(brotli.Name),
	)

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

func (c *configPoller) Subscribe(ctx context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersions string) error) {

	c.poller.Subscribe(ctx, func() {
		cfg, err := c.getRouterConfigFromCP(ctx, &c.latestRouterConfigVersion)
		if err != nil {
			return
		}
		if cfg == nil {
			c.logger.Debug("No new router config available, received nil router config, trying again in 10 seconds")
			return
		}

		newVersion := cfg.GetVersion()

		c.mu.Lock()
		latestVersion := c.latestRouterConfigVersion
		c.mu.Unlock()

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
		c.mu.Lock()
		c.latestRouterConfigVersion = cfg.GetVersion()
		c.mu.Unlock()

		return
	})
}

// getRouterConfigFromCP returns the latest router config from the controlplane
// version can be nil to get the latest version. If version is not nil, it will determine
// if the config has changed and only return non-nil config if it has changed.
func (c *configPoller) getRouterConfigFromCP(ctx context.Context, version *string) (*nodev1.RouterConfig, error) {
	start := time.Now()

	req := connect.NewRequest(&nodev1.GetConfigRequest{
		GraphName: c.federatedGraphName,
		Version:   version,
	})

	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", c.graphApiToken))

	resp, err := c.nodeServiceClient.GetLatestValidRouterConfig(ctx, req)

	c.logger.Debug("Received router config from control plane", zap.Duration("duration", time.Since(start)))

	if err != nil {
		return nil, err
	}

	if resp.Msg.GetResponse().GetCode() != common.EnumStatusCode_OK {
		return nil, fmt.Errorf(
			"could not get latest router config: %s, Details: %s",
			resp.Msg.GetResponse().GetCode(),
			resp.Msg.GetResponse().GetDetails(),
		)
	}

	return resp.Msg.GetConfig(), nil
}

func (c *configPoller) GetRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error) {

	c.logger.Info("Fetching initial router configuration from control plane")

	cfg, err := c.getRouterConfigFromCP(ctx, nil)
	if err != nil {
		return nil, err
	}

	if cfg == nil {
		return nil, fmt.Errorf("received nil router config from control plane")
	}

	c.mu.Lock()
	c.latestRouterConfigVersion = cfg.GetVersion()
	c.mu.Unlock()

	return cfg, nil
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
