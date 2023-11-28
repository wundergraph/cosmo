package selfregister

import (
	"connectrpc.com/connect"
	"context"
	"fmt"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	"go.uber.org/zap"
	brotli "go.withmatt.com/connect-brotli"
	"sync"
	"time"
)

type Option func(cp *selfRegister)

type SelfRegister interface {
	// Register registers the router with the controlplane and returns the registration info
	Register(ctx context.Context) (*nodev1.RegistrationInfo, error)
	// Stop stops the config poller. After calling stop, the config poller cannot be used again.
	Stop(ctx context.Context) error
}

type selfRegister struct {
	nodeServiceClient    nodev1connect.NodeServiceClient
	graphApiToken        string
	controlplaneEndpoint string
	logger               *zap.Logger
	mu                   sync.Mutex
}

func New(endpoint, token string, opts ...Option) SelfRegister {
	c := &selfRegister{
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
	retryClient.RetryWaitMax = 30 * time.Second
	retryClient.RetryMax = 5
	retryClient.Backoff = retryablehttp.DefaultBackoff
	retryClient.Logger = nil

	// Uses connect binary protocol by default + gzip compression
	c.nodeServiceClient = nodev1connect.NewNodeServiceClient(retryClient.StandardClient(), c.controlplaneEndpoint,
		brotli.WithCompression(),
		// Compress requests with Brotli.
		connect.WithSendCompression(brotli.Name),
	)

	return c
}

func (c *selfRegister) Stop(_ context.Context) error {
	return nil
}

func (c *selfRegister) Register(ctx context.Context) (*nodev1.RegistrationInfo, error) {
	c.logger.Info("Self registering router on controlplane")

	req := connect.NewRequest(&nodev1.SelfRegisterRequest{})

	start := time.Now()

	req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", c.graphApiToken))

	resp, err := c.nodeServiceClient.SelfRegister(ctx, req)

	c.logger.Debug("Router self registered on controlplane", zap.Duration("duration", time.Since(start)))

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

	if resp.Msg.GetRegistrationInfo() == nil {
		return nil, fmt.Errorf("registration info is nil")
	}

	return resp.Msg.GetRegistrationInfo(), nil
}

func WithLogger(logger *zap.Logger) Option {
	return func(s *selfRegister) {
		s.logger = logger
	}
}
