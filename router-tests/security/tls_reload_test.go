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
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// testCert is a certificate issued for the tests, valid for localhost and 127.0.0.1 as server and client.
type testCert struct {
	cert    *x509.Certificate
	certPEM []byte
	keyPEM  []byte
}

// issueTestCert creates a self-signed certificate with a fresh key.
func issueTestCert(t *testing.T) *testCert {
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

	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)

	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)

	return &testCert{
		cert:    cert,
		certPEM: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		keyPEM:  pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}),
	}
}

// writeFiles replaces each PEM file by rename; the pair is not replaced atomically.
func (c *testCert) writeFiles(t *testing.T, certPath, keyPath string) {
	t.Helper()

	for path, data := range map[string][]byte{certPath: c.certPEM, keyPath: c.keyPEM} {
		tmp := path + ".tmp"
		require.NoError(t, os.WriteFile(tmp, data, 0o600))
		require.NoError(t, os.Rename(tmp, path))
	}
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
		return nil, fmt.Errorf("unexpected response %s: %s", http.StatusText(res.StatusCode), body.String())
	}

	return res.TLS.PeerCertificates[0], nil
}

func TestTLSCertificateReload(t *testing.T) {
	t.Parallel()

	t.Run("preserves HTTP2 negotiation when client authentication and watching are enabled", func(t *testing.T) {
		t.Parallel()

		tlsConfig := newTestdataCertsServerTLSConfig()
		tlsConfig.Server.ClientAuth = config.TLSClientAuthConfiguration{
			Required: true,
			CertFile: tlsConfig.Server.CertFile,
		}
		tlsConfig.Watch = true
		tlsConfig.WatchInterval = 100 * time.Millisecond

		testenv.Run(t, &testenv.Config{
			TLSConfig: tlsConfig,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, "HTTP/2.0", res.Proto)
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)
		})
	})

	t.Run("serves the replacement server certificate without interrupting traffic when its files change", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath := filepath.Join(dir, "server.crt")
		keyPath := filepath.Join(dir, "server.key")

		oldCert, newCert := issueTestCert(t), issueTestCert(t)
		oldCert.writeFiles(t, certPath, keyPath)

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
			fresh := &http.Client{
				Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}, DisableKeepAlives: true},
				Timeout:   5 * time.Second,
			}

			t.Cleanup(keepAlive.CloseIdleConnections)

			served, err := graphqlPeerCert(*xEnv, keepAlive)
			require.NoError(t, err)
			require.Equal(t, oldCert.cert.Raw, served.Raw)

			// Keep dialing new connections through the rotation. Any failed request is downtime.
			stop := make(chan struct{})

			var (
				requests, failures int
				wg                 sync.WaitGroup
			)

			stopLoad := sync.OnceFunc(func() {
				close(stop)
				wg.Wait()
			})
			t.Cleanup(stopLoad)
			wg.Go(func() {
				for {
					select {
					case <-stop:
						return
					default:
					}

					requests++

					if _, err := graphqlPeerCert(*xEnv, fresh); err != nil {
						failures++
					}
				}
			})

			newCert.writeFiles(t, certPath, keyPath)

			require.Eventually(t, func() bool {
				served, err := graphqlPeerCert(*xEnv, fresh)
				return err == nil && bytes.Equal(served.Raw, newCert.cert.Raw)
			}, 10*time.Second, 50*time.Millisecond, "router did not pick up the new certificate")

			stopLoad()
			require.Positive(t, requests)
			require.Zero(t, failures, "requests failed during certificate rotation")

			// The connection opened before the rotation is still served with the certificate it was established with.
			served, err = graphqlPeerCert(*xEnv, keepAlive)
			require.NoError(t, err)
			require.Equal(t, oldCert.cert.Raw, served.Raw)

			// The listener was never restarted, so the router still answers on the same address.
			require.Contains(t, xEnv.RouterURL, "https://")
		})
	})

	t.Run("presents the replacement client certificate to an HTTP subgraph when its files change", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath := filepath.Join(dir, "client.crt"), filepath.Join(dir, "client.key")
		oldClient, newClient := issueTestCert(t), issueTestCert(t)
		oldClient.writeFiles(t, certPath, keyPath)

		// Trust only the replacement self-signed client certificate.
		pool := x509.NewCertPool()
		pool.AddCert(newClient.cert)

		routerTLS := config.TLSConfiguration{
			Watch:         true,
			WatchInterval: 100 * time.Millisecond,
			Client: config.HTTPClientTLSConfiguration{
				All: config.HTTPTLSClientCertConfiguration{
					TLSClientCertConfiguration: config.TLSClientCertConfiguration{
						CertFile:                   certPath,
						KeyFile:                    keyPath,
						InsecureSkipCaVerification: true,
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{core.WithTLSConfig(routerTLS)},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: &tls.Config{
						ClientAuth: tls.RequireAndVerifyClientCert,
						ClientCAs:  pool,
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			request := testenv.GraphQLRequest{Query: `query { employees { id } }`}
			res, err := xEnv.MakeGraphQLRequest(request)
			require.NoError(t, err)
			require.Contains(t, res.Body, `Failed to fetch from Subgraph 'employees'`)

			newClient.writeFiles(t, certPath, keyPath)

			require.Eventually(t, func() bool {
				res, err := xEnv.MakeGraphQLRequest(request)

				return err == nil && res.Body == testutils.EmployeesIDData
			}, 10*time.Second, 50*time.Millisecond, "router did not present the new client certificate")
		})
	})

	t.Run("presents the replacement client certificate to a gRPC subgraph when its files change", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath := filepath.Join(dir, "client.crt"), filepath.Join(dir, "client.key")
		oldClient, newClient := issueTestCert(t), issueTestCert(t)
		oldClient.writeFiles(t, certPath, keyPath)

		// Trust only the replacement self-signed client certificate.
		pool := x509.NewCertPool()
		pool.AddCert(newClient.cert)

		routerTLS := config.TLSConfiguration{
			Watch:         true,
			WatchInterval: 100 * time.Millisecond,
			ClientGRPC: config.GRPCClientTLSConfiguration{
				All: config.GRPCTLSClientCertConfiguration{
					Enabled: true,
					TLSClientCertConfiguration: config.TLSClientCertConfiguration{
						CertFile:                   certPath,
						KeyFile:                    keyPath,
						InsecureSkipCaVerification: true,
					},
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
			RouterOptions:            []core.Option{core.WithTLSConfig(routerTLS)},
			Subgraphs: testenv.SubgraphsConfig{
				Projects: testenv.SubgraphConfig{
					GRPCTLSConfig: &tls.Config{
						Certificates: []tls.Certificate{issueTestCert(t).tlsCertificate(t)},
						ClientAuth:   tls.RequireAndVerifyClientCert,
						ClientCAs:    pool,
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			request := testenv.GraphQLRequest{Query: `query { projects { id name } }`}
			res, err := xEnv.MakeGraphQLRequest(request)
			require.NoError(t, err)
			require.Contains(t, res.Body, "Failed to fetch from Subgraph")

			newClient.writeFiles(t, certPath, keyPath)

			// gRPC redials with backoff after a failed handshake.
			require.Eventually(t, func() bool {
				res, err := xEnv.MakeGraphQLRequest(request)

				return err == nil && res.Body == projectsExpectedData
			}, 30*time.Second, 200*time.Millisecond, "router did not present the new client certificate to the gRPC subgraph")
		})
	})
}
