// Package jwtauthextension implements a server authenticator that validates HMAC-signed JWTs and
// exposes their claims as client auth data.
//
// It was previously maintained in github.com/wundergraph/opentelemetry-collector-contrib and is
// kept here so it is built and upgraded together with the Cosmo collector.
package jwtauthextension

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"

	"github.com/wundergraph/cosmo/otelcollector/extension/jwtauthextension/internal/metadata"
)

const defaultAttribute = "authorization"

// NewFactory creates a factory for the JWT authenticator extension.
func NewFactory() extension.Factory {
	return extension.NewFactory(
		metadata.Type,
		createDefaultConfig,
		createExtension,
		metadata.ExtensionStability,
	)
}

func createDefaultConfig() component.Config {
	return &Config{
		Attribute: defaultAttribute,
	}
}

func createExtension(_ context.Context, set extension.Settings, cfg component.Config) (extension.Extension, error) {
	return newExtension(cfg.(*Config), set.Logger)
}
