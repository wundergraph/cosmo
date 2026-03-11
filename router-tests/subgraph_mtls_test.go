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

	t.Run("InsecureSkipVerify", func(t *testing.T) {
		t.Parallel()

		t.Run("All", func(t *testing.T) {
			t.Parallel()

			t.Run("connects when enabled", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, false),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
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

			t.Run("fails when disabled", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, false),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
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
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("overrides global CaFile", func(t *testing.T) {
				t.Parallel()

				// Global config uses CaFile that does NOT match the httptest server cert,
				// so it would fail. Per-subgraph overrides with InsecureSkipVerify to skip
				// verification entirely, proving per-subgraph can be less secure than global.
				certPath, _ := generateServerCert(t)

				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, false),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								CaFile: certPath,
							},
							Subgraphs: map[string]config.TLSClientCertConfiguration{
								"employees": {
									InsecureSkipCaVerification: true,
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
		})
	})

	t.Run("Client certificate", func(t *testing.T) {
		t.Parallel()

		t.Run("All", func(t *testing.T) {
			t.Parallel()

			t.Run("presents correct cert to mTLS subgraph", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, true),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								InsecureSkipCaVerification: true,
								CertFile:                   "testdata/tls/cert.pem",
								KeyFile:                    "testdata/tls/key.pem",
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

			t.Run("fails without client cert", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, true),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								InsecureSkipCaVerification: true,
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

			t.Run("fails with wrong client cert", func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, true),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
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
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("correct config without global", func(t *testing.T) {
				t.Parallel()

				// No global config — only per-subgraph with correct client cert
				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, true),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
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

			t.Run("correct config overrides incorrect global", func(t *testing.T) {
				t.Parallel()

				// Global has wrong certs (cert-2), per-subgraph has correct ones (cert).
				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, true),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								InsecureSkipCaVerification: true,
								CertFile:                   "testdata/tls/cert-2.pem",
								KeyFile:                    "testdata/tls/key-2.pem",
							},
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

			t.Run("incorrect config overrides correct global", func(t *testing.T) {
				t.Parallel()

				// Global has correct certs (cert), per-subgraph overrides with wrong ones (cert-2).
				// Per-subgraph always wins, even when it causes failure.
				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, true),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								InsecureSkipCaVerification: true,
								CertFile:                   "testdata/tls/cert.pem",
								KeyFile:                    "testdata/tls/key.pem",
							},
							Subgraphs: map[string]config.TLSClientCertConfiguration{
								"employees": {
									InsecureSkipCaVerification: true,
									CertFile:                   "testdata/tls/cert-2.pem",
									KeyFile:                    "testdata/tls/key-2.pem",
								},
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

			t.Run("override without cert fails even when global has cert", func(t *testing.T) {
				t.Parallel()

				// Global has full working mTLS config (InsecureSkipVerify + client cert).
				// Per-subgraph overrides with ONLY InsecureSkipVerify — no client cert.
				// Because per-subgraph COMPLETELY REPLACES global (no field merging),
				// the router will not present a client cert, causing mTLS failure.
				testenv.Run(t, &testenv.Config{
					Subgraphs: testenv.SubgraphsConfig{
						Employees: testenv.SubgraphConfig{
							TLSConfig: subgraphMTLSServerConfig(t, true),
						},
					},
					RouterOptions: []core.Option{
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								InsecureSkipCaVerification: true,
								CertFile:                   "testdata/tls/cert.pem",
								KeyFile:                    "testdata/tls/key.pem",
							},
							Subgraphs: map[string]config.TLSClientCertConfiguration{
								"employees": {
									InsecureSkipCaVerification: true,
									// NO CertFile/KeyFile — proves fields are NOT inherited from All
								},
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
		})
	})

	t.Run("CaFile", func(t *testing.T) {
		t.Parallel()

		t.Run("All", func(t *testing.T) {
			t.Parallel()

			t.Run("trusts subgraph server", func(t *testing.T) {
				t.Parallel()

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
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
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
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("trusts subgraph server without global config", func(t *testing.T) {
				t.Parallel()

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
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							Subgraphs: map[string]config.TLSClientCertConfiguration{
								"employees": {
									CaFile: certPath,
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

			t.Run("overrides global InsecureSkipVerify with proper verification", func(t *testing.T) {
				t.Parallel()

				// Global uses InsecureSkipVerify (insecure), per-subgraph uses CaFile
				// (proper verification). Proves per-subgraph can be more secure than global.
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
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								InsecureSkipCaVerification: true,
							},
							Subgraphs: map[string]config.TLSClientCertConfiguration{
								"employees": {
									CaFile: certPath,
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
		})
	})

	t.Run("Full mTLS", func(t *testing.T) {
		t.Parallel()

		t.Run("All", func(t *testing.T) {
			t.Parallel()

			t.Run("with CaFile and client certificate", func(t *testing.T) {
				t.Parallel()

				// Production-like: router verifies server cert via CaFile
				// AND presents client cert for mTLS — no InsecureSkipCaVerification.
				certPath, keyPath := generateServerCert(t)
				serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
				require.NoError(t, err)

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
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							All: config.TLSClientCertConfiguration{
								CaFile:   certPath,
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
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("with CaFile and client certificate without global config", func(t *testing.T) {
				t.Parallel()

				// Production-like per-subgraph: CaFile for server verification
				// + client cert for mTLS, no global config at all.
				certPath, keyPath := generateServerCert(t)
				serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
				require.NoError(t, err)

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
						core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
							Subgraphs: map[string]config.TLSClientCertConfiguration{
								"employees": {
									CaFile:   certPath,
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
		})
	})

	t.Run("Traffic shaping integration", func(t *testing.T) {
		t.Parallel()

		t.Run("TLS with per-subgraph transport", func(t *testing.T) {
			t.Parallel()

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
					core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
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

		t.Run("mTLS with per-subgraph transport", func(t *testing.T) {
			t.Parallel()

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
					core.WithSubgraphTLSConfiguration(config.ClientTLSConfiguration{
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
	})
}

func TestSubgraphMTLSEnvVarConfig(t *testing.T) {
	t.Run("Verify envars being set", func(t *testing.T) {
		t.Run("InsecureSkipCaVerification defaults to false via env var", func(t *testing.T) {
			// Do not set TLS_CLIENT_ALL_INSECURE_SKIP_CA_VERIFICATION — should default to false
			cfg := loadConfigFromEnv(t)
			require.False(t, cfg.TLS.Client.All.InsecureSkipCaVerification)
		})

		t.Run("InsecureSkipCaVerification set via env var", func(t *testing.T) {
			t.Setenv("TLS_CLIENT_ALL_INSECURE_SKIP_CA_VERIFICATION", "true")

			cfg := loadConfigFromEnv(t)
			require.True(t, cfg.TLS.Client.All.InsecureSkipCaVerification)
		})

		t.Run("CertFile and KeyFile set via env vars", func(t *testing.T) {
			t.Setenv("TLS_CLIENT_ALL_CERT_FILE", "testdata/tls/cert.pem")
			t.Setenv("TLS_CLIENT_ALL_KEY_FILE", "testdata/tls/key.pem")

			cfg := loadConfigFromEnv(t)

			require.Equal(t, "testdata/tls/cert.pem", cfg.TLS.Client.All.CertFile)
			require.Equal(t, "testdata/tls/key.pem", cfg.TLS.Client.All.KeyFile)
		})

		t.Run("CaFile set via env var", func(t *testing.T) {
			t.Setenv("TLS_CLIENT_ALL_CA_FILE", "testdata/tls/cert.pem")

			cfg := loadConfigFromEnv(t)

			require.Equal(t, "testdata/tls/cert.pem", cfg.TLS.Client.All.CaFile)
		})
	})

	t.Run("InsecureSkipCaVerification set via env var", func(t *testing.T) {
		t.Setenv("TLS_CLIENT_ALL_INSECURE_SKIP_CA_VERIFICATION", "true")

		cfg := loadConfigFromEnv(t)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, false),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(cfg.TLS.Client),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Router presents client certificate to mTLS subgraph via env vars", func(t *testing.T) {
		t.Setenv("TLS_CLIENT_ALL_INSECURE_SKIP_CA_VERIFICATION", "true")
		t.Setenv("TLS_CLIENT_ALL_CERT_FILE", "testdata/tls/cert.pem")
		t.Setenv("TLS_CLIENT_ALL_KEY_FILE", "testdata/tls/key.pem")

		cfg := loadConfigFromEnv(t)

		require.True(t, cfg.TLS.Client.All.InsecureSkipCaVerification)
		require.Equal(t, "testdata/tls/cert.pem", cfg.TLS.Client.All.CertFile)
		require.Equal(t, "testdata/tls/key.pem", cfg.TLS.Client.All.KeyFile)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: subgraphMTLSServerConfig(t, true),
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(cfg.TLS.Client),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Router trusts subgraph server via CaFile env var", func(t *testing.T) {
		certPath, keyPath := generateServerCert(t)
		serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
		require.NoError(t, err)

		t.Setenv("TLS_CLIENT_ALL_CA_FILE", certPath)

		cfg := loadConfigFromEnv(t)
		require.Equal(t, certPath, cfg.TLS.Client.All.CaFile)

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					TLSConfig: &tls.Config{
						Certificates: []tls.Certificate{serverCert},
					},
				},
			},
			RouterOptions: []core.Option{
				core.WithSubgraphTLSConfiguration(cfg.TLS.Client),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("Full mTLS via env vars with CaFile and client certificate", func(t *testing.T) {
		certPath, keyPath := generateServerCert(t)
		serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
		require.NoError(t, err)

		caPool := loadSubgraphMTLSCACertPool(t, "testdata/tls/cert.pem")

		t.Setenv("TLS_CLIENT_ALL_CA_FILE", certPath)
		t.Setenv("TLS_CLIENT_ALL_CERT_FILE", "testdata/tls/cert.pem")
		t.Setenv("TLS_CLIENT_ALL_KEY_FILE", "testdata/tls/key.pem")

		cfg := loadConfigFromEnv(t)

		require.Equal(t, certPath, cfg.TLS.Client.All.CaFile)
		require.Equal(t, "testdata/tls/cert.pem", cfg.TLS.Client.All.CertFile)
		require.Equal(t, "testdata/tls/key.pem", cfg.TLS.Client.All.KeyFile)
		require.False(t, cfg.TLS.Client.All.InsecureSkipCaVerification)

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
				core.WithSubgraphTLSConfiguration(cfg.TLS.Client),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})
}

// loadConfigFromEnv creates a minimal config file and loads config, allowing
// environment variables to populate the TLS client configuration fields.
func loadConfigFromEnv(t *testing.T) config.Config {
	t.Helper()

	f, err := os.CreateTemp(t.TempDir(), "config_test_*.yaml")
	require.NoError(t, err)
	_, err = f.WriteString(`version: "1"`)
	require.NoError(t, err)
	require.NoError(t, f.Close())

	result, err := config.LoadConfig([]string{f.Name()})
	require.NoError(t, err)
	return result.Config
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
