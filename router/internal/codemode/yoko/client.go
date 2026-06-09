package yoko

import (
	"context"
	"net/http"
	"sync"

	"connectrpc.com/connect"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
	yokoconnect "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1/yokov1connect"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"
)

type Option func(*Client)

func WithServiceClient(serviceClient yokoconnect.YokoServiceClient) Option {
	return func(c *Client) {
		if serviceClient != nil {
			c.serviceClient = serviceClient
		}
	}
}

type Client struct {
	serviceClient yokoconnect.YokoServiceClient
	logger        *zap.Logger

	schemaMu  sync.RWMutex
	schemaSDL string
	schemaID  string

	indexGroup singleflight.Group
}

func New(httpClient *http.Client, baseURL string, logger *zap.Logger, opts ...Option) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	if logger == nil {
		logger = zap.NewNop()
	}

	client := &Client{
		serviceClient: yokoconnect.NewYokoServiceClient(httpClient, baseURL),
		logger:        logger,
	}
	for _, opt := range opts {
		opt(client)
	}
	return client
}

func (c *Client) Search(ctx context.Context, sessionID string, prompts []string) (*yokov1.SearchResponse, error) {
	schemaID, err := c.ensureSchemaID(ctx)
	if err != nil {
		return nil, err
	}

	resp, err := c.search(ctx, schemaID, sessionID, prompts)
	if err == nil {
		return resp, nil
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		return nil, err
	}

	c.invalidateSchemaID(schemaID)

	schemaID, err = c.ensureSchemaID(ctx)
	if err != nil {
		return nil, err
	}

	resp, err = c.search(ctx, schemaID, sessionID, prompts)
	if err != nil {
		c.invalidateSchemaID(schemaID)
		return nil, err
	}
	return resp, nil
}

func (c *Client) SetSchema(sdl string) {
	c.schemaMu.Lock()
	defer c.schemaMu.Unlock()
	c.schemaSDL = sdl
	c.schemaID = ""
}

func (c *Client) Schema() string {
	c.schemaMu.RLock()
	defer c.schemaMu.RUnlock()
	return c.schemaSDL
}

func (c *Client) EnsureIndexed(ctx context.Context) error {
	_, err := c.ensureSchemaID(ctx)
	return err
}

func (c *Client) ensureSchemaID(ctx context.Context) (string, error) {
	sdl, schemaID := c.schemaState()
	if schemaID != "" {
		return schemaID, nil
	}

	// Key by raw SDL because Yoko, not the router, owns schema identity.
	value, err, _ := c.indexGroup.Do(sdl, func() (any, error) {
		currentSDL, currentSchemaID := c.schemaState()
		if currentSDL == sdl && currentSchemaID != "" {
			return currentSchemaID, nil
		}

		resp, err := c.serviceClient.Index(ctx, connect.NewRequest(&yokov1.IndexRequest{
			SchemaSdl: sdl,
		}))
		if err != nil {
			return "", err
		}

		indexedSchemaID := resp.Msg.GetSchemaId()
		c.cacheSchemaID(currentSDL, indexedSchemaID)
		return indexedSchemaID, nil
	})
	if err != nil {
		return "", err
	}
	return value.(string), nil
}

func (c *Client) search(ctx context.Context, schemaID string, sessionID string, prompts []string) (*yokov1.SearchResponse, error) {
	resp, err := c.serviceClient.Search(ctx, connect.NewRequest(&yokov1.SearchRequest{
		Prompts:   prompts,
		SchemaId:  schemaID,
		SessionId: sessionID,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (c *Client) schemaState() (string, string) {
	c.schemaMu.RLock()
	defer c.schemaMu.RUnlock()
	return c.schemaSDL, c.schemaID
}

func (c *Client) cacheSchemaID(sdl string, schemaID string) {
	c.schemaMu.Lock()
	defer c.schemaMu.Unlock()
	if c.schemaSDL == sdl {
		c.schemaID = schemaID
	}
}

func (c *Client) invalidateSchemaID(schemaID string) {
	c.schemaMu.Lock()
	defer c.schemaMu.Unlock()
	if c.schemaID == schemaID {
		c.schemaID = ""
	}
}
