package integration

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// testCert is a certificate issued for the tests, valid for localhost and 127.0.0.1 as server and client.
type testCert struct {
	cert    *x509.Certificate
	certPEM []byte
	keyPEM  []byte
}

// issueTestCert creates a certificate signed by ca, or a self-signed CA when ca is nil.
func issueTestCert(t *testing.T, ca *testCert, caKey *ecdsa.PrivateKey) (*testCert, *ecdsa.PrivateKey) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 62))
	require.NoError(t, err)

	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "tls-reload-test"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1)},
		DNSNames:              []string{"localhost"},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}

	parent, signer := template, key
	if ca != nil {
		parent, signer = ca.cert, caKey
	}

	der, err := x509.CreateCertificate(rand.Reader, template, parent, &key.PublicKey, signer)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)

	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)

	return &testCert{
		cert:    cert,
		certPEM: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		keyPEM:  pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}),
	}, key
}

// replaceFile writes data next to path and renames it into place, the way secret mounts rotate files.
func replaceFile(t *testing.T, path string, data []byte) {
	t.Helper()
	tmp := path + ".tmp"
	require.NoError(t, os.WriteFile(tmp, data, 0o600))
	require.NoError(t, os.Rename(tmp, path))
}

func (c *testCert) tlsCertificate(t *testing.T) tls.Certificate {
	t.Helper()
	cert, err := tls.X509KeyPair(c.certPEM, c.keyPEM)
	require.NoError(t, err)
	return cert
}

// graphqlPeerCert sends the employees query and returns the certificate the router served.
func graphqlPeerCert(ctx testenv.Environment, client *http.Client) (*x509.Certificate, error) {
	req, err := http.NewRequestWithContext(ctx.Context, http.MethodPost, ctx.GraphQLRequestURL(), strings.NewReader(`{"query":"query { employees { id } }"}`))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	var body bytes.Buffer
	if _, err := body.ReadFrom(res.Body); err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK || body.String() != testutils.EmployeesIDData {
		return nil, &unexpectedResponseError{status: res.StatusCode, body: body.String()}
	}
	return res.TLS.PeerCertificates[0], nil
}

type unexpectedResponseError struct {
	status int
	body   string
}

func (e *unexpectedResponseError) Error() string {
	return "unexpected response " + http.StatusText(e.status) + ": " + e.body
}

func TestTLSCertificateReload(t *testing.T) {
	t.Parallel()

	t.Run("serves a rotated server certificate to new connections while traffic keeps flowing", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath := filepath.Join(dir, "server.crt")
		keyPath := filepath.Join(dir, "server.key")

		oldCert, _ := issueTestCert(t, nil, nil)
		newCert, _ := issueTestCert(t, nil, nil)
		replaceFile(t, certPath, oldCert.certPEM)
		replaceFile(t, keyPath, oldCert.keyPEM)

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: certPath,
					KeyFile:  keyPath,
				},
				Watch:         true,
				WatchInterval: 100 * time.Millisecond,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			pool := x509.NewCertPool()
			pool.AddCert(oldCert.cert)
			pool.AddCert(newCert.cert)

			// keepAlive reuses one connection for the whole test. fresh dials a new one per request.
			keepAlive := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}}
			fresh := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}, DisableKeepAlives: true}}

			served, err := graphqlPeerCert(*xEnv, keepAlive)
			require.NoError(t, err)
			require.Equal(t, oldCert.cert.Raw, served.Raw)

			// Keep dialing new connections through the rotation. Any failed request is downtime.
			stop := make(chan struct{})
			var requests, failures atomic.Int32
			var wg sync.WaitGroup
			wg.Go(func() {
				for {
					select {
					case <-stop:
						return
					default:
					}
					requests.Add(1)
					if _, err := graphqlPeerCert(*xEnv, fresh); err != nil {
						failures.Add(1)
					}
				}
			})

			replaceFile(t, certPath, newCert.certPEM)
			replaceFile(t, keyPath, newCert.keyPEM)

			require.Eventually(t, func() bool {
				served, err := graphqlPeerCert(*xEnv, fresh)
				return err == nil && bytes.Equal(served.Raw, newCert.cert.Raw)
			}, 10*time.Second, 50*time.Millisecond, "router did not pick up the new certificate")

			close(stop)
			wg.Wait()
			require.Positive(t, requests.Load())
			require.Zero(t, failures.Load(), "requests failed during certificate rotation")

			// The connection opened before the rotation is still served with the certificate it was established with.
			served, err = graphqlPeerCert(*xEnv, keepAlive)
			require.NoError(t, err)
			require.Equal(t, oldCert.cert.Raw, served.Raw)

			// The listener was never restarted, so the router still answers on the same address.
			require.Contains(t, xEnv.RouterURL, "https://")
		})
	})

	t.Run("verifies client certificates against a rotated client CA", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath := filepath.Join(dir, "server.crt")
		keyPath := filepath.Join(dir, "server.key")
		caPath := filepath.Join(dir, "client-ca.crt")

		// The server certificate doubles as the initial client CA, which is what the test
		// environment presents as its own client certificate.
		serverCert, _ := issueTestCert(t, nil, nil)
		newCA, newCAKey := issueTestCert(t, nil, nil)
		newClient, _ := issueTestCert(t, newCA, newCAKey)

		replaceFile(t, certPath, serverCert.certPEM)
		replaceFile(t, keyPath, serverCert.keyPEM)
		replaceFile(t, caPath, serverCert.certPEM)

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: certPath,
					KeyFile:  keyPath,
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: true,
						CertFile: caPath,
					},
				},
				Watch:         true,
				WatchInterval: 100 * time.Millisecond,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			pool := x509.NewCertPool()
			pool.AddCert(serverCert.cert)

			newClientHTTP := &http.Client{Transport: &http.Transport{
				DisableKeepAlives: true,
				TLSClientConfig: &tls.Config{
					RootCAs:      pool,
					Certificates: []tls.Certificate{newClient.tlsCertificate(t)},
				},
			}}
			oldClientHTTP := &http.Client{Transport: &http.Transport{
				DisableKeepAlives: true,
				TLSClientConfig: &tls.Config{
					RootCAs:      pool,
					Certificates: []tls.Certificate{serverCert.tlsCertificate(t)},
				},
			}}

			_, err := graphqlPeerCert(*xEnv, newClientHTTP)
			require.ErrorContains(t, err, "tls:")

			_, err = graphqlPeerCert(*xEnv, oldClientHTTP)
			require.NoError(t, err)

			replaceFile(t, caPath, newCA.certPEM)

			require.Eventually(t, func() bool {
				_, err := graphqlPeerCert(*xEnv, newClientHTTP)
				return err == nil
			}, 10*time.Second, 50*time.Millisecond, "router did not pick up the new client CA")

			_, err = graphqlPeerCert(*xEnv, oldClientHTTP)
			require.ErrorContains(t, err, "tls:")
		})
	})
}
