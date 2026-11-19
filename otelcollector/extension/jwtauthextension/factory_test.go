package jwtauthextension

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/extension/extensionauth"
	"go.opentelemetry.io/collector/extension/extensiontest"

	"github.com/wundergraph/cosmo/otelcollector/extension/jwtauthextension/internal/metadata"
)

func TestCreateDefaultConfig(t *testing.T) {
	cfg := createDefaultConfig()

	assert.Equal(t, &Config{Attribute: defaultAttribute}, cfg)
	assert.NoError(t, componenttest.CheckConfigStruct(cfg))
	assert.ErrorIs(t, cfg.(*Config).Validate(), errNoJWTSecretProvided)
}

func TestCreateExtension(t *testing.T) {
	f := NewFactory()
	assert.Equal(t, metadata.Type, f.Type())

	cfg := f.CreateDefaultConfig().(*Config)
	cfg.JWTSecret = "secret"

	ext, err := f.Create(context.Background(), extensiontest.NewNopSettings(metadata.Type), cfg)
	require.NoError(t, err)
	require.NotNil(t, ext)

	_, ok := ext.(extensionauth.Server)
	assert.True(t, ok, "extension must implement extensionauth.Server")

	require.NoError(t, ext.Start(context.Background(), componenttest.NewNopHost()))
	require.NoError(t, ext.Shutdown(context.Background()))
}
