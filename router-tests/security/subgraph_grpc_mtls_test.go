package integration

import (
	"crypto/tls"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const projectsExpectedData = `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`

func TestSubgraphGRPCmTLS(t *testing.T) {
	t.Parallel()

	t.Run("InsecureSkipVerify", func(t *testing.T) {
		t.Parallel()

		t.Run("All", func(t *testing.T) {
			t.Parallel()

			t.Run("connects when enabled", func(t *testing.T) {
				t.Parallel()
				// Router skips cert verification (InsecureSkipCaVerification: true) and successfully queries a TLS-only gRPC subgraph.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, false)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})

			t.Run("fails when disabled", func(t *testing.T) {
				t.Parallel()
				// Router has no TLS config at all for a TLS-only gRPC subgraph, connection fails.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, false)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: false,
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.NoError(t, err)
					require.Contains(t, res.Body, "Failed to fetch from Subgraph")
				})
			})
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("overrides global CaFile", func(t *testing.T) {
				t.Parallel()
				// Global config points to a wrong CA (would fail); per-subgraph InsecureSkipCaVerification overrides it and succeeds.

				// Global config uses CaFile that does NOT match the gRPC server cert,
				// so it would fail. Per-subgraph overrides with InsecureSkipVerify.
				wrongCertPath, _ := generateServerCert(t)
				serverTLS, _ := grpcSubgraphTLSServerConfig(t, false)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									CaFile: wrongCertPath,
								},
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										InsecureSkipCaVerification: true,
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
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
				// Router presents the right client cert, mTLS subgraph accepts it.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
									CertFile:                   "../testdata/tls/cert.pem",
									KeyFile:                    "../testdata/tls/key.pem",
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})

			t.Run("fails without client cert", func(t *testing.T) {
				t.Parallel()
				// Subgraph requires a client cert, router sends none, connection fails.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.NoError(t, err)
					require.Contains(t, res.Body, "Failed to fetch from Subgraph")
				})
			})

			t.Run("fails with wrong client cert", func(t *testing.T) {
				t.Parallel()
				// Router presents a cert signed by the wrong CA, subgraph rejects it.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
									CertFile:                   "../testdata/tls/cert-2.pem",
									KeyFile:                    "../testdata/tls/key-2.pem",
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.NoError(t, err)
					require.Contains(t, res.Body, "Failed to fetch from Subgraph")
				})
			})
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("correct config without global", func(t *testing.T) {
				t.Parallel()
				// No global config, per-subgraph config with correct client cert succeeds.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										InsecureSkipCaVerification: true,
										CertFile:                   "../testdata/tls/cert.pem",
										KeyFile:                    "../testdata/tls/key.pem",
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})

			t.Run("correct config overrides incorrect global", func(t *testing.T) {
				t.Parallel()
				// Global has wrong cert, per-subgraph has correct cert, per-subgraph wins and succeeds.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
									CertFile:                   "../testdata/tls/cert-2.pem",
									KeyFile:                    "../testdata/tls/key-2.pem",
								},
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										InsecureSkipCaVerification: true,
										CertFile:                   "../testdata/tls/cert.pem",
										KeyFile:                    "../testdata/tls/key.pem",
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})

			t.Run("incorrect config overrides correct global", func(t *testing.T) {
				t.Parallel()
				// Global has correct cert, per-subgraph has wrong cert, per-subgraph wins and fails.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
									CertFile:                   "../testdata/tls/cert.pem",
									KeyFile:                    "../testdata/tls/key.pem",
								},
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										InsecureSkipCaVerification: true,
										CertFile:                   "../testdata/tls/cert-2.pem",
										KeyFile:                    "../testdata/tls/key-2.pem",
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.NoError(t, err)
					require.Contains(t, res.Body, "Failed to fetch from Subgraph")
				})
			})

			t.Run("override without cert fails even when global has cert", func(t *testing.T) {
				t.Parallel()
				// Per-subgraph config with no cert fully replaces global (no field inheritance), mTLS fails.

				serverTLS, _ := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
									CertFile:                   "../testdata/tls/cert.pem",
									KeyFile:                    "../testdata/tls/key.pem",
								},
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										InsecureSkipCaVerification: true,
										// NO CertFile/KeyFile — proves fields are NOT inherited from All
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.NoError(t, err)
					require.Contains(t, res.Body, "Failed to fetch from Subgraph")
				})
			})
		})
	})

	t.Run("CaFile", func(t *testing.T) {
		t.Parallel()

		t.Run("All", func(t *testing.T) {
			t.Parallel()

			t.Run("trusts gRPC subgraph server", func(t *testing.T) {
				t.Parallel()
				// Router's CaFile matches the server's self-signed cert, connection is verified and succeeds.

				serverTLS, certPath := grpcSubgraphTLSServerConfig(t, false)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									CaFile: certPath,
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("trusts gRPC subgraph server without global config", func(t *testing.T) {
				t.Parallel()
				// No global config, per-subgraph CaFile trusts the server cert, succeeds.

				serverTLS, certPath := grpcSubgraphTLSServerConfig(t, false)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										CaFile: certPath,
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})

			t.Run("overrides global InsecureSkipVerify with proper verification", func(t *testing.T) {
				t.Parallel()
				// Global uses InsecureSkipCaVerification, per-subgraph replaces it with a proper CaFile check — proves per-subgraph can be more secure than global.

				serverTLS, certPath := grpcSubgraphTLSServerConfig(t, false)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									InsecureSkipCaVerification: true,
								},
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										CaFile: certPath,
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
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
				// Production-like: router verifies the server cert via CaFile and presents a client cert for mutual authentication, both sides verified.

				serverTLS, certPath := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								All: config.TLSClientCertConfiguration{
									CaFile:   certPath,
									CertFile: "../testdata/tls/cert.pem",
									KeyFile:  "../testdata/tls/key.pem",
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})
		})

		t.Run("Per-subgraph", func(t *testing.T) {
			t.Parallel()

			t.Run("with CaFile and client certificate without global config", func(t *testing.T) {
				t.Parallel()
				// Same full mTLS scenario but configured only at the per-subgraph level with no global config.

				serverTLS, certPath := grpcSubgraphTLSServerConfig(t, true)

				testenv.Run(t, &testenv.Config{
					RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
					EnableGRPC:               true,
					Subgraphs: testenv.SubgraphsConfig{
						Projects: testenv.SubgraphConfig{
							GRPCTLSConfig: serverTLS,
						},
					},
					RouterOptions: []core.Option{
						core.WithTLSConfig(config.TLSConfiguration{
							ClientGRPC: config.GRPCClientTLSConfiguration{
								Subgraphs: map[string]config.TLSClientCertConfiguration{
									"projects": {
										CaFile:   certPath,
										CertFile: "../testdata/tls/cert.pem",
										KeyFile:  "../testdata/tls/key.pem",
									},
								},
							},
						}),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: `query { projects { id name } }`,
					})
					require.JSONEq(t, projectsExpectedData, res.Body)
				})
			})
		})
	})
}

// grpcSubgraphTLSServerConfig creates a tls.Config for a gRPC subgraph test server.
// It generates a self-signed certificate valid for 127.0.0.1 and returns both the
// TLS config and the path to the cert PEM file (for use as CaFile on the router).
// If requireClientCert is true, the server requires the router to present a valid
// client certificate signed by the CA in testdata/tls/cert.pem.
func grpcSubgraphTLSServerConfig(t *testing.T, requireClientCert bool) (serverTLSConfig *tls.Config, certPath string) {
	t.Helper()

	certPath, keyPath := generateServerCert(t)
	serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
	require.NoError(t, err)

	cfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
	}

	if requireClientCert {
		caPool := loadSubgraphMTLSCACertPool(t, "../testdata/tls/cert.pem")
		cfg.ClientCAs = caPool
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
	}

	return cfg, certPath
}
