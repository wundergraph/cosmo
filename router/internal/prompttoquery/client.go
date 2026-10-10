package prompttoquery

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"connectrpc.com/connect"
	aiv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/ai/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/ai/v1/aiv1connect"
	brotli "go.withmatt.com/connect-brotli"
)

const clientTimeout = 15 * time.Second

// Client generates GraphQL operations through the control plane.
type Client struct {
	aiServiceClient aiv1connect.AIServiceClient
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

	aiServiceClient := aiv1connect.NewAIServiceClient(httpClient, endpoint,
		brotli.WithCompression(),
		connect.WithSendCompression(brotli.Name),
	)

	return &Client{aiServiceClient: aiServiceClient}, nil
}

func (c *Client) GenerateQuery(ctx context.Context, schemaVersionID, prompt string) (*aiv1.GenerateQueryResponse, error) {
	req := connect.NewRequest(&aiv1.GenerateQueryRequest{
		Version: schemaVersionID,
		Prompt:  prompt,
	})

	resp, err := c.aiServiceClient.GenerateQuery(ctx, req)
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}
