package events_test

import (
	"crypto/tls"
	"crypto/x509"
	"os"
	"strings"
	"testing"
	"time"

	graphql "github.com/hasura/go-graphql-client"
	natssrv "github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const (
	certFilePattern = "nats-tls-*.pem"
)

// createServerTLSConfig returns a *tls.Config for the embedded NATS server using the given cert/key files.
func createServerTLSConfig(t *testing.T, certFile, keyFile string) *tls.Config {
	t.Helper()

	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	require.NoError(t, err)

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
}

// createServerMTLSConfig returns a *tls.Config that requires and verifies client certificates using mTLS.
func createServerMTLSConfig(t *testing.T, certFile, keyFile, caFile string) *tls.Config {
	t.Helper()

	cfg := createServerTLSConfig(t, certFile, keyFile)
	caPEM, err := os.ReadFile(caFile)
	require.NoError(t, err)
	caPool := x509.NewCertPool()
	require.True(t, caPool.AppendCertsFromPEM(caPEM), "failed to parse CA certificate")
	cfg.ClientAuth = tls.RequireAndVerifyClientCert
	cfg.ClientCAs = caPool

	return cfg
}

// startNATSServer starts and returns an embedded, in-process NATS server with the given options.
// It is automatically shut down when the test completes.
// https://docs.nats.io/running-a-nats-service/clients#embedding-nats
func startNATSServer(t *testing.T, opts *natssrv.Options) *natssrv.Server {
	t.Helper()

	s, err := natssrv.NewServer(opts)
	require.NoError(t, err, "failed to create embedded NATS server")

	s.Start()
	require.True(t, s.ReadyForConnections(10*time.Second), "embedded NATS server did not become ready")
	t.Cleanup(func() {
		s.Shutdown()
		s.WaitForShutdown()
	})
	return s
}

// natsPlainURL returns a nats:// URL for the server regardless of its TLS scheme.
// Use this when TLS is enabled via explicit nats.Option / router TLS config rather than URL scheme.
func natsPlainURL(s *natssrv.Server) string {
	return strings.Replace(s.ClientURL(), "tls://", "nats://", 1)
}

// connectToNATS creates a nats connection and connects to serverURL.
// By default, it skips server certificate verification.
// It allows to pass extraOpts, which override or extend defaults options.
func connectToNATS(t *testing.T, serverURL string, extraOpts ...nats.Option) *nats.Conn {
	t.Helper()
	opts := []nats.Option{
		// allowing self-signed certificates for the test helper
		nats.Secure(&tls.Config{InsecureSkipVerify: true}), //nolint:gosec
		nats.MaxReconnects(3),
		nats.Timeout(10 * time.Second),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) {
			t.Logf("NATS test client error: %v", err)
		}),
	}

	opts = append(opts, extraOpts...)
	conn, err := nats.Connect(serverURL, opts...)
	require.NoError(t, err, "failed to connect NATS test client to %s", serverURL)
	t.Cleanup(conn.Close)

	return conn
}

// tlsNATSEventSourceConfig builds event sources for every demo NATS provider, all pointing at url
// with the given TLS config. This replaces the empty provider list that results from not using
// EnableNats: true.
func tlsNATSEventSourceConfig(url string, tlsCfg *config.NatsTLSConfiguration) []config.NatsEventSource {
	sources := make([]config.NatsEventSource, len(testenv.DemoNatsProviders))
	for i, id := range testenv.DemoNatsProviders {
		sources[i] = config.NatsEventSource{ID: id, URL: url, TLS: tlsCfg}
	}
	return sources
}

// TestRouterConnectsToNATSWithTLS verifies that the router connects to NATS correctly under various TLS scenarios.
// Each subtest spins up an embedded NATS server and drives a full subscribe → publish → receive cycle.
func TestRouterConnectsToNATSWithTLS(t *testing.T) {
	t.Parallel()

	// subscribePublishVerify is the common test body: it subscribes to employeeUpdated(employeeID:3),
	// publishes one event via natsHelperConn, and asserts the subscription response.
	subscribePublishVerify := func(t *testing.T, xEnv *testenv.Environment, natsHelperConn *nats.Conn) {
		t.Helper()

		var subscriptionQuery struct {
			EmployeeUpdated struct {
				ID      float64 `graphql:"id"`
				Details struct {
					Forename string `graphql:"forename"`
					Surname  string `graphql:"surname"`
				} `graphql:"details"`
			} `graphql:"employeeUpdated(employeeID: 3)"`
		}

		client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())

		resultCh := make(chan natsSubscriptionArgs, 1)
		subscriptionHandler := func(dataValue []byte, errValue error) error {
			resultCh <- natsSubscriptionArgs{dataValue: dataValue, errValue: errValue}
			return nil
		}

		subscriptionID, err := client.Subscribe(&subscriptionQuery, nil, subscriptionHandler)
		require.NoError(t, err)
		require.NotEmpty(t, subscriptionID)

		clientErrCh := make(chan error, 1)
		go func() { clientErrCh <- client.Run() }()
		t.Cleanup(func() {
			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientErrCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			})
		})

		xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
		xEnv.WaitForTriggerCount(1, EventWaitTimeout)

		subject := xEnv.GetPubSubName("employeeUpdated.3")
		payload := []byte(`{"id":3,"__typename":"Employee"}`)
		xEnv.NATSPublishUntilReceived(natsHelperConn, subject, payload, 1, EventWaitTimeout)

		testenv.AwaitChannelWithT(t, EventWaitTimeout, resultCh, func(t *testing.T, args natsSubscriptionArgs) {
			require.NoError(t, args.errValue)
			require.JSONEq(t,
				`{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`,
				string(args.dataValue),
			)
		})

	}

	t.Run("router connects when server requires TLS", func(t *testing.T) {
		// Server requires TLS; router connects using InsecureSkipCaVerification.
		t.Parallel()

		certs := generateTLSCerts(t)
		srv := startNATSServer(t, &natssrv.Options{
			Host:        "127.0.0.1",
			Port:        -1, // tells nats to use a free port
			TLS:         true,
			TLSConfig:   createServerTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile),
			AllowNonTLS: false,
		})

		serverURL := natsPlainURL(srv)
		natsHelperConn := connectToNATS(t, serverURL)
		routerTLS := &config.NatsTLSConfiguration{InsecureSkipCaVerification: true}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSourceConfig(serverURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePublishVerify(t, xEnv, natsHelperConn)
		})
	})

	t.Run("router uses custom CA certificate", func(t *testing.T) {
		// Router accepts nats server certs using a custom CA cert and connects to it.
		t.Parallel()

		certs := generateTLSCerts(t)
		srv := startNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1, // tells nats to use a free port
			TLS:       true,
			TLSConfig: createServerTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile),
		})

		serverURL := natsPlainURL(srv)
		// Router verifies the server certificate against the custom CA — no InsecureSkipVerify.
		routerTLS := &config.NatsTLSConfiguration{CaFile: certs.CACertFile}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSourceConfig(serverURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			natsHelperConn := connectToNATS(t, serverURL)
			subscribePublishVerify(t, xEnv, natsHelperConn)
		})
	})

	t.Run("router uses mTLS when configured", func(t *testing.T) {
		// Server requires mutual TLS; router presents a client certificate.
		t.Parallel()

		certs := generateTLSCerts(t)
		// Server requires client certs verified against the CA.
		srv := startNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1, // tells nats to use a free port
			TLS:       true,
			TLSVerify: true,
			TLSConfig: createServerMTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile, certs.CACertFile),
		})

		serverURL := natsPlainURL(srv)

		// Test client also needs a client cert to connect to the mTLS server.
		clientCert, err := tls.LoadX509KeyPair(certs.ClientCertFile, certs.ClientKeyFile)
		require.NoError(t, err)

		// Router uses the CA cert to verify the server and presents it's client cert/key for mTLS.
		routerTLS := &config.NatsTLSConfiguration{
			CaFile:   certs.CACertFile,
			CertFile: certs.ClientCertFile,
			KeyFile:  certs.ClientKeyFile,
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSourceConfig(serverURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Helper connection needs to do mTLS as well in order to connect to the server
			natsHelperConn := connectToNATS(t, serverURL,
				nats.Secure(&tls.Config{
					InsecureSkipVerify: true, //nolint:gosec // test helper only
					Certificates:       []tls.Certificate{clientCert},
				}),
			)
			subscribePublishVerify(t, xEnv, natsHelperConn)
		})
	})

	t.Run("router fails to start when server requires TLS but no TLS configured", func(t *testing.T) {
		// Server requires TLS; router has no TLS config — connection must fail at startup.
		// The routers NATS client will attempt a TLS upgrade (server sends tls_required in INFO)
		// but the self-signed cert is not in the system CA pool, so the handshake fails.
		t.Parallel()

		certs := generateTLSCerts(t)
		srv := startNATSServer(t, &natssrv.Options{
			Host:        "127.0.0.1",
			Port:        -1,
			TLS:         true,
			TLSConfig:   createServerTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile),
			AllowNonTLS: false,
		})
		serverURL := natsPlainURL(srv)

		testenv.FailsOnStartup(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSourceConfig(serverURL, nil)
			},
		}, func(t *testing.T, err error) {
			require.ErrorContains(t, err, "tls: failed to verify certificate")
		})
	})

	t.Run("router fails to start when ca cert does not match server cert", func(t *testing.T) {
		// Server uses a cert signed by serverCerts CA; router is configured with a
		// completely different CA (unrelatedCerts), so certificate verification must fail.
		t.Parallel()

		serverCerts := generateTLSCerts(t)
		unrelatedCerts := generateTLSCerts(t)

		srv := startNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1,
			TLS:       true,
			TLSConfig: createServerTLSConfig(t, serverCerts.ServerCertFile, serverCerts.ServerKeyFile),
		})

		serverURL := natsPlainURL(srv)
		routerTLS := &config.NatsTLSConfiguration{CaFile: unrelatedCerts.CACertFile}

		testenv.FailsOnStartup(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSourceConfig(serverURL, routerTLS)
			},
		}, func(t *testing.T, err error) {
			require.ErrorContains(t, err, "certificate signed by unknown authority")
		})
	})

	t.Run("router connects to server when using tls:// url", func(t *testing.T) {
		// Router must also perform a TLS connection when nats url is prefixed with "tls://".
		t.Parallel()

		certs := generateTLSCerts(t)
		srv := startNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1, // tells nats to use a free port
			TLS:       true,
			TLSConfig: createServerTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile),
		})

		// Use the tls:// URL from the server directly — this is what gets configured in the router.
		tlsSchemeURL := srv.ClientURL()

		// Router verifies the server certificate against the custom CA.
		routerTLS := &config.NatsTLSConfiguration{CaFile: certs.CACertFile}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSourceConfig(tlsSchemeURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			natsHelperConn := connectToNATS(t, natsPlainURL(srv))
			subscribePublishVerify(t, xEnv, natsHelperConn)
		})
	})
}
