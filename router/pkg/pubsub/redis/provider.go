package redis

import (
	"context"
)

const providerTypeID = "redis"

// Provider implements the PubSub provider for Redis
type Provider struct {
	id      string
	adapter AdapterInterface
}

// ID returns the provider ID
func (p *Provider) ID() string {
	return p.id
}

// TypeID returns the provider type
func (p *Provider) TypeID() string {
	return providerTypeID
}

// Startup initializes the provider
func (p *Provider) Startup(ctx context.Context) error {
	return p.adapter.Startup(ctx)
}

// Shutdown gracefully shuts down the provider
func (p *Provider) Shutdown(ctx context.Context) error {
	return p.adapter.Shutdown(ctx)
}
