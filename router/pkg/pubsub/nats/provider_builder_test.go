package nats

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap/zaptest"
)

func TestBuildNatsOptions(t *testing.T) {
	t.Run("basic configuration", func(t *testing.T) {
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
	})

	t.Run("with token authentication", func(t *testing.T) {
		token := "test-token"
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			Authentication: &config.NatsAuthentication{
				NatsTokenBasedAuthentication: config.NatsTokenBasedAuthentication{
					Token: &token,
				},
			},
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for token options, but we can verify options are present
		require.Greater(t, len(opts), 7) // Basic options (7) + token option
	})

	t.Run("with user/password authentication", func(t *testing.T) {
		username := "user"
		password := "pass"
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			Authentication: &config.NatsAuthentication{
				UserInfo: config.NatsCredentialsAuthentication{
					Username: &username,
					Password: &password,
				},
			},
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for auth options, but we can verify options are present
		require.Greater(t, len(opts), 7) // Basic options (7) + user info option
	})
}

func TestBuildNatsOptionsWithTLS(t *testing.T) {
	t.Run("insecure skip verify", func(t *testing.T) {
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			TLS: &config.NatsTLSConfiguration{
				InsecureSkipVerify: true,
			},
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.Greater(t, len(opts), 7) // base options + TLS option
	})

	t.Run("missing ca file returns error", func(t *testing.T) {
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			TLS: &config.NatsTLSConfiguration{
				CaFile: "/nonexistent/ca.pem",
			},
		}
		logger := zaptest.NewLogger(t)

		_, err := buildNatsOptions(cfg, logger)
		require.ErrorContains(t, err, "failed to read CA file")
	})

	t.Run("cert file without key file returns error", func(t *testing.T) {
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			TLS: &config.NatsTLSConfiguration{
				CertFile: "/tmp/client.crt",
			},
		}
		logger := zaptest.NewLogger(t)

		_, err := buildNatsOptions(cfg, logger)
		require.ErrorContains(t, err, "both cert_file and key_file must be provided")
	})

	t.Run("key file without cert file returns error", func(t *testing.T) {
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			TLS: &config.NatsTLSConfiguration{
				KeyFile: "/tmp/client.key",
			},
		}
		logger := zaptest.NewLogger(t)

		_, err := buildNatsOptions(cfg, logger)
		require.ErrorContains(t, err, "both cert_file and key_file must be provided")
	})

	t.Run("mtls without ca file returns error", func(t *testing.T) {
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			TLS: &config.NatsTLSConfiguration{
				CertFile: "/tmp/client.crt",
				KeyFile:  "/tmp/client.key",
			},
		}
		logger := zaptest.NewLogger(t)

		_, err := buildNatsOptions(cfg, logger)
		require.ErrorContains(t, err, "ca_file is required when mTLS credentials are configured")
	})

	t.Run("ca file only succeeds", func(t *testing.T) {
		caFile, _, _ := generateTestCerts(t)
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			TLS: &config.NatsTLSConfiguration{
				CaFile: caFile,
			},
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.Greater(t, len(opts), 7)
	})

	t.Run("mtls with ca file succeeds", func(t *testing.T) {
		caFile, certFile, keyFile := generateTestCerts(t)
		cfg := config.NatsEventSource{
			ID:  "test-nats",
			URL: "nats://localhost:4222",
			TLS: &config.NatsTLSConfiguration{
				CaFile:   caFile,
				CertFile: certFile,
				KeyFile:  keyFile,
			},
		}
		logger := zaptest.NewLogger(t)

		opts, err := buildNatsOptions(cfg, logger)
		require.NoError(t, err)
		require.Greater(t, len(opts), 7)
	})
}

func TestPubSubProviderBuilderFactory(t *testing.T) {
	t.Run("creates provider with configured adapters", func(t *testing.T) {
		providerId := "test-provider"

		cfg := config.NatsEventSource{
			ID:  providerId,
			URL: "nats://localhost:4222",
		}

		logger := zaptest.NewLogger(t)

		ctx := context.Background()

		builder := NewProviderBuilder(ctx, logger, "host", "addr")
		require.NotNil(t, builder)
		provider, err := builder.BuildProvider(cfg, datasource.ProviderOpts{})
		require.NoError(t, err)

		// Check the returned provider
		natsProvider, ok := provider.(*datasource.PubSubProvider)
		require.True(t, ok)
		assert.NotNil(t, natsProvider.Logger)
		assert.NotNil(t, natsProvider.Adapter)
	})
}

// writeTempPEM writes PEM-encoded bytes to a temp file and returns its path.
func writeTempPEM(t *testing.T, data []byte) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "*.pem")
	require.NoError(t, err)
	_, err = f.Write(data)
	require.NoError(t, err)
	require.NoError(t, f.Close())
	return f.Name()
}

// generateTestCerts creates a self-signed CA, and a client cert signed by that CA.
// Returns (caFile, certFile, keyFile) paths.
func generateTestCerts(t *testing.T) (caFile, certFile, keyFile string) {
	t.Helper()

	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	require.NoError(t, err)
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

	clientKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	clientTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "test-client"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	clientDER, err := x509.CreateCertificate(rand.Reader, clientTemplate, caTemplate, &clientKey.PublicKey, caKey)
	require.NoError(t, err)
	clientCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: clientDER})

	clientKeyDER, err := x509.MarshalECPrivateKey(clientKey)
	require.NoError(t, err)
	clientKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: clientKeyDER})

	return writeTempPEM(t, caPEM), writeTempPEM(t, clientCertPEM), writeTempPEM(t, clientKeyPEM)
}
