// Package querygen indexes the router client schema in an external schema
// discovery service and exposes search and query generation on top of it.
//
// The service is content addressed. The address of an index is
// "sha256:" + hex(SHA-256(sdl bytes)), so the router computes it locally and
// holds no state in the service.
package querygen

import (
	"errors"
	"time"

	"go.uber.org/zap"
)

// Default timings. They mirror the documented behaviour of the discovery
// service: GenerateQuery takes 10 to 30 seconds, and a schema of 16,000 lines
// indexes in about 24 seconds.
const (
	DefaultRequestTimeout    = 90 * time.Second
	DefaultIndexPollInterval = 2 * time.Second
	DefaultIndexTimeout      = 10 * time.Minute
)

// Config holds the connection details for the schema discovery service.
type Config struct {
	// URL is the base URL of the service. It must contain a scheme.
	URL string
	// Token is the bearer token. An empty token sends no Authorization header,
	// which the service permits when it runs with authentication off.
	Token string
	// RequestTimeout bounds a single call to the service.
	RequestTimeout time.Duration
	// IndexPollInterval is the wait between two GetIndex calls.
	IndexPollInterval time.Duration
	// IndexTimeout stops a poll loop that never reaches a final status.
	IndexTimeout time.Duration

	Logger *zap.Logger
}

// Validate reports whether the config can build a working client.
func (c *Config) Validate() error {
	if c.URL == "" {
		return errors.New("schema discovery is enabled but no url is configured")
	}
	return nil
}

// withDefaults returns a copy with every zero timing replaced by its default.
func (c Config) withDefaults() Config {
	if c.RequestTimeout <= 0 {
		c.RequestTimeout = DefaultRequestTimeout
	}
	if c.IndexPollInterval <= 0 {
		c.IndexPollInterval = DefaultIndexPollInterval
	}
	if c.IndexTimeout <= 0 {
		c.IndexTimeout = DefaultIndexTimeout
	}
	if c.Logger == nil {
		c.Logger = zap.NewNop()
	}
	return c
}
