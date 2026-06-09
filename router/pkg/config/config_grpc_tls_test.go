package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGRPCClientTLSConfiguration_Enabled(t *testing.T) {
	t.Parallel()

	t.Run("zero value means TLS is disabled", func(t *testing.T) {
		t.Parallel()
		var cfg GRPCClientTLSConfiguration
		assert.False(t, cfg.Enabled())
	})

	t.Run("all.enabled=true means TLS is enabled", func(t *testing.T) {
		t.Parallel()
		cfg := GRPCClientTLSConfiguration{
			All: GRPCTLSClientCertConfiguration{Enabled: true},
		}
		assert.True(t, cfg.Enabled())
	})

	t.Run("all.enabled=false with no subgraphs means TLS is disabled", func(t *testing.T) {
		t.Parallel()
		cfg := GRPCClientTLSConfiguration{
			All: GRPCTLSClientCertConfiguration{Enabled: false},
		}
		assert.False(t, cfg.Enabled())
	})

	t.Run("subgraph enabled=true returns true regardless of global settings", func(t *testing.T) {
		t.Parallel()
		cfg := GRPCClientTLSConfiguration{
			All: GRPCTLSClientCertConfiguration{Enabled: false},
			Subgraphs: map[string]GRPCTLSClientCertConfiguration{
				"products": {Enabled: true},
			},
		}
		assert.True(t, cfg.Enabled())
	})

	t.Run("all subgraphs disabled means TLS is disabled", func(t *testing.T) {
		t.Parallel()
		cfg := GRPCClientTLSConfiguration{
			Subgraphs: map[string]GRPCTLSClientCertConfiguration{
				"products": {Enabled: false},
				"orders":   {Enabled: false},
			},
		}
		assert.False(t, cfg.Enabled())
	})
}

func TestGRPCClientTLSConfiguration_LoadFromYAML(t *testing.T) {
	t.Parallel()

	t.Run("global config only", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: true
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		grpc := cfg.Config.TLS.ClientGRPC
		assert.True(t, grpc.All.Enabled)
		assert.Empty(t, grpc.Subgraphs)
		assert.True(t, grpc.Enabled())
	})

	t.Run("per-subgraph config only, no global", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    subgraphs:
      products:
        enabled: true
      orders:
        enabled: false
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		grpc := cfg.Config.TLS.ClientGRPC
		assert.False(t, grpc.All.Enabled)
		require.Len(t, grpc.Subgraphs, 2)
		assert.True(t, grpc.Subgraphs["products"].Enabled)
		assert.False(t, grpc.Subgraphs["orders"].Enabled)
		assert.True(t, grpc.Enabled())
	})

	t.Run("global and per-subgraph configs together", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: true
      ca_file: "ca.pem"
    subgraphs:
      products:
        enabled: true
        cert_file: "client.pem"
        key_file: "client.key"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		grpc := cfg.Config.TLS.ClientGRPC
		assert.True(t, grpc.All.Enabled)
		assert.Equal(t, "ca.pem", grpc.All.CaFile)
		require.Len(t, grpc.Subgraphs, 1)
		assert.Equal(t, "client.pem", grpc.Subgraphs["products"].CertFile)
		assert.Equal(t, "client.key", grpc.Subgraphs["products"].KeyFile)
	})

	t.Run("insecure_skip_ca_verification without cert files is valid", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: true
      insecure_skip_ca_verification: true
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		grpc := cfg.Config.TLS.ClientGRPC
		assert.True(t, grpc.All.Enabled)
		assert.True(t, grpc.All.InsecureSkipCaVerification)
	})

	t.Run("ca_file without cert pair is valid", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: true
      ca_file: "ca.pem"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		grpc := cfg.Config.TLS.ClientGRPC
		assert.True(t, grpc.All.Enabled)
		assert.Equal(t, "ca.pem", grpc.All.CaFile)
		assert.Empty(t, grpc.All.CertFile)
		assert.Empty(t, grpc.All.KeyFile)
	})

	t.Run("all.enabled=false is a valid explicit disable", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: false
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		assert.False(t, cfg.Config.TLS.ClientGRPC.All.Enabled)
		assert.False(t, cfg.Config.TLS.ClientGRPC.Enabled())
	})

	t.Run("multiple subgraphs with different settings", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    subgraphs:
      products:
        enabled: true
        cert_file: "products-client.pem"
        key_file: "products-client.key"
        ca_file: "products-ca.pem"
      orders:
        enabled: true
        insecure_skip_ca_verification: true
      inventory:
        enabled: false
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		subgraphs := cfg.Config.TLS.ClientGRPC.Subgraphs
		require.Len(t, subgraphs, 3)
		assert.Equal(t, "products-client.pem", subgraphs["products"].CertFile)
		assert.True(t, subgraphs["orders"].InsecureSkipCaVerification)
		assert.False(t, subgraphs["inventory"].Enabled)
	})
}

func TestGRPCClientTLSConfiguration_LoadFromEnv(t *testing.T) {
	t.Setenv("TLS_CLIENT_GRPC_ALL_ENABLED", "true")
	t.Setenv("TLS_CLIENT_GRPC_ALL_CERT_FILE", "client.pem")
	t.Setenv("TLS_CLIENT_GRPC_ALL_KEY_FILE", "client.key")
	t.Setenv("TLS_CLIENT_GRPC_ALL_CA_FILE", "ca.pem")
	t.Setenv("TLS_CLIENT_GRPC_ALL_INSECURE_SKIP_CA_VERIFICATION", "true")

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"
`)
	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)

	grpc := cfg.Config.TLS.ClientGRPC
	require.True(t, grpc.All.Enabled)
	require.Equal(t, "client.pem", grpc.All.CertFile)
	require.Equal(t, "client.key", grpc.All.KeyFile)
	require.Equal(t, "ca.pem", grpc.All.CaFile)
	require.True(t, grpc.All.InsecureSkipCaVerification)
	require.Empty(t, grpc.Subgraphs)
}

func TestGRPCClientTLSConfiguration_SchemaValidation(t *testing.T) {
	t.Parallel()

	t.Run("missing enabled in global config fails", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      ca_file: "ca.pem"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "enabled")
	})

	t.Run("missing enabled in subgraph entry fails", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    subgraphs:
      products:
        ca_file: "ca.pem"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "enabled")
	})

	t.Run("cert_file without key_file in global config fails", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: true
      cert_file: "client.pem"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "key_file")
	})

	t.Run("key_file without cert_file in global config fails", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: true
      key_file: "client.key"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "cert_file")
	})

	t.Run("cert_file without key_file in per-subgraph config fails", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    subgraphs:
      products:
        enabled: true
        cert_file: "client.pem"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "key_file")
	})

	t.Run("key_file without cert_file in per-subgraph config fails", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    subgraphs:
      products:
        enabled: true
        key_file: "client.key"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
		require.ErrorContains(t, err, "cert_file")
	})

	t.Run("unknown field in all is rejected", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    all:
      enabled: true
      unknown_field: "value"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
	})

	t.Run("unknown field in per-subgraph config is rejected", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client_grpc:
    subgraphs:
      products:
        enabled: true
        unknown_field: "value"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
	})
}
