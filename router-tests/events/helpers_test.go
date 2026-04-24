package events_test

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

const EventWaitTimeout = time.Second * 30

func assertLineEquals(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	line := testenv.ReadSSELine(t, reader)
	assert.Equal(t, expected, line)
}

func assertMultipartPrefix(t *testing.T, reader *bufio.Reader) {
	t.Helper()
	assertLineEquals(t, reader, "")
	assertLineEquals(t, reader, "--graphql")
	assertLineEquals(t, reader, "Content-Type: application/json")
	assertLineEquals(t, reader, "")
}

func assertMultipartValueEventually(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	assert.Eventually(t, func() bool {
		assertMultipartPrefix(t, reader)
		line, _, err := reader.ReadLine()
		assert.NoError(t, err)
		if string(line) == "{}" {
			return false
		}
		assert.Equal(t, expected, string(line))
		return true
	}, EventWaitTimeout, time.Millisecond*100)
}

// tlsCerts holds file paths to TLS certificate files used in tests.
type tlsCerts struct {
	CACertFile     string // self-signed CA certificate (PEM)
	ServerCertFile string // server certificate signed by the CA (PEM, SAN: 127.0.0.1/localhost)
	ServerKeyFile  string // server private key (PEM)
	ClientCertFile string // client certificate signed by the CA, for mTLS (PEM)
	ClientKeyFile  string // client private key, for mTLS (PEM)
}

// generateTLSCerts creates a CA, a server cert (with SAN 127.0.0.1 and localhost), and a
// client cert. All PEM files are written to the test's temp directory and cleaned up automatically.
func generateTLSCerts(t *testing.T) *tlsCerts {
	t.Helper()

	// CA key + self-signed cert
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "events-test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	require.NoError(t, err)
	caCert, err := x509.ParseCertificate(caDER)
	require.NoError(t, err)
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

	// Server key + cert signed by the CA (SAN required for hostname verification)
	serverKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	serverTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:     []string{"localhost"},
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	serverDER, err := x509.CreateCertificate(rand.Reader, serverTemplate, caCert, &serverKey.PublicKey, caKey)
	require.NoError(t, err)
	serverCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverDER})
	serverKeyDER, err := x509.MarshalECPrivateKey(serverKey)
	require.NoError(t, err)
	serverKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: serverKeyDER})

	// Client key + cert signed by the CA (used for mTLS)
	clientKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	clientTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject:      pkix.Name{CommonName: "nats-test-client"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	clientDER, err := x509.CreateCertificate(rand.Reader, clientTemplate, caCert, &clientKey.PublicKey, caKey)
	require.NoError(t, err)
	clientCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: clientDER})
	clientKeyDER, err := x509.MarshalECPrivateKey(clientKey)
	require.NoError(t, err)
	clientKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: clientKeyDER})

	return &tlsCerts{
		CACertFile:     writeTempFile(t, caPEM, certFilePattern),
		ServerCertFile: writeTempFile(t, serverCertPEM, certFilePattern),
		ServerKeyFile:  writeTempFile(t, serverKeyPEM, certFilePattern),
		ClientCertFile: writeTempFile(t, clientCertPEM, certFilePattern),
		ClientKeyFile:  writeTempFile(t, clientKeyPEM, certFilePattern),
	}
}

// writeTempFile writes data to the t's tempfile.
// It uses pattern to create the filename (see os.CreateTemp) and returns that name.
// It lets t fail in case of errors.
func writeTempFile(t *testing.T, data []byte, pattern string) string {
	t.Helper()

	f, err := os.CreateTemp(t.TempDir(), pattern)
	require.NoError(t, err)
	defer func() { _ = f.Close() }()

	_, err = f.Write(data)
	require.NoError(t, err)
	require.NoError(t, f.Close())

	return f.Name()
}
