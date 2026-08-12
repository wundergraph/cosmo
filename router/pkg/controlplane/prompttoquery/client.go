package prompttoquery

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"connectrpc.com/connect"
	"github.com/hashicorp/go-retryablehttp"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	"go.uber.org/zap"
	brotli "go.withmatt.com/connect-brotli"
)

const defaultTimeout = 15 * time.Second

type Option func(*Client)

// Client generates GraphQL operations through the control plane.
type Client struct {
	nodeServiceClient    nodev1connect.NodeServiceClient
	graphAPIToken        string
	controlplaneEndpoint string
	logger               *zap.Logger
	clientTimeout        time.Duration
}

func New(endpoint string, token string, opts ...Option) (*Client, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("controlplane endpoint is required for prompt to query")
	}

	if token == "" {
		return nil, fmt.Errorf("graph api token is required for prompt to query")
	}

	c := &Client{
		controlplaneEndpoint: endpoint,
		graphAPIToken:        token,
		clientTimeout:        defaultTimeout,
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
			c.logger.Info("Generate query through controlplane", zap.Int("retry", retry))
		}
	}

	httpClient := retryClient.StandardClient()
	httpClient.Timeout = c.clientTimeout

	c.nodeServiceClient = nodev1connect.NewNodeServiceClient(httpClient, c.controlplaneEndpoint,
		brotli.WithCompression(),
		connect.WithSendCompression(brotli.Name),
	)

	return c, nil
}

func (c *Client) GenerateQuery(ctx context.Context, schemaVersionID, prompt string) (*nodev1.GenerateQueryResponse, error) {
	req := connect.NewRequest(&nodev1.GenerateQueryRequest{
		Version: schemaVersionID,
		Prompt:  prompt,
	})
	req.Header().Set("Authorization", "Bearer "+c.graphAPIToken)

	resp, err := c.nodeServiceClient.GenerateQuery(ctx, req)
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

func WithLogger(logger *zap.Logger) Option {
	return func(c *Client) {
		c.logger = logger
	}
}

func WithClientTimeout(timeout time.Duration) Option {
	return func(c *Client) {
		c.clientTimeout = timeout
	}
}
