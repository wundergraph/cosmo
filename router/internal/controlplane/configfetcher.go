package controlplane

import (
	"context"
	"fmt"
	"github.com/bufbuild/connect-go"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	"go.uber.org/zap"
	"net/http"
	"sync"
	"time"
)

type Option func(cp *client)

type ConfigFetcher interface {
	Subscribe(ctx context.Context) chan *nodev1.RouterConfig
	GetRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error)
	Version() string
}

type client struct {
	nodeServiceClient    nodev1connect.NodeServiceClient
	graphApiToken        string
	controlplaneEndpoint string
	federatedGraphName   string
	logger               *zap.Logger
	latestRouterVersion  string
	mu                   sync.Mutex
	configCh             chan *nodev1.RouterConfig
	pollInterval         time.Duration
	configFilePath       string
}

func New(opts ...Option) ConfigFetcher {
	c := &client{
		configCh: make(chan *nodev1.RouterConfig),
	}

	for _, opt := range opts {
		opt(c)
	}

	if c.pollInterval == 0 {
		c.pollInterval = 5 * time.Second
	}

	// Uses connect binary protocol by default + gzip compression
	c.nodeServiceClient = nodev1connect.NewNodeServiceClient(http.DefaultClient, c.controlplaneEndpoint)

	return c
}

// Version returns the latest router config version
func (c *client) Version() string {
	return c.latestRouterVersion
}

// Subscribe returns a channel that will receive the latest router config and only if it has changed
func (c *client) Subscribe(ctx context.Context) chan *nodev1.RouterConfig {

	ticker := time.NewTicker(c.pollInterval)

	go func() {
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case <-ticker.C:

				cfg, err := c.getRouterConfigFromCP(ctx)
				if err != nil {
					c.logger.Error("Could not get latest router config, trying again in 10 seconds", zap.Error(err))
					continue
				}

				newVersion := cfg.GetVersion()

				c.mu.Lock()
				latestVersion := c.latestRouterVersion
				c.mu.Unlock()

				if newVersion == latestVersion {
					c.logger.Debug("No new router config available, trying again in 10 seconds")
					continue
				}

				select {
				case c.configCh <- cfg:
					c.mu.Lock()
					c.latestRouterVersion = cfg.GetVersion()
					c.mu.Unlock()

				default:
					c.logger.Warn("Could not proceed new router config, app is still processing the previous one. Please wait for the next update cycle")
				}
			}
		}
	}()

	return c.configCh
}

// getRouterConfigFromCP returns the latest router config from the controlplane
func (c *client) getRouterConfigFromCP(ctx context.Context) (*nodev1.RouterConfig, error) {
	req := connect.NewRequest(&nodev1.GetConfigRequest{
		GraphName: c.federatedGraphName,
	})

	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", c.graphApiToken))

	resp, err := c.nodeServiceClient.GetLatestValidRouterConfig(ctx, req)
	if err != nil {
		return nil, err
	}

	if resp.Msg.GetResponse().GetCode() != cosmo.EnumStatusCode_OK {
		return nil, fmt.Errorf(
			"could not get latest router config: %s, Details: %s",
			resp.Msg.GetResponse().GetCode(),
			resp.Msg.GetResponse().GetDetails(),
		)
	}

	return resp.Msg.GetConfig(), nil
}

// GetRouterConfig returns the latest router config from the controlplane
// and updates the internal version to avoid signaling a config change
func (c *client) GetRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error) {

	c.logger.Info("Fetching initial router configuration from control plane")

	cfg, err := c.getRouterConfigFromCP(ctx)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.latestRouterVersion = cfg.GetVersion()
	c.mu.Unlock()

	return cfg, nil
}

func WithLogger(logger *zap.Logger) Option {
	return func(s *client) {
		s.logger = logger
	}
}

func WithFederatedGraph(name string) Option {
	return func(s *client) {
		s.federatedGraphName = name
	}
}

func WithControlPlaneEndpoint(endpoint string) Option {
	return func(s *client) {
		s.controlplaneEndpoint = endpoint
	}
}

func WithPollInterval(interval time.Duration) Option {
	return func(s *client) {
		s.pollInterval = interval
	}
}

func WithGraphApiToken(token string) Option {
	return func(s *client) {
		s.graphApiToken = token
	}
}
