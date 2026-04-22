package events_test

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

// natsTLSTestCerts holds file paths to TLS certificate files used in nats_tls_test.go.
type natsTLSTestCerts struct {
	CACertFile     string // self-signed CA certificate (PEM)
	ServerCertFile string // server certificate signed by the CA (PEM, SAN: 127.0.0.1/localhost)
	ServerKeyFile  string // server private key (PEM)
	ClientCertFile string // client certificate signed by the CA, for mTLS (PEM)
	ClientKeyFile  string // client private key, for mTLS (PEM)
}

// generateNATSTLSTestCerts creates a CA, a server cert (with SAN 127.0.0.1 and localhost), and a
// client cert. All PEM files are written to the test's temp directory and cleaned up automatically.
func generateNATSTLSTestCerts(t *testing.T) *natsTLSTestCerts {
	t.Helper()

	// CA key + self-signed cert
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "nats-test-ca"},
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

	return &natsTLSTestCerts{
		CACertFile:     writeNATSPEMFile(t, caPEM),
		ServerCertFile: writeNATSPEMFile(t, serverCertPEM),
		ServerKeyFile:  writeNATSPEMFile(t, serverKeyPEM),
		ClientCertFile: writeNATSPEMFile(t, clientCertPEM),
		ClientKeyFile:  writeNATSPEMFile(t, clientKeyPEM),
	}
}

func writeNATSPEMFile(t *testing.T, data []byte) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "nats-tls-*.pem")
	require.NoError(t, err)
	_, err = f.Write(data)
	require.NoError(t, err)
	require.NoError(t, f.Close())
	return f.Name()
}

// buildServerTLSConfig returns a *tls.Config for the embedded NATS server using the given cert/key files.
func buildServerTLSConfig(t *testing.T, certFile, keyFile string) *tls.Config {
	t.Helper()
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	require.NoError(t, err)
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
}

// buildMTLSServerConfig returns a *tls.Config that requires and verifies client certificates.
func buildMTLSServerConfig(t *testing.T, certFile, keyFile, caFile string) *tls.Config {
	t.Helper()
	cfg := buildServerTLSConfig(t, certFile, keyFile)
	caPEM, err := os.ReadFile(caFile)
	require.NoError(t, err)
	caPool := x509.NewCertPool()
	require.True(t, caPool.AppendCertsFromPEM(caPEM), "failed to parse CA certificate")
	cfg.ClientAuth = tls.RequireAndVerifyClientCert
	cfg.ClientCAs = caPool
	return cfg
}

// startTLSNATSServer starts an embedded NATS server with the given options.
// It is automatically shut down when the test completes.
func startTLSNATSServer(t *testing.T, opts *natssrv.Options) *natssrv.Server {
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

// connectInsecureTLSNATSClient connects a NATS test-helper client to the given URL using
// InsecureSkipVerify TLS. Extra options are applied after the defaults, allowing the caller
// to override the TLS config (e.g., to add a client certificate for mTLS).
func connectInsecureTLSNATSClient(t *testing.T, serverURL string, extraOpts ...nats.Option) *nats.Conn {
	t.Helper()
	opts := []nats.Option{
		nats.Secure(&tls.Config{InsecureSkipVerify: true}), //nolint:gosec // test helper only
		nats.MaxReconnects(3),
		nats.Timeout(10 * time.Second),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) {
			t.Logf("NATS test client error: %v", err)
		}),
	}
	// extraOpts come last so they can override defaults (e.g., supply a richer TLS config).
	opts = append(opts, extraOpts...)
	conn, err := nats.Connect(serverURL, opts...)
	require.NoError(t, err, "failed to connect NATS test client to %s", serverURL)
	t.Cleanup(conn.Close)
	return conn
}

// tlsNATSEventSources builds event sources for every demo NATS provider, all pointing at url
// with the given TLS config. This replaces the empty provider list that results from not using
// EnableNats: true.
func tlsNATSEventSources(url string, tlsCfg *config.NatsTLSConfiguration) []config.NatsEventSource {
	sources := make([]config.NatsEventSource, len(testenv.DemoNatsProviders))
	for i, id := range testenv.DemoNatsProviders {
		sources[i] = config.NatsEventSource{ID: id, URL: url, TLS: tlsCfg}
	}
	return sources
}

// TestNATSTLSEvents verifies that the router connects to NATS correctly under various TLS scenarios.
// Each sub-test spins up an embedded NATS server and drives a full subscribe → publish → receive cycle.
func TestNATSTLSEvents(t *testing.T) {
	t.Parallel()

	// subscribePublishVerify is the common test body: it subscribes to employeeUpdated(employeeID:3),
	// publishes one event via natsConn, and asserts the subscription response.
	subscribePublishVerify := func(t *testing.T, xEnv *testenv.Environment, natsConn *nats.Conn) {
		t.Helper()

		var sub struct {
			EmployeeUpdated struct {
				ID      float64 `graphql:"id"`
				Details struct {
					Forename string `graphql:"forename"`
					Surname  string `graphql:"surname"`
				} `graphql:"details"`
			} `graphql:"employeeUpdated(employeeID: 3)"`
		}

		surl := xEnv.GraphQLWebSocketSubscriptionURL()
		client := graphql.NewSubscriptionClient(surl)

		resultCh := make(chan natsSubscriptionArgs, 1)
		subscriptionID, err := client.Subscribe(&sub, nil, func(dataValue []byte, errValue error) error {
			resultCh <- natsSubscriptionArgs{dataValue: dataValue, errValue: errValue}
			return nil
		})
		require.NoError(t, err)
		require.NotEmpty(t, subscriptionID)

		clientErrCh := make(chan error, 1)
		go func() { clientErrCh <- client.Run() }()

		xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
		xEnv.WaitForTriggerCount(1, EventWaitTimeout)

		subject := xEnv.GetPubSubName("employeeUpdated.3")
		payload := []byte(`{"id":3,"__typename":"Employee"}`)
		xEnv.NATSPublishUntilReceived(natsConn, subject, payload, 1, EventWaitTimeout)

		testenv.AwaitChannelWithT(t, EventWaitTimeout, resultCh, func(t *testing.T, args natsSubscriptionArgs) {
			require.NoError(t, args.errValue)
			require.JSONEq(t,
				`{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`,
				string(args.dataValue),
			)
		})

		require.NoError(t, client.Close())
		testenv.AwaitChannelWithT(t, EventWaitTimeout, clientErrCh, func(t *testing.T, err error) {
			require.NoError(t, err)
		})
	}

	// Test 1: server requires TLS; router connects using InsecureSkipCaVerification.
	t.Run("router connects when server requires TLS", func(t *testing.T) {
		t.Parallel()

		certs := generateNATSTLSTestCerts(t)
		srv := startTLSNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1, // tells nats to use a free port
			TLS:       true,
			TLSConfig: buildServerTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile),
		})

		serverURL := natsPlainURL(srv)
		natsConn := connectInsecureTLSNATSClient(t, serverURL)
		routerTLS := &config.NatsTLSConfiguration{InsecureSkipCaVerification: true}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSources(serverURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePublishVerify(t, xEnv, natsConn)
		})
	})

	// Test 2: router supplies a custom CA certificate to verify the server certificate.
	t.Run("router uses custom CA certificate", func(t *testing.T) {
		t.Parallel()

		certs := generateNATSTLSTestCerts(t)
		srv := startTLSNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1, // tells nats to use a free port
			TLS:       true,
			TLSConfig: buildServerTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile),
		})

		serverURL := natsPlainURL(srv)
		natsConn := connectInsecureTLSNATSClient(t, serverURL)
		// Router verifies the server certificate against the custom CA — no InsecureSkipVerify.
		routerTLS := &config.NatsTLSConfiguration{CaFile: certs.CACertFile}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSources(serverURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePublishVerify(t, xEnv, natsConn)
		})
	})

	// Test 3: server requires mutual TLS; router presents a client certificate.
	t.Run("router uses mTLS when configured", func(t *testing.T) {
		t.Parallel()

		certs := generateNATSTLSTestCerts(t)
		// Server requires client certs verified against the CA.
		srv := startTLSNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1, // tells nats to use a free port
			TLS:       true,
			TLSVerify: true,
			TLSConfig: buildMTLSServerConfig(t, certs.ServerCertFile, certs.ServerKeyFile, certs.CACertFile),
		})

		serverURL := natsPlainURL(srv)

		// Test client also needs a client cert to connect to the mTLS server.
		clientCert, err := tls.LoadX509KeyPair(certs.ClientCertFile, certs.ClientKeyFile)
		require.NoError(t, err)
		// The extra nats.Secure call overrides the default InsecureSkipVerify-only config and
		// adds the client certificate while keeping InsecureSkipVerify for server cert validation.
		natsConn := connectInsecureTLSNATSClient(t, serverURL,
			nats.Secure(&tls.Config{ //nolint:gosec // test helper only
				InsecureSkipVerify: true,
				Certificates:       []tls.Certificate{clientCert},
			}),
		)

		// Router uses the CA cert to verify the server and presents the client cert/key for mTLS.
		routerTLS := &config.NatsTLSConfiguration{
			CaFile:   certs.CACertFile,
			CertFile: certs.ClientCertFile,
			KeyFile:  certs.ClientKeyFile,
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSources(serverURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePublishVerify(t, xEnv, natsConn)
		})
	})

	// Test 4: router URL uses the "tls://" scheme, which signals the NATS client to use TLS.
	t.Run("router uses TLS when URL scheme is tls://", func(t *testing.T) {
		t.Parallel()

		certs := generateNATSTLSTestCerts(t)
		srv := startTLSNATSServer(t, &natssrv.Options{
			Host:      "127.0.0.1",
			Port:      -1, // tells nats to use a free port
			TLS:       true,
			TLSConfig: buildServerTLSConfig(t, certs.ServerCertFile, certs.ServerKeyFile),
		})

		// Use the tls:// URL from the server directly — this is what gets configured in the router.
		tlsSchemeURL := srv.ClientURL()

		// Test client uses nats:// + explicit Secure option to connect to the same server.
		natsConn := connectInsecureTLSNATSClient(t, natsPlainURL(srv))

		// Router uses the tls:// URL scheme; InsecureSkipCaVerification is required because the
		// embedded server uses a self-signed cert not in the system trust store.
		routerTLS := &config.NatsTLSConfiguration{InsecureSkipCaVerification: true}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				cfg.Providers.Nats = tlsNATSEventSources(tlsSchemeURL, routerTLS)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePublishVerify(t, xEnv, natsConn)
		})
	})
}
