package integration

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestSubgraphMTLS(t *testing.T) {
	t.Parallel()

	t.Run("Router connects to TLS subgraph with InsecureSkipVerify", func(t *testing.T) {
		t.Parallel()

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

	t.Run("Router fails to connect to TLS subgraph with InsecureSkipVerify", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, false),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					All: config.TLSClientCertConfiguration{
						InsecureSkipCaVerification: false,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph 'employees'."}],"data":{"employees":null}}`, res.Body)
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
						CertFile:                   "testdata/tls/cert-2.pem",
						KeyFile:                    "testdata/tls/key-2.pem",
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
							CertFile:                   "testdata/tls/cert.pem",
							KeyFile:                    "testdata/tls/key.pem",
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

	t.Run("Router trusts subgraph server via CaFile", func(t *testing.T) {
		t.Parallel()

		// Generate a self-signed cert valid for 127.0.0.1 to use as both
		// the server cert and the router's trusted CA.
		certPath, keyPath := generateServerCert(t)
		serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: &tls.Config{
						Certificates: []tls.Certificate{serverCert},
					},
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					All: config.TLSClientCertConfiguration{
						// Trust the server cert via CaFile instead of InsecureSkipCaVerification
						CaFile: certPath,
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

	t.Run("Per-subgraph correct TLS config overrides the incorrect global config", func(t *testing.T) {
		t.Parallel()

		// Global config has wrong client certs (cert-2), but per-subgraph has correct ones.
		// The subgraph requires client cert signed by cert.pem CA.
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
						// Wrong client cert at global level
						CertFile: "testdata/tls/cert-2.pem",
						KeyFile:  "testdata/tls/key-2.pem",
					},
					Subgraphs: map[string]config.TLSClientCertConfiguration{
						"employees": {
							InsecureSkipCaVerification: true,
							// Correct client cert at per-subgraph level
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

	t.Run("Full mTLS with CaFile and client certificate", func(t *testing.T) {
		t.Parallel()

		// Production-like scenario: router verifies subgraph server cert via CaFile
		// AND presents a client cert for mTLS — no InsecureSkipCaVerification.
		certPath, keyPath := generateServerCert(t)
		serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
		require.NoError(t, err)

		// Server requires client cert signed by testdata/tls/cert.pem CA
		caPool := loadSubgraphMTLSCACertPool(t, "testdata/tls/cert.pem")

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: &tls.Config{
						Certificates: []tls.Certificate{serverCert},
						ClientCAs:    caPool,
						ClientAuth:   tls.RequireAndVerifyClientCert,
					},
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					All: config.TLSClientCertConfiguration{
						// Verify server cert via CaFile
						CaFile: certPath,
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

	t.Run("TLS works with per-subgraph traffic shaping transport", func(t *testing.T) {
		t.Parallel()

		// When a subgraph has per-subgraph traffic shaping options, it creates a dedicated
		// transport via SubgraphMap. The TLS config must be merged into that transport.
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, false),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(config.TrafficShapingRules{
					All: config.GlobalSubgraphRequestRule{
						RequestTimeout: ToPtr(30 * time.Second),
					},
					Subgraphs: map[string]config.GlobalSubgraphRequestRule{
						"employees": {
							RequestTimeout: ToPtr(5 * time.Second),
						},
					},
				})),
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

	t.Run("mTLS works with per-subgraph traffic shaping transport", func(t *testing.T) {
		t.Parallel()

		// Combines per-subgraph traffic shaping (creates transport via SubgraphMap)
		// with per-subgraph TLS config (client cert for mTLS).
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, true),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(config.TrafficShapingRules{
					Subgraphs: map[string]config.GlobalSubgraphRequestRule{
						"employees": {
							RequestTimeout: ToPtr(5 * time.Second),
						},
					},
				})),
				core.WithSubgraphTLSConfiguration(config.SubgraphTLSConfiguration{
					Subgraphs: map[string]config.TLSClientCertConfiguration{
						"employees": {
							InsecureSkipCaVerification: true,
							CertFile:                   "testdata/tls/cert.pem",
							KeyFile:                    "testdata/tls/key.pem",
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

// generateServerCert creates a self-signed certificate valid for 127.0.0.1.
// Returns paths to the cert and key PEM files in a temp directory.
// The cert can be used as both the server certificate and the router's CaFile
// (since it's self-signed, it is its own CA).
func generateServerCert(t *testing.T) (certPath, keyPath string) {
	t.Helper()

	dir := t.TempDir()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-server"},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1)},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)

	certPath = filepath.Join(dir, "server.crt")
	certFile, err := os.Create(certPath)
	require.NoError(t, err)
	require.NoError(t, pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certDER}))
	require.NoError(t, certFile.Close())

	keyPath = filepath.Join(dir, "server.key")
	keyFile, err := os.Create(keyPath)
	require.NoError(t, err)
	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)
	require.NoError(t, pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))
	require.NoError(t, keyFile.Close())

	return certPath, keyPath
}
