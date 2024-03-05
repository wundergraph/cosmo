package integration

import (
	"crypto/tls"
	"crypto/x509"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
)

const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

func TestTLS(t *testing.T) {

	t.Parallel()

	t.Run("Ensure router URL is https when passing TLSConfig", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Contains(t, xEnv.RouterURL, "https://")
		})
	})

	t.Run("Ensure router URL is not https when nil TLSConfig is passed", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: nil,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Contains(t, xEnv.RouterURL, "http://")
		})
	})

	t.Run("TestPlayground", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
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
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Can't connect to server securely because client certificate is not signed be the same authority", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req, err := http.NewRequestWithContext(xEnv.Context, http.MethodPost, xEnv.RouterURL, strings.NewReader(`query { employees { id } }`))
			require.NoError(t, err)

			cert, err := tls.LoadX509KeyPair("testdata/tls/cert-2.pem", "testdata/tls/key-2.pem")
			require.NoError(t, err)

			caCert, err := os.ReadFile("testdata/tls/cert-2.pem")
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
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
			},
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
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
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
			require.NoError(t, err)
		})
	})
}

func TestMTLS(t *testing.T) {

	t.Parallel()

	t.Run("TestPlayground", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
				ClientAuth: &core.TlsClientAuthConfig{
					Verify:   true,
					CertFile: "testdata/tls/cert.pem",
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
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
				ClientAuth: &core.TlsClientAuthConfig{
					Verify:   true,
					CertFile: "testdata/tls/cert.pem",
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Client verification not required when server does not enforce it", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
				ClientAuth: &core.TlsClientAuthConfig{
					Verify: false, // Default
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Can't skip TLS client verification when client auth is enabled on the server", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
				ClientAuth: &core.TlsClientAuthConfig{
					Verify:   true,
					CertFile: "testdata/tls/cert.pem",
				},
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
		})
	})

	t.Run("Can skip client auth verification also when cert is specified", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
				ClientAuth: &core.TlsClientAuthConfig{
					Verify:   false,
					CertFile: "testdata/tls/cert.pem",
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})
}
