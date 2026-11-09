package core

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestBuildTLSClientConfig(t *testing.T) {
	t.Parallel()

	t.Run("returns config with insecure_skip_ca_verification only", func(t *testing.T) {
		t.Parallel()

		tlsCfg, err := buildTLSClientConfig(config.TLSClientCertConfiguration{
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

		tlsCfg, err := buildTLSClientConfig(config.TLSClientCertConfiguration{
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

		tlsCfg, err := buildTLSClientConfig(config.TLSClientCertConfiguration{
			CaFile: certPath,
		})
		require.NoError(t, err)
		require.NotNil(t, tlsCfg)
		require.NotNil(t, tlsCfg.RootCAs)
	})

	t.Run("errors on invalid cert path", func(t *testing.T) {
		t.Parallel()

		_, err := buildTLSClientConfig(config.TLSClientCertConfiguration{
			CertFile: "/nonexistent/cert.pem",
			KeyFile:  "/nonexistent/key.pem",
		})
		require.Error(t, err)
		require.EqualError(t, err, "failed to load client TLS cert and key: open /nonexistent/cert.pem: no such file or directory")
	})

	t.Run("errors on invalid CA path", func(t *testing.T) {
		t.Parallel()

		_, err := buildTLSClientConfig(config.TLSClientCertConfiguration{
			CaFile: "/nonexistent/ca.pem",
		})
		require.Error(t, err)
		require.EqualError(t, err, "failed to read client TLS CA file: open /nonexistent/ca.pem: no such file or directory")
	})

	t.Run("returns nil when no TLS configured", func(t *testing.T) {
		t.Parallel()

		defaultTLS, perSubgraphTLS, err := buildSubgraphHTTPTLSConfigs(zap.NewNop(), &config.HTTPClientTLSConfiguration{})
		require.NoError(t, err)
		require.Nil(t, defaultTLS)
		require.Nil(t, perSubgraphTLS)
	})

	t.Run("builds global client TLS config", func(t *testing.T) {
		t.Parallel()

		certPath, keyPath := generateTestCert(t, "client")
		caPath, _ := generateTestCert(t, "ca")

		all := config.HTTPTLSClientCertConfiguration{
			TLSClientCertConfiguration: config.TLSClientCertConfiguration{
				CertFile: certPath,
				KeyFile:  keyPath,
				CaFile:   caPath,
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphHTTPTLSConfigs(zap.NewNop(), &config.HTTPClientTLSConfiguration{All: all})
		require.NoError(t, err)
		require.NotNil(t, defaultTLS)
		require.Len(t, defaultTLS.Certificates, 1)
		require.NotNil(t, defaultTLS.RootCAs)
		require.Empty(t, perSubgraphTLS)
	})

	t.Run("builds per-subgraph TLS config", func(t *testing.T) {
		t.Parallel()

		certPath, keyPath := generateTestCert(t, "products")

		subgraphs := map[string]config.HTTPTLSClientCertConfiguration{
			"products": {
				TLSClientCertConfiguration: config.TLSClientCertConfiguration{
					CertFile: certPath,
					KeyFile:  keyPath,
				},
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphHTTPTLSConfigs(zap.NewNop(), &config.HTTPClientTLSConfiguration{Subgraphs: subgraphs})
		require.NoError(t, err)
		require.Nil(t, defaultTLS)
		require.Contains(t, perSubgraphTLS, "products")
		require.Len(t, perSubgraphTLS["products"].Certificates, 1)
	})

	t.Run("builds both global and per-subgraph TLS config", func(t *testing.T) {
		t.Parallel()

		globalCert, globalKey := generateTestCert(t, "global")
		productsCert, productsKey := generateTestCert(t, "products")

		all := config.HTTPTLSClientCertConfiguration{
			TLSClientCertConfiguration: config.TLSClientCertConfiguration{
				CertFile: globalCert,
				KeyFile:  globalKey,
			},
		}
		subgraphs := map[string]config.HTTPTLSClientCertConfiguration{
			"products": {
				TLSClientCertConfiguration: config.TLSClientCertConfiguration{
					CertFile: productsCert,
					KeyFile:  productsKey,
				},
			},
		}

		defaultTLS, perSubgraphTLS, err := buildSubgraphHTTPTLSConfigs(zap.NewNop(), &config.HTTPClientTLSConfiguration{All: all, Subgraphs: subgraphs})
		require.NoError(t, err)
		require.NotNil(t, defaultTLS)
		require.Contains(t, perSubgraphTLS, "products")
	})

	t.Run("errors on invalid global cert", func(t *testing.T) {
		t.Parallel()

		all := config.HTTPTLSClientCertConfiguration{
			TLSClientCertConfiguration: config.TLSClientCertConfiguration{
				CertFile: "/nonexistent/cert.pem",
				KeyFile:  "/nonexistent/key.pem",
			},
		}

		_, _, err := buildSubgraphHTTPTLSConfigs(zap.NewNop(), &config.HTTPClientTLSConfiguration{All: all})
		require.Error(t, err)
		require.EqualError(t, err, "failed to build global subgraph TLS config: failed to load client TLS cert and key: open /nonexistent/cert.pem: no such file or directory")
	})

	t.Run("errors on invalid per-subgraph cert", func(t *testing.T) {
		t.Parallel()

		subgraphs := map[string]config.HTTPTLSClientCertConfiguration{
			"products": {
				TLSClientCertConfiguration: config.TLSClientCertConfiguration{
					CertFile: "/nonexistent/cert.pem",
					KeyFile:  "/nonexistent/key.pem",
				},
			},
		}

		_, _, err := buildSubgraphHTTPTLSConfigs(zap.NewNop(), &config.HTTPClientTLSConfiguration{Subgraphs: subgraphs})
		require.Error(t, err)
		require.EqualError(t, err, `failed to build TLS config for subgraph "products": failed to load client TLS cert and key: open /nonexistent/cert.pem: no such file or directory`)
	})

	t.Run("logs warning when global InsecureSkipCaVerification is enabled", func(t *testing.T) {
		t.Parallel()

		core, logs := observer.New(zapcore.WarnLevel)
		logger := zap.New(core)

		all := config.HTTPTLSClientCertConfiguration{
			TLSClientCertConfiguration: config.TLSClientCertConfiguration{
				InsecureSkipCaVerification: true,
			},
		}

		defaultTLS, _, err := buildSubgraphHTTPTLSConfigs(logger, &config.HTTPClientTLSConfiguration{All: all})
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

		subgraphs := map[string]config.HTTPTLSClientCertConfiguration{
			"products": {
				TLSClientCertConfiguration: config.TLSClientCertConfiguration{
					InsecureSkipCaVerification: true,
				},
			},
		}

		_, perSubgraphTLS, err := buildSubgraphHTTPTLSConfigs(logger, &config.HTTPClientTLSConfiguration{Subgraphs: subgraphs})
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

func TestCertReloader(t *testing.T) {
	t.Parallel()

	t.Run("serves the new certificate after reload", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath := filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key")
		oldCertPath, oldKeyPath := generateTestCert(t, "old")
		newCertPath, newKeyPath := generateTestCert(t, "new")
		copyFile(t, oldCertPath, certPath)
		copyFile(t, oldKeyPath, keyPath)

		var reloaders certReloaders
		reloader, err := reloaders.add(certPath, keyPath, "")
		require.NoError(t, err)

		served, err := reloader.getCertificate(nil)
		require.NoError(t, err)
		require.Equal(t, mustReadFile(t, oldCertPath), pemOf(served))

		copyFile(t, newCertPath, certPath)
		copyFile(t, newKeyPath, keyPath)
		require.NoError(t, reloader.reload())

		served, err = reloader.getClientCertificate(nil)
		require.NoError(t, err)
		require.Equal(t, mustReadFile(t, newCertPath), pemOf(served))
	})

	t.Run("keeps the previous certificate when reload fails", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath := filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key")
		oldCertPath, oldKeyPath := generateTestCert(t, "old")
		copyFile(t, oldCertPath, certPath)
		copyFile(t, oldKeyPath, keyPath)

		var reloaders certReloaders
		reloader, err := reloaders.add(certPath, keyPath, "")
		require.NoError(t, err)

		require.NoError(t, os.WriteFile(certPath, []byte("not a certificate"), 0o600))
		require.ErrorContains(t, reloader.reload(), "failed to load tls cert and key")

		served, err := reloader.getCertificate(nil)
		require.NoError(t, err)
		require.Equal(t, mustReadFile(t, oldCertPath), pemOf(served))
	})

	t.Run("reloads the CA pool", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		caPath := filepath.Join(dir, "ca.crt")
		oldCAPath, _ := generateTestCert(t, "old-ca")
		newCAPath, _ := generateTestCert(t, "new-ca")
		copyFile(t, oldCAPath, caPath)

		var reloaders certReloaders
		reloader, err := reloaders.add("", "", caPath)
		require.NoError(t, err)
		require.Nil(t, reloader.cert.Load())
		before := reloader.ca.Load()
		require.NotNil(t, before)

		copyFile(t, newCAPath, caPath)
		require.NoError(t, reloader.reload())
		require.False(t, before.Equal(reloader.ca.Load()))
	})

	t.Run("keeps the previous CA pool when the new certificate loads but the CA does not", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath, caPath := filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key"), filepath.Join(dir, "ca.crt")
		oldCertPath, oldKeyPath := generateTestCert(t, "old")
		newCertPath, newKeyPath := generateTestCert(t, "new")
		copyFile(t, oldCertPath, certPath)
		copyFile(t, oldKeyPath, keyPath)
		copyFile(t, oldCertPath, caPath)

		var reloaders certReloaders
		reloader, err := reloaders.add(certPath, keyPath, caPath)
		require.NoError(t, err)
		oldPool := reloader.ca.Load()

		copyFile(t, newCertPath, certPath)
		copyFile(t, newKeyPath, keyPath)
		require.NoError(t, os.WriteFile(caPath, []byte("not a certificate"), 0o600))
		require.ErrorContains(t, reloader.reload(), "failed to append CA cert to pool")

		// Neither half of the rotation is applied until both halves load.
		served, err := reloader.getCertificate(nil)
		require.NoError(t, err)
		require.Equal(t, mustReadFile(t, oldCertPath), pemOf(served))
		require.True(t, oldPool.Equal(reloader.ca.Load()))
	})

	t.Run("watch picks up a rotation that happened before it started", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath := filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key")
		oldCertPath, oldKeyPath := generateTestCert(t, "old")
		newCertPath, newKeyPath := generateTestCert(t, "new")
		copyFile(t, oldCertPath, certPath)
		copyFile(t, oldKeyPath, keyPath)

		var reloaders certReloaders
		reloader, err := reloaders.add(certPath, keyPath, "")
		require.NoError(t, err)

		copyFile(t, newCertPath, certPath)
		copyFile(t, newKeyPath, keyPath)

		require.NoError(t, reloaders.watch(t.Context(), zap.NewNop(), time.Hour))

		require.Eventually(t, func() bool {
			served, _ := reloader.getCertificate(nil)
			return bytes.Equal(mustReadFile(t, newCertPath), pemOf(served))
		}, 5*time.Second, 20*time.Millisecond)
	})

	t.Run("fails to add when files are missing", func(t *testing.T) {
		t.Parallel()

		var reloaders certReloaders
		_, err := reloaders.add("/nonexistent/tls.crt", "/nonexistent/tls.key", "")
		require.ErrorContains(t, err, "failed to load tls cert and key")
		require.Empty(t, reloaders.list)
	})

	t.Run("watch reloads every registered certificate when a file changes", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath := filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key")
		oldCertPath, oldKeyPath := generateTestCert(t, "old")
		newCertPath, newKeyPath := generateTestCert(t, "new")
		copyFile(t, oldCertPath, certPath)
		copyFile(t, oldKeyPath, keyPath)

		var reloaders certReloaders
		reloader, err := reloaders.add(certPath, keyPath, "")
		require.NoError(t, err)

		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		require.NoError(t, reloaders.watch(ctx, zap.NewNop(), 50*time.Millisecond))

		// The watcher captures the mod time on its first tick. Give it one before rotating.
		time.Sleep(100 * time.Millisecond)
		copyFile(t, newCertPath, certPath)
		copyFile(t, newKeyPath, keyPath)

		require.Eventually(t, func() bool {
			served, _ := reloader.getCertificate(nil)
			return bytes.Equal(mustReadFile(t, newCertPath), pemOf(served))
		}, 5*time.Second, 20*time.Millisecond)
	})

	t.Run("watch is a no-op without registered files", func(t *testing.T) {
		t.Parallel()

		var reloaders certReloaders
		require.NoError(t, reloaders.watch(t.Context(), zap.NewNop(), time.Second))
	})
}

func copyFile(t *testing.T, src, dst string) {
	t.Helper()
	data, err := os.ReadFile(src)
	require.NoError(t, err)
	// mtime resolution on some file systems is coarse. Bump it explicitly so a watcher sees the change.
	require.NoError(t, os.WriteFile(dst, data, 0o600))
	now := time.Now().Add(time.Second)
	require.NoError(t, os.Chtimes(dst, now, now))
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return data
}

func pemOf(cert *tls.Certificate) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]})
}
