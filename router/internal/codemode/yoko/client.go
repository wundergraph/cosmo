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

// Search resolves prompts against the indexed schema by fanning out one
// GenerateQuery RPC per prompt. The per-prompt Resolutions are merged into a
// single aggregated Resolution. If any RPC returns NotFound (yoko evicted the
// schema), the cached schema_id is invalidated and the entire batch is retried
// once.
func (c *Client) Search(ctx context.Context, prompts []string) (*yokov1.Resolution, error) {
	schemaID, err := c.ensureSchemaID(ctx)
	if err != nil {
		return nil, err
	}

	resolution, err := c.generateAll(ctx, schemaID, prompts)
	if err == nil {
		return resolution, nil
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		return nil, err
	}

	c.invalidateSchemaID(schemaID)

	schemaID, err = c.ensureSchemaID(ctx)
	if err != nil {
		return nil, err
	}

	resolution, err = c.generateAll(ctx, schemaID, prompts)
	if err != nil {
		c.invalidateSchemaID(schemaID)
		return nil, err
	}
	return resolution, nil
}

func (c *Client) SetSchema(sdl string) {
	c.schemaMu.Lock()
	defer c.schemaMu.Unlock()
	c.schemaSDL = sdl
	c.schemaID = ""
}

// EnsureIndexed sends an IndexSchema RPC for the currently-stored SDL and
// caches the resulting schema_id. It is safe to call eagerly (e.g. from a
// background goroutine after SetSchema) so the first user-facing Search
// doesn't pay the IndexSchema round-trip latency. Concurrent callers
// coalesce on the SDL via the underlying single-flight; if an SDL is already
// indexed, the call is a no-op. With an empty SDL the call is a no-op.
func (c *Client) EnsureIndexed(ctx context.Context) error {
	if c.Schema() == "" {
		return nil
	}
	_, err := c.ensureSchemaID(ctx)
	return err
}

func (c *Client) Schema() string {
	c.schemaMu.RLock()
	defer c.schemaMu.RUnlock()
	return c.schemaSDL
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

		resp, err := c.serviceClient.IndexSchema(ctx, connect.NewRequest(&yokov1.IndexSchemaRequest{
			Sdl: sdl,
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

func (c *Client) generateAll(ctx context.Context, schemaID string, prompts []string) (*yokov1.Resolution, error) {
	aggregated := &yokov1.Resolution{}
	for _, prompt := range prompts {
		resp, err := c.serviceClient.GenerateQuery(ctx, connect.NewRequest(&yokov1.GenerateQueryRequest{
			SchemaId: schemaID,
			Prompt:   prompt,
		}))
		if err != nil {
			return nil, err
		}
		r := resp.Msg.GetResolution()
		if r == nil {
			continue
		}
		aggregated.Queries = append(aggregated.Queries, r.GetQueries()...)
		aggregated.Unsatisfied = append(aggregated.Unsatisfied, r.GetUnsatisfied()...)
		if r.GetTruncated() {
			aggregated.Truncated = true
		}
	}
	return aggregated, nil
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
