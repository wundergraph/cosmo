package integration

import (
	"github.com/wundergraph/cosmo/router-tests/testutils"

	"bytes"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func newTestdataCertsServerTLSConfig() config.TLSConfiguration {
	return config.TLSConfiguration{
		Server: config.TLSServerConfiguration{
			Enabled:  true,
			CertFile: "../testdata/tls/cert.pem",
			KeyFile:  "../testdata/tls/key.pem",
		},
	}
}

// replaceTLSFiles copies a fixture pair to stable paths, renaming each file separately.
func replaceTLSFiles(t *testing.T, dir, certFile, keyFile string) (string, string) {
	t.Helper()

	certPath, keyPath := filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key")
	for src, dst := range map[string]string{certFile: certPath, keyFile: keyPath} {
		data, err := os.ReadFile(src)
		require.NoError(t, err)

		tmp := dst + ".tmp"
		require.NoError(t, os.WriteFile(tmp, data, 0o600))
		require.NoError(t, os.Rename(tmp, dst))
	}

	return certPath, keyPath
}

func TestTLS(t *testing.T) {
	t.Parallel()

	t.Run("serves the replacement server certificate without interrupting traffic when its files change", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		certPath, keyPath := replaceTLSFiles(t, dir, "../testdata/tls/cert-2.pem", "../testdata/tls/key-2.pem")
		oldCert, err := tls.LoadX509KeyPair(certPath, keyPath)
		require.NoError(t, err)
		newCert, err := tls.LoadX509KeyPair("../testdata/tls/cert.pem", "../testdata/tls/key.pem")
		require.NoError(t, err)

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
			pool := loadSubgraphMTLSCACertPool(t, "../testdata/tls/cert-2.pem", "../testdata/tls/cert.pem")
			keepAlive := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}}
			fresh := &http.Client{
				Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}, DisableKeepAlives: true},
				Timeout:   5 * time.Second,
			}

			t.Cleanup(keepAlive.CloseIdleConnections)

			// Use explicit clients without retries so a failed request remains visible.
			probe := func(client *http.Client) (*x509.Certificate, error) {
				req, err := http.NewRequestWithContext(
					xEnv.Context, http.MethodPost, xEnv.GraphQLRequestURL(),
					strings.NewReader(`{"query":"query { employees { id } }"}`),
				)
				if err != nil {
					return nil, err
				}

				req.Header.Set("Content-Type", "application/json")

				res, err := testenv.MakeGraphQLRequestRawFromClient(req, client)
				if err != nil {
					return nil, err
				}

				if res.Response.StatusCode != http.StatusOK || res.Body != testutils.EmployeesIDData {
					return nil, fmt.Errorf("unexpected response %s: %s", res.Response.Status, res.Body)
				}

				return res.Response.TLS.PeerCertificates[0], nil
			}
			served, err := probe(keepAlive)
			require.NoError(t, err)
			require.Equal(t, oldCert.Certificate[0], served.Raw)

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

					if _, err := probe(fresh); err != nil {
						failures++
					}
				}
			})

			replaceTLSFiles(t, dir, "../testdata/tls/cert.pem", "../testdata/tls/key.pem")

			require.Eventually(t, func() bool {
				served, err := probe(fresh)

				return err == nil && bytes.Equal(served.Raw, newCert.Certificate[0])
			}, 10*time.Second, 50*time.Millisecond, "router did not pick up the new certificate")

			stopLoad()
			require.Positive(t, requests)
			require.Zero(t, failures, "requests failed during certificate rotation")

			// The pre-rotation connection must still use the original certificate.
			served, err = probe(keepAlive)
			require.NoError(t, err)
			require.Equal(t, oldCert.Certificate[0], served.Raw)
			require.Contains(t, xEnv.RouterURL, "https://")
		})
	})

	t.Run("Ensure router URL is https when passing TLSConfig", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: newTestdataCertsServerTLSConfig(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Contains(t, xEnv.RouterURL, "https://")
		})
	})

	t.Run("Ensure router URL is not https when no TLSConfig is passed", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{}, // empty on purpose
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Contains(t, xEnv.RouterURL, "http://")
		})
	})

	t.Run("Should be able to establish a HTTP2 connection when TLS is enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: newTestdataCertsServerTLSConfig(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)

			require.Contains(t, res.Proto, "HTTP/2")
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)
		})
	})

	t.Run("TestPlayground", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: newTestdataCertsServerTLSConfig(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodGet, "/", http.Header{
				"Accept": []string{"text/html"},
			}, nil)
			require.NoError(t, err)
			defer res.Body.Close()

			require.Contains(t, res.Header.Get("Content-Type"), "text/html")
			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			require.Contains(t, string(body), `WunderGraph Playground`)
		})
	})

	t.Run("TestQuery", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: newTestdataCertsServerTLSConfig(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)
		})
	})

	t.Run("Can't connect to server securely because client certificate is not signed be the same authority", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: newTestdataCertsServerTLSConfig(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.RouterURL, strings.NewReader(`query { employees { id } }`))
			require.NoError(t, err)

			cert, err := tls.LoadX509KeyPair("../testdata/tls/cert-2.pem", "../testdata/tls/key-2.pem")
			require.NoError(t, err)

			caCert, err := os.ReadFile("../testdata/tls/cert-2.pem")
			require.NoError(t, err)

			caCertPool := x509.NewCertPool()
			if ok := caCertPool.AppendCertsFromPEM(caCert); !ok {
				t.Fatalf("could not append ca cert to pool")
			}

			client := &http.Client{
				Transport: &http.Transport{
					TLSClientConfig: &tls.Config{
						RootCAs:      caCertPool,
						Certificates: []tls.Certificate{cert},
					},
				},
			}
			_, err = client.Do(req)

			var urlErr *url.Error
			require.ErrorAs(t, err, &urlErr)

			require.ErrorContains(t, urlErr, "tls: failed to verify certificate: x509: certificate signed by unknown authority")
		})
	})

	t.Run("TLS client verification fails because client misses proper certification and key", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: newTestdataCertsServerTLSConfig(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.RouterURL, strings.NewReader(`query { employees { id } }`))
			require.NoError(t, err)

			client := &http.Client{}
			_, err = client.Do(req)

			var tlsErr *tls.CertificateVerificationError
			require.ErrorAs(t, err, &tlsErr)
		})
	})

	t.Run("Test TLS client skip verification", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: newTestdataCertsServerTLSConfig(),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.RouterURL, strings.NewReader(`query { employees { id } }`))
			require.NoError(t, err)

			client := &http.Client{
				Transport: &http.Transport{
					TLSClientConfig: &tls.Config{
						InsecureSkipVerify: true,
					},
				},
			}
			_, err = client.Do(req)
			require.NoError(t, err)
		})
	})
}

func TestMTLS(t *testing.T) {
	t.Parallel()

	t.Run("preserves HTTP2 negotiation when client authentication and watching are enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: true,
						CertFile: "../testdata/tls/cert.pem",
					},
				},
				Watch:         true,
				WatchInterval: 100 * time.Millisecond,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, "HTTP/2.0", res.Proto)
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)
		})
	})

	t.Run("TestPlayground", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: true,
						CertFile: "../testdata/tls/cert.pem",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodGet, "/", http.Header{
				"Accept": []string{"text/html"},
			}, nil)
			require.NoError(t, err)
			defer res.Body.Close()

			require.Contains(t, res.Header.Get("Content-Type"), "text/html")
			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			require.Contains(t, string(body), `WunderGraph Playground`)
		})
	})

	t.Run("TestQuery", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: true,
						CertFile: "../testdata/tls/cert.pem",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)
		})
	})

	t.Run("Client verification not required when server does not enforce it", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: false, // Default
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)
		})
	})

	t.Run("Client verification can be optional when client does not send a certificate. If it does it must be valid.", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: false,
						CertFile: "../testdata/tls/cert.pem",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			// Valid client certificate
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)

			// No client certificate
			client := &http.Client{
				Transport: &http.Transport{
					TLSClientConfig: &tls.Config{
						InsecureSkipVerify: true,
					},
				},
			}

			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.RouterURL, strings.NewReader(`query { employees { id } }`))
			require.NoError(t, err)

			_, err = client.Do(req)
			require.NoError(t, err)

			// Invalid client certificate
			cert, err := tls.LoadX509KeyPair("../testdata/tls/cert-2.pem", "../testdata/tls/key-2.pem")
			require.NoError(t, err)

			caCert, err := os.ReadFile("../testdata/tls/cert-2.pem")
			require.NoError(t, err)

			caCertPool := x509.NewCertPool()
			if ok := caCertPool.AppendCertsFromPEM(caCert); !ok {
				t.Fatalf("could not append ca cert to pool")
			}

			client = &http.Client{
				Transport: &http.Transport{
					TLSClientConfig: &tls.Config{
						RootCAs:      caCertPool,
						Certificates: []tls.Certificate{cert},
					},
				},
			}
			_, err = client.Do(req)

			var urlErr *url.Error
			require.ErrorAs(t, err, &urlErr)

			require.ErrorContains(t, urlErr, "tls: failed to verify certificate: x509: certificate signed by unknown authority")
		})
	})

	t.Run("Can't skip TLS client verification when client auth is enabled on the server", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: true,
						CertFile: "../testdata/tls/cert.pem",
					},
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.DebugLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.RouterURL, strings.NewReader(`query { employees { id } }`))
			require.NoError(t, err)

			client := &http.Client{
				Transport: &http.Transport{
					TLSClientConfig: &tls.Config{
						InsecureSkipVerify: true,
					},
				},
			}
			_, err = client.Do(req)

			var urlErr *url.Error
			require.ErrorAs(t, err, &urlErr)

			var netOpErr *net.OpError
			require.ErrorAs(t, err, &netOpErr)

			require.Error(t, netOpErr, "remote error: tls: certificate required")

			clientAuthLogs := xEnv.Observer().FilterMessageSnippet("Client auth enabled").All()
			require.Len(t, clientAuthLogs, 1)
			providerIDFields := xEnv.Observer().FilterField(zap.String("mode", "RequireAndVerifyClientCert")).All()
			require.Len(t, providerIDFields, 1)
		})
	})

	t.Run("Can skip client auth verification also when cert is specified", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
					ClientAuth: config.TLSClientAuthConfiguration{
						Required: false,
						CertFile: "../testdata/tls/cert.pem",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, testutils.EmployeesIDData, res.Body)
		})
	})
}
