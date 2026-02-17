package integration

import (
	"crypto/tls"
	"crypto/x509"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// loadSubgraphMTLSCACertPool loads a CA certificate pool from a PEM file.
func loadSubgraphMTLSCACertPool(t *testing.T, caFile string) *x509.CertPool {
	t.Helper()
	caCert, err := os.ReadFile(caFile)
	require.NoError(t, err)

	pool := x509.NewCertPool()
	ok := pool.AppendCertsFromPEM(caCert)
	require.True(t, ok, "failed to append CA cert to pool")
	return pool
}

// subgraphMTLSServerConfig creates a tls.Config for a subgraph test server.
// It does NOT set Certificates — httptest.StartTLS() will generate a cert valid for 127.0.0.1.
// If requireClientCert is true, the subgraph will require the router to present a valid client certificate
// signed by the CA in testdata/tls/cert.pem.
func subgraphMTLSServerConfig(t *testing.T, requireClientCert bool) *tls.Config {
	t.Helper()
	cfg := &tls.Config{}
	if requireClientCert {
		caPool := loadSubgraphMTLSCACertPool(t, "testdata/tls/cert.pem")
		cfg.ClientCAs = caPool
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
	}
	return cfg
}

func TestSubgraphMTLS(t *testing.T) {
	t.Parallel()

	t.Run("Router connects to TLS subgraph with InsecureSkipVerify", func(t *testing.T) {
		t.Parallel()

		// Subgraph is a TLS server (httptest generates a self-signed cert for 127.0.0.1).
		// Router uses InsecureSkipCaVerification to trust it.
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, false),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					All: config.TLSClientCertConfiguration{
						InsecureSkipCaVerification: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Router presents client certificate to mTLS subgraph", func(t *testing.T) {
		t.Parallel()

		// Subgraph requires client cert signed by testdata/tls/cert.pem CA
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, true),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					All: config.TLSClientCertConfiguration{
						// InsecureSkipCaVerification for httptest's self-signed server cert
						InsecureSkipCaVerification: true,
						// Present client cert for mTLS
						CertFile: "testdata/tls/cert.pem",
						KeyFile:  "testdata/tls/key.pem",
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Router fails to connect to mTLS subgraph without client certificate", func(t *testing.T) {
		t.Parallel()

		// Subgraph requires client cert, but router does not provide one
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, true),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					All: config.TLSClientCertConfiguration{
						InsecureSkipCaVerification: true,
						// NO client certificate — should cause mTLS failure
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The query should fail because the router has no client cert to present
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)
			// The router returns 200 with a GraphQL error about the subgraph fetch failure
			require.Contains(t, res.Body, `Failed to fetch from Subgraph`)
		})
	})

	t.Run("Router fails to connect to mTLS subgraph with wrong client certificate", func(t *testing.T) {
		t.Parallel()

		// Subgraph requires client cert signed by cert.pem CA, but router presents cert-2
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, true),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					All: config.TLSClientCertConfiguration{
						InsecureSkipCaVerification: true,
						CertFile: "testdata/tls/cert-2.pem",
						KeyFile:  "testdata/tls/key-2.pem",
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `Failed to fetch from Subgraph`)
		})
	})

	t.Run("Per-subgraph TLS config overrides global", func(t *testing.T) {
		t.Parallel()

		// Subgraph requires client cert
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, true),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					// No global client TLS — would fail without per-subgraph override
					Subgraphs: map[string]config.TLSClientCertConfiguration{
						"employees": {
							InsecureSkipCaVerification: true,
							CertFile: "testdata/tls/cert.pem",
							KeyFile:  "testdata/tls/key.pem",
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})
}
