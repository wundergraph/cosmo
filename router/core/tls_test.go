package core

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestBuildTLSClientConfig(t *testing.T) {
	t.Parallel()

	t.Run("returns config with insecure_skip_ca_verification only", func(t *testing.T) {
		t.Parallel()

		tlsCfg, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			InsecureSkipCaVerification: true,
		})

		require.NoError(t, err)
		require.NotNil(t, tlsCfg)
		require.True(t, tlsCfg.InsecureSkipVerify)
		require.Empty(t, tlsCfg.Certificates)
		require.Nil(t, tlsCfg.RootCAs)
	})

	t.Run("loads client cert and key", func(t *testing.T) {
		t.Parallel()

		certPath, keyPath := generateTestCert(t, "client")

		tlsCfg, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CertFile: certPath,
			KeyFile:  keyPath,
		})

		require.NoError(t, err)
		require.NotNil(t, tlsCfg)
		require.Len(t, tlsCfg.Certificates, 1)
	})

	t.Run("loads CA file", func(t *testing.T) {
		t.Parallel()

		certPath, _ := generateTestCert(t, "ca")

		tlsCfg, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CaFile: certPath,
		})
		require.NoError(t, err)
		require.NotNil(t, tlsCfg)
		require.NotNil(t, tlsCfg.RootCAs)
	})

	t.Run("errors on invalid cert path", func(t *testing.T) {
		t.Parallel()

		_, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CertFile: "/nonexistent/cert.pem",
			KeyFile:  "/nonexistent/key.pem",
		})
		require.Error(t, err)
		require.EqualError(t, err, "failed to load client TLS cert and key: open /nonexistent/cert.pem: no such file or directory")
	})

	t.Run("errors on invalid CA path", func(t *testing.T) {
		t.Parallel()

		_, err := buildTLSClientConfig(&config.TLSClientCertConfiguration{
			CaFile: "/nonexistent/ca.pem",
		})
		require.Error(t, err)
		require.EqualError(t, err, "failed to read client TLS CA file: open /nonexistent/ca.pem: no such file or directory")
	})

	t.Run("returns nil when no TLS configured", func(t *testing.T) {
		t.Parallel()

		cfg := &config.ClientTLSConfiguration{}
		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(zap.NewNop(), cfg)
		require.NoError(t, err)
		require.Nil(t, defaultTLS)
		require.Nil(t, perSubgraphTLS)
	})

	t.Run("builds global client TLS config", func(t *testing.T) {
		t.Parallel()

		certPath, keyPath := generateTestCert(t, "client")
		caPath, _ := generateTestCert(t, "ca")

		cfg := &config.ClientTLSConfiguration{
			All: config.TLSClientCertConfiguration{
				CertFile: certPath,
				KeyFile:  keyPath,
				CaFile:   caPath,
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(zap.NewNop(), cfg)
		require.NoError(t, err)
		require.NotNil(t, defaultTLS)
		require.Len(t, defaultTLS.Certificates, 1)
		require.NotNil(t, defaultTLS.RootCAs)
		require.Empty(t, perSubgraphTLS)
	})

	t.Run("builds per-subgraph TLS config", func(t *testing.T) {
		t.Parallel()

		certPath, keyPath := generateTestCert(t, "products")

		cfg := &config.ClientTLSConfiguration{
			Subgraphs: map[string]config.TLSClientCertConfiguration{
				"products": {
					CertFile: certPath,
					KeyFile:  keyPath,
				},
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(zap.NewNop(), cfg)
		require.NoError(t, err)
		require.Nil(t, defaultTLS)
		require.Contains(t, perSubgraphTLS, "products")
		require.Len(t, perSubgraphTLS["products"].Certificates, 1)
	})

	t.Run("builds both global and per-subgraph TLS config", func(t *testing.T) {
		t.Parallel()

		globalCert, globalKey := generateTestCert(t, "global")
		productsCert, productsKey := generateTestCert(t, "products")

		cfg := &config.ClientTLSConfiguration{
			All: config.TLSClientCertConfiguration{
				CertFile: globalCert,
				KeyFile:  globalKey,
			},
			Subgraphs: map[string]config.TLSClientCertConfiguration{
				"products": {
					CertFile: productsCert,
					KeyFile:  productsKey,
				},
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphTLSConfigs(zap.NewNop(), cfg)
		require.NoError(t, err)
		require.NotNil(t, defaultTLS)
		require.Contains(t, perSubgraphTLS, "products")
	})

	t.Run("errors on invalid global cert", func(t *testing.T) {
		t.Parallel()

		cfg := &config.ClientTLSConfiguration{
			All: config.TLSClientCertConfiguration{
				CertFile: "/nonexistent/cert.pem",
				KeyFile:  "/nonexistent/key.pem",
			},
		}

		_, _, err := buildSubgraphTLSConfigs(zap.NewNop(), cfg)
		require.Error(t, err)
		require.EqualError(t, err, "failed to build global subgraph TLS config: failed to load client TLS cert and key: open /nonexistent/cert.pem: no such file or directory")
	})

	t.Run("errors on invalid per-subgraph cert", func(t *testing.T) {
		t.Parallel()

		cfg := &config.ClientTLSConfiguration{
			Subgraphs: map[string]config.TLSClientCertConfiguration{
				"products": {
					CertFile: "/nonexistent/cert.pem",
					KeyFile:  "/nonexistent/key.pem",
				},
			},
		}

		_, _, err := buildSubgraphTLSConfigs(zap.NewNop(), cfg)
		require.Error(t, err)
		require.EqualError(t, err, `failed to build TLS config for subgraph "products": failed to load client TLS cert and key: open /nonexistent/cert.pem: no such file or directory`)
	})

	t.Run("logs warning when global InsecureSkipCaVerification is enabled", func(t *testing.T) {
		t.Parallel()

		core, logs := observer.New(zapcore.WarnLevel)
		logger := zap.New(core)

		cfg := &config.ClientTLSConfiguration{
			All: config.TLSClientCertConfiguration{
				InsecureSkipCaVerification: true,
			},
		}

		defaultTLS, _, err := buildSubgraphTLSConfigs(logger, cfg)
		require.NoError(t, err)
		require.NotNil(t, defaultTLS)
		require.True(t, defaultTLS.InsecureSkipVerify)

		require.Equal(t, 1, logs.Len())
		require.Equal(t, "Global TLS config has InsecureSkipCaVerification enabled. This is not recommended for production environments.", logs.All()[0].Message)
	})

	t.Run("logs warning when subgraph InsecureSkipCaVerification is enabled", func(t *testing.T) {
		t.Parallel()

		core, logs := observer.New(zapcore.WarnLevel)
		logger := zap.New(core)

		cfg := &config.ClientTLSConfiguration{
			Subgraphs: map[string]config.TLSClientCertConfiguration{
				"products": {
					InsecureSkipCaVerification: true,
				},
			},
		}

		_, perSubgraphTLS, err := buildSubgraphTLSConfigs(logger, cfg)
		require.NoError(t, err)
		require.Contains(t, perSubgraphTLS, "products")
		require.True(t, perSubgraphTLS["products"].InsecureSkipVerify)

		require.Equal(t, 1, logs.Len())
		require.Equal(t, "Subgraph TLS config inherits InsecureSkipCaVerification from global config. This is not recommended for production environments.", logs.All()[0].Message)
		require.Equal(t, "products", logs.All()[0].ContextMap()["subgraph"])
	})
}

// generateTestCert creates a self-signed certificate and key in the given directory.
// Returns the paths to the cert and key files.
func generateTestCert(t *testing.T, prefix string) (certPath, keyPath string) {
	t.Helper()

	dir := t.TempDir()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: prefix + "-test"},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		IsCA:                  true,
		BasicConstraintsValid: true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)

	certPath = filepath.Join(dir, prefix+".crt")
	certFile, err := os.Create(certPath)
	require.NoError(t, err)
	require.NoError(t, pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certDER}))
	require.NoError(t, certFile.Close())

	keyPath = filepath.Join(dir, prefix+".key")
	keyFile, err := os.Create(keyPath)
	require.NoError(t, err)
	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)
	require.NoError(t, pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))
	require.NoError(t, keyFile.Close())

	return certPath, keyPath
}
