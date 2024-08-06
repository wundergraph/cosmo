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
	"net/http"
	"time"
)

type Option func(cp *selfRegister)

type SelfRegister interface {
	// Register registers the router with the controlplane and returns the registration info
	Register(ctx context.Context) (*nodev1.RegistrationInfo, error)
}

type selfRegister struct {
	nodeServiceClient    nodev1connect.NodeServiceClient
	graphApiToken        string
	controlplaneEndpoint string
	logger               *zap.Logger
}

func New(endpoint, token string, opts ...Option) (SelfRegister, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("controlplane endpoint is required for router registration")
	}

	if token == "" {
		return nil, fmt.Errorf("graph api token is required for router registration")
	}

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
	retryClient.RetryWaitMax = 15 * time.Second
	retryClient.RetryMax = 3
	retryClient.Backoff = retryablehttp.DefaultBackoff
	retryClient.Logger = nil
	retryClient.RequestLogHook = func(_ retryablehttp.Logger, _ *http.Request, retry int) {
		if retry > 0 {
			c.logger.Info("Register router on controlplane", zap.Int("retry", retry))
		}
	}

	// Uses connect binary protocol by default + gzip compression
	c.nodeServiceClient = nodev1connect.NewNodeServiceClient(retryClient.StandardClient(), c.controlplaneEndpoint,
		brotli.WithCompression(),
		// Compress requests with Brotli.
		connect.WithSendCompression(brotli.Name),
	)

	return c, nil
}

func (c *selfRegister) Register(ctx context.Context) (*nodev1.RegistrationInfo, error) {
	c.logger.Debug("Registering router on controlplane")

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
