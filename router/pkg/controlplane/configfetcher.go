package controlplane

import (
	"context"
	"fmt"
	"github.com/bufbuild/connect-go"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"net/http"
	"os"
	"sync"
	"time"
)

type Option func(cp *ConfigFetcher)

type ConfigFetcher struct {
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

func New(opts ...Option) *ConfigFetcher {
	c := &ConfigFetcher{
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
func (c *ConfigFetcher) Version() string {
	return c.latestRouterVersion
}

// Subscribe returns a channel that will receive the latest router config and only if it has changed
func (c *ConfigFetcher) Subscribe(ctx context.Context) chan *nodev1.RouterConfig {

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

				if cfg.GetVersion() == c.latestRouterVersion {
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
func (c *ConfigFetcher) getRouterConfigFromCP(ctx context.Context) (*nodev1.RouterConfig, error) {
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

// serializeConfigFromFile returns the router config read from the file whose path is given in env
func serializeConfigFromFile(path string) (*nodev1.RouterConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg nodev1.RouterConfig
	if err := protojson.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// GetRouterConfig returns the latest router config from the controlplane
// and updates the internal version to avoid signaling a config change
func (c *ConfigFetcher) GetRouterConfig(ctx context.Context) (*nodev1.RouterConfig, error) {
	var cfg *nodev1.RouterConfig
	var err error

	// Read from file if config file path is set or else fetch from control plane
	if c.configFilePath != "" {
		c.logger.Info("Reading initial router configuration from file")
		cfg, err = serializeConfigFromFile(c.configFilePath)
	} else {
		c.logger.Info("Fetching initial router configuration from control plane")
		cfg, err = c.getRouterConfigFromCP(ctx)
	}

	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.latestRouterVersion = cfg.GetVersion()
	c.mu.Unlock()

	return cfg, nil
}

func WithLogger(logger *zap.Logger) Option {
	return func(s *ConfigFetcher) {
		s.logger = logger
	}
}

func WithFederatedGraph(name string) Option {
	return func(s *ConfigFetcher) {
		s.federatedGraphName = name
	}
}

func WithControlPlaneEndpoint(endpoint string) Option {
	return func(s *ConfigFetcher) {
		s.controlplaneEndpoint = endpoint
	}
}

func WithPollInterval(interval time.Duration) Option {
	return func(s *ConfigFetcher) {
		s.pollInterval = interval
	}
}

func WithGraphApiToken(token string) Option {
	return func(s *ConfigFetcher) {
		s.graphApiToken = token
	}
}

func WithConfigFilePath(path string) Option {
	return func(s *ConfigFetcher) {
		s.configFilePath = path
	}
}
