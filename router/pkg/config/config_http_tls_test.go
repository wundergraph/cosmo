package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHTTPClientTLSConfiguration_Enabled(t *testing.T) {
	t.Parallel()

	t.Run("zero value means no TLS settings configured", func(t *testing.T) {
		t.Parallel()
		var cfg HTTPClientTLSConfiguration
		assert.False(t, cfg.Enabled())
	})

	t.Run("all.cert_file set means TLS is enabled", func(t *testing.T) {
		t.Parallel()
		cfg := HTTPClientTLSConfiguration{
			All: HTTPTLSClientCertConfiguration{
				TLSClientCertConfiguration: TLSClientCertConfiguration{CertFile: "client.pem"},
			},
		}
		assert.True(t, cfg.Enabled())
	})

	t.Run("all.key_file set means TLS is enabled", func(t *testing.T) {
		t.Parallel()
		cfg := HTTPClientTLSConfiguration{
			All: HTTPTLSClientCertConfiguration{
				TLSClientCertConfiguration: TLSClientCertConfiguration{KeyFile: "client.key"},
			},
		}
		assert.True(t, cfg.Enabled())
	})

	t.Run("all.ca_file set means TLS is enabled", func(t *testing.T) {
		t.Parallel()
		cfg := HTTPClientTLSConfiguration{
			All: HTTPTLSClientCertConfiguration{
				TLSClientCertConfiguration: TLSClientCertConfiguration{CaFile: "ca.pem"},
			},
		}
		assert.True(t, cfg.Enabled())
	})

	t.Run("all.insecure_skip_ca_verification=true means TLS is enabled", func(t *testing.T) {
		t.Parallel()
		cfg := HTTPClientTLSConfiguration{
			All: HTTPTLSClientCertConfiguration{
				TLSClientCertConfiguration: TLSClientCertConfiguration{InsecureSkipCaVerification: true},
			},
		}
		assert.True(t, cfg.Enabled())
	})

	t.Run("any subgraph entry means TLS is enabled regardless of cert fields", func(t *testing.T) {
		t.Parallel()
		cfg := HTTPClientTLSConfiguration{
			Subgraphs: map[string]HTTPTLSClientCertConfiguration{
				"products": {},
			},
		}
		assert.True(t, cfg.Enabled())
	})

	t.Run("empty subgraphs map means TLS is disabled", func(t *testing.T) {
		t.Parallel()
		cfg := HTTPClientTLSConfiguration{
			Subgraphs: map[string]HTTPTLSClientCertConfiguration{},
		}
		assert.False(t, cfg.Enabled())
	})
}

func TestHTTPClientTLSConfiguration_LoadFromYAML(t *testing.T) {
	t.Parallel()

	t.Run("global config only", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client:
    all:
      cert_file: "client.pem"
      key_file: "client.key"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		client := cfg.Config.TLS.Client
		assert.Equal(t, "client.pem", client.All.CertFile)
		assert.Equal(t, "client.key", client.All.KeyFile)
		assert.Empty(t, client.Subgraphs)
		assert.True(t, client.Enabled())
	})

	t.Run("per-subgraph config only, no global", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client:
    subgraphs:
      products:
        cert_file: "products-client.pem"
        key_file: "products-client.key"
      orders:
        ca_file: "orders-ca.pem"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		client := cfg.Config.TLS.Client
		assert.Empty(t, client.All.CertFile)
		require.Len(t, client.Subgraphs, 2)
		assert.Equal(t, "products-client.pem", client.Subgraphs["products"].CertFile)
		assert.Equal(t, "products-client.key", client.Subgraphs["products"].KeyFile)
		assert.Equal(t, "orders-ca.pem", client.Subgraphs["orders"].CaFile)
		assert.True(t, client.Enabled())
	})

	t.Run("global and per-subgraph configs together", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client:
    all:
      ca_file: "ca.pem"
    subgraphs:
      products:
        cert_file: "client.pem"
        key_file: "client.key"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		client := cfg.Config.TLS.Client
		assert.Equal(t, "ca.pem", client.All.CaFile)
		require.Len(t, client.Subgraphs, 1)
		assert.Equal(t, "client.pem", client.Subgraphs["products"].CertFile)
		assert.Equal(t, "client.key", client.Subgraphs["products"].KeyFile)
		assert.True(t, client.Enabled())
	})

	t.Run("insecure_skip_ca_verification without cert files is valid", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client:
    all:
      insecure_skip_ca_verification: true
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		client := cfg.Config.TLS.Client
		assert.True(t, client.All.InsecureSkipCaVerification)
		assert.Empty(t, client.All.CertFile)
		assert.Empty(t, client.All.KeyFile)
		assert.True(t, client.Enabled())
	})

	t.Run("ca_file without cert pair is valid", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client:
    all:
      ca_file: "ca.pem"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		client := cfg.Config.TLS.Client
		assert.Equal(t, "ca.pem", client.All.CaFile)
		assert.Empty(t, client.All.CertFile)
		assert.Empty(t, client.All.KeyFile)
		assert.True(t, client.Enabled())
	})

	t.Run("no tls.client section means TLS is disabled", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		assert.False(t, cfg.Config.TLS.Client.Enabled())
	})

	t.Run("multiple subgraphs with different settings", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client:
    subgraphs:
      products:
        cert_file: "products-client.pem"
        key_file: "products-client.key"
        ca_file: "products-ca.pem"
      orders:
        insecure_skip_ca_verification: true
      inventory:
        ca_file: "inventory-ca.pem"
`)
		cfg, err := LoadConfig([]string{f})
		require.NoError(t, err)

		subgraphs := cfg.Config.TLS.Client.Subgraphs
		require.Len(t, subgraphs, 3)
		assert.Equal(t, "products-client.pem", subgraphs["products"].CertFile)
		assert.Equal(t, "products-ca.pem", subgraphs["products"].CaFile)
		assert.True(t, subgraphs["orders"].InsecureSkipCaVerification)
		assert.Equal(t, "inventory-ca.pem", subgraphs["inventory"].CaFile)
	})
}

func TestHTTPClientTLSConfiguration_LoadFromEnv(t *testing.T) {
	t.Setenv("TLS_CLIENT_ALL_CERT_FILE", "client.pem")
	t.Setenv("TLS_CLIENT_ALL_KEY_FILE", "client.key")
	t.Setenv("TLS_CLIENT_ALL_CA_FILE", "ca.pem")
	t.Setenv("TLS_CLIENT_ALL_INSECURE_SKIP_CA_VERIFICATION", "true")

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"
`)
	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)

	client := cfg.Config.TLS.Client
	require.Equal(t, "client.pem", client.All.CertFile)
	require.Equal(t, "client.key", client.All.KeyFile)
	require.Equal(t, "ca.pem", client.All.CaFile)
	require.True(t, client.All.InsecureSkipCaVerification)
	require.Empty(t, client.Subgraphs)
}

func TestTLSBareEnvVarsDoNotPopulateConfig(t *testing.T) {
	// Setting the bare field names (without any section prefix) must not
	// accidentally populate tls.client or tls.client_grpc. The real env
	// names are assembled from a prefix + field name, e.g.
	// TLS_CLIENT_GRPC_ALL_CERT_FILE, so bare CERT_FILE is inert.
	t.Setenv("CERT_FILE", "should-not-appear.pem")
	t.Setenv("KEY_FILE", "should-not-appear.key")
	t.Setenv("CA_FILE", "should-not-appear-ca.pem")

	f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"
`)
	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)

	client := cfg.Config.TLS.Client
	require.Empty(t, client.All.CertFile)
	require.Empty(t, client.All.KeyFile)
	require.Empty(t, client.All.CaFile)
	require.Empty(t, client.Subgraphs)

	grpc := cfg.Config.TLS.ClientGRPC
	require.Empty(t, grpc.All.CertFile)
	require.Empty(t, grpc.All.KeyFile)
	require.Empty(t, grpc.All.CaFile)
	require.Empty(t, grpc.Subgraphs)
}

func TestHTTPClientTLSConfiguration_SchemaValidation(t *testing.T) {
	t.Parallel()

	t.Run("cert_file without key_file in global config fails", func(t *testing.T) {
		t.Parallel()

		f := createTempFileFromFixture(t, `
version: "1"

graph:
  token: "mytoken"

tls:
  client:
    all:
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
  client:
    all:
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
  client:
    subgraphs:
      products:
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
  client:
    subgraphs:
      products:
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
  client:
    all:
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
  client:
    subgraphs:
      products:
        unknown_field: "value"
`)
		_, err := LoadConfig([]string{f})
		require.Error(t, err)
	})
}
