package prompttoquery

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"connectrpc.com/connect"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	brotli "go.withmatt.com/connect-brotli"
)

const clientTimeout = 15 * time.Second

// Client generates GraphQL operations through the control plane.
type Client struct {
	nodeServiceClient nodev1connect.NodeServiceClient
}

func New(endpoint string, transport http.RoundTripper) (*Client, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("controlplane endpoint is required for prompt to query")
	}

	if transport == nil {
		return nil, fmt.Errorf("controlplane transport is required for prompt to query")
	}

	httpClient := &http.Client{
		Transport: transport,
		Timeout:   clientTimeout,
	}

	nodeServiceClient := nodev1connect.NewNodeServiceClient(httpClient, endpoint,
		brotli.WithCompression(),
		connect.WithSendCompression(brotli.Name),
	)

	return &Client{nodeServiceClient: nodeServiceClient}, nil
}

func (c *Client) GenerateQuery(ctx context.Context, schemaVersionID, prompt string) (*nodev1.GenerateQueryResponse, error) {
	req := connect.NewRequest(&nodev1.GenerateQueryRequest{
		Version: schemaVersionID,
		Prompt:  prompt,
	})

	resp, err := c.nodeServiceClient.GenerateQuery(ctx, req)
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}
