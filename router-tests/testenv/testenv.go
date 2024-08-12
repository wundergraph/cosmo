package testenv

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	pubsubNats "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/trace"

	"github.com/hashicorp/go-cleanhttp"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/hashicorp/go-retryablehttp"
	natsserver "github.com/nats-io/nats-server/v2/server"
	natstest "github.com/nats-io/nats-server/v2/test"
	"github.com/nats-io/nats.go"
	"github.com/phayes/freeport"
	"github.com/stretchr/testify/require"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const (
	natsDefaultSourceName = "default"
	myNatsProviderID      = "my-nats"
	myKafkaProviderID     = "my-kafka"
)

var (
	//go:embed testdata/config.json
	configJSONTemplate string
	demoNatsProviders  = []string{natsDefaultSourceName, myNatsProviderID}
	demoKafkaProviders = []string{myKafkaProviderID}
)

func Run(t *testing.T, cfg *Config, f func(t *testing.T, xEnv *Environment)) {
	t.Helper()
	env, err := createTestEnv(t, cfg)
	if err != nil {
		t.Fatalf("could not create environment: %s", err)
	}
	t.Cleanup(env.Shutdown)
	f(t, env)
}

func Bench(b *testing.B, cfg *Config, f func(b *testing.B, xEnv *Environment)) {
	b.Helper()
	b.StopTimer()
	env, err := createTestEnv(b, cfg)
	if err != nil {
		b.Fatalf("could not create environment: %s", err)
	}
	b.Cleanup(env.Shutdown)
	b.StartTimer()
	f(b, env)
}

type RouterConfig struct {
	StaticConfig        *nodev1.RouterConfig
	ConfigPollerFactory func(config *nodev1.RouterConfig) configpoller.ConfigPoller
}

type Config struct {
	Subgraphs                          SubgraphsConfig
	RouterConfig                       *RouterConfig
	RouterOptions                      []core.Option
	OverrideGraphQLPath                string
	OverrideAbsinthePath               string
	ModifyRouterConfig                 func(routerConfig *nodev1.RouterConfig)
	ModifyEngineExecutionConfiguration func(engineExecutionConfiguration *config.EngineExecutionConfiguration)
	ModifySecurityConfiguration        func(securityConfiguration *config.SecurityConfiguration)
	ModifySubgraphErrorPropagation     func(subgraphErrorPropagation *config.SubgraphErrorPropagationConfiguration)
	ModifyWebsocketConfiguration       func(websocketConfiguration *config.WebSocketConfiguration)
	ModifyCDNConfig                    func(cdnConfig *config.CDNConfiguration)
	KafkaSeeds                         []string
	DisableWebSockets                  bool
	DisableParentBasedSampler          bool
	TLSConfig                          *core.TlsConfig
	TraceExporter                      trace.SpanExporter
	OtelAttributes                     []config.OtelAttribute
	OtelResourceAttributes             []config.OtelResourceAttribute
	MetricReader                       metric.Reader
	PrometheusRegistry                 *prometheus.Registry
	ShutdownDelay                      time.Duration
}

type SubgraphsConfig struct {
	GlobalMiddleware func(http.Handler) http.Handler
	GlobalDelay      time.Duration
	Employees        SubgraphConfig
	Family           SubgraphConfig
	Hobbies          SubgraphConfig
	Products         SubgraphConfig
	ProductsFg       SubgraphConfig
	Test1            SubgraphConfig
	Availability     SubgraphConfig
	Mood             SubgraphConfig
	Countries        SubgraphConfig
}

type SubgraphConfig struct {
	Middleware   func(http.Handler) http.Handler
	Delay        time.Duration
	CloseOnStart bool
}

var (
	envCreateMux sync.Mutex
)

type NatsData struct {
	Connections []*nats.Conn
	Server      *natsserver.Server
}

func setupNatsServers(t testing.TB) (*NatsData, error) {
	length := len(demoNatsProviders)
	natsData := &NatsData{
		Connections: make([]*nats.Conn, 0, length),
	}
	natsPort, err := freeport.GetFreePort()
	if err != nil {
		t.Fatalf("could not get free port: %s", err)
	}

	// create dir in tmp for nats server
	natsDir := filepath.Join(os.TempDir(), fmt.Sprintf("nats-%s", uuid.New()))
	err = os.MkdirAll(natsDir, os.ModePerm)
	if err != nil {
		t.Fatalf("could not create nats dir: %s", err)
	}

	t.Cleanup(func() {
		err := os.RemoveAll(natsDir)
		if err != nil {
			panic(fmt.Errorf("could not remove temporary nats directory, %w", err))
		}
	})

	opts := natsserver.Options{
		Host:      "localhost",
		NoLog:     true,
		NoSigs:    true,
		JetStream: true,
		Port:      natsPort,
		StoreDir:  natsDir,
	}

	natsServer := natstest.RunServer(&opts)
	if natsServer == nil {
		t.Fatalf("could not start NATS test server")
	}
	natsData.Server = natsServer
	for range demoNatsProviders {
		natsConnection, err := nats.Connect(
			natsServer.ClientURL(),
			nats.MaxReconnects(10),
			nats.ReconnectWait(1*time.Second),
			nats.Timeout(5*time.Second),
		)
		if err != nil {
			return nil, err
		}
		natsData.Connections = append(natsData.Connections, natsConnection)
	}
	return natsData, nil
}

func createTestEnv(t testing.TB, cfg *Config) (*Environment, error) {
	// Ensure that only one test environment is created at a time
	// We use freeport to get a free port for NATS and the Router
	// If we don't lock here, two parallel tests might get the same port
	envCreateMux.Lock()
	defer envCreateMux.Unlock()

	ctx, cancel := context.WithCancelCause(context.Background())

	if len(cfg.KafkaSeeds) == 0 {
		cfg.KafkaSeeds = []string{"localhost:9092"}
	}

	var kafkaAdminClient *kadm.Client
	var kafkaClient *kgo.Client
	{
		client, err := kgo.NewClient(
			kgo.SeedBrokers(cfg.KafkaSeeds...),
		)
		if err != nil {
			t.Fatalf("could not create kafka client: %s", err)
		}

		kafkaClient = client

		kafkaAdminClient = kadm.NewClient(client)
	}

	natsData, err := setupNatsServers(t)
	if err != nil {
		return nil, err
	}
	require.Equal(t, 2, len(natsData.Connections))

	counters := &SubgraphRequestCount{
		Global:       atomic.NewInt64(0),
		Employees:    atomic.NewInt64(0),
		Family:       atomic.NewInt64(0),
		Hobbies:      atomic.NewInt64(0),
		Products:     atomic.NewInt64(0),
		ProductFg:    atomic.NewInt64(0),
		Test1:        atomic.NewInt64(0),
		Availability: atomic.NewInt64(0),
		Mood:         atomic.NewInt64(0),
		Countries:    atomic.NewInt64(0),
	}

	employees := &Subgraph{
		handler:          subgraphs.EmployeesHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Employees.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Employees,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Employees.Delay,
	}

	family := &Subgraph{
		handler:          subgraphs.FamilyHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Family.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Family,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Family.Delay,
	}

	hobbies := &Subgraph{
		handler:          subgraphs.HobbiesHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Hobbies.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Hobbies,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Hobbies.Delay,
	}

	products := &Subgraph{
		handler:          subgraphs.ProductsHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Products.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Products,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Products.Delay,
	}

	productsFg := &Subgraph{
		handler:          subgraphs.ProductsFGHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.ProductsFg.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.ProductFg,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.ProductsFg.Delay,
	}

	test1 := &Subgraph{
		handler:          subgraphs.Test1Handler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Test1.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Test1,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Test1.Delay,
	}

	availability := &Subgraph{
		handler:          subgraphs.AvailabilityHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Availability.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Availability,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Availability.Delay,
	}

	mood := &Subgraph{
		handler:          subgraphs.MoodHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Mood.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Mood,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Mood.Delay,
	}

	countries := &Subgraph{
		handler:          subgraphs.CountriesHandler(subgraphOptions(ctx, t, natsData.Server)),
		middleware:       cfg.Subgraphs.Countries.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Countries,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Countries.Delay,
	}

	employeesServer := httptest.NewServer(employees)
	familyServer := httptest.NewServer(family)
	hobbiesServer := httptest.NewServer(hobbies)
	productsServer := httptest.NewServer(products)
	test1Server := httptest.NewServer(test1)
	availabilityServer := httptest.NewServer(availability)
	moodServer := httptest.NewServer(mood)
	countriesServer := httptest.NewServer(countries)
	productFgServer := httptest.NewServer(productsFg)

	replacements := map[string]string{
		subgraphs.EmployeesDefaultDemoURL:    gqlURL(employeesServer),
		subgraphs.FamilyDefaultDemoURL:       gqlURL(familyServer),
		subgraphs.HobbiesDefaultDemoURL:      gqlURL(hobbiesServer),
		subgraphs.ProductsDefaultDemoURL:     gqlURL(productsServer),
		subgraphs.Test1DefaultDemoURL:        gqlURL(test1Server),
		subgraphs.AvailabilityDefaultDemoURL: gqlURL(availabilityServer),
		subgraphs.MoodDefaultDemoURL:         gqlURL(moodServer),
		subgraphs.CountriesDefaultDemoURL:    gqlURL(countriesServer),
		subgraphs.ProductsFgDefaultDemoURL:   gqlURL(productFgServer),
	}

	replaced := configJSONTemplate

	for k, v := range replacements {
		replaced = strings.ReplaceAll(replaced, k, v)
	}

	var routerConfig nodev1.RouterConfig
	if err := protojson.Unmarshal([]byte(replaced), &routerConfig); err != nil {
		return nil, err
	}

	if cfg.ModifyRouterConfig != nil {
		cfg.ModifyRouterConfig(&routerConfig)
	}

	cdn := setupCDNServer()

	routerPort, err := freeport.GetFreePort()
	if err != nil {
		t.Fatalf("could not get free port: %s", err)
	}

	listenerAddr := fmt.Sprintf("localhost:%d", routerPort)

	client := retryablehttp.NewClient()
	client.Logger = nil
	client.RetryMax = 10
	client.RetryWaitMin = 100 * time.Millisecond

	rr, err := configureRouter(listenerAddr, cfg, &routerConfig, cdn, natsData.Server)
	if err != nil {
		return nil, err
	}

	if cfg.TLSConfig != nil && cfg.TLSConfig.Enabled {

		cert, err := tls.LoadX509KeyPair(cfg.TLSConfig.CertFile, cfg.TLSConfig.KeyFile)
		require.NoError(t, err)

		caCert, err := os.ReadFile(cfg.TLSConfig.CertFile)
		if err != nil {
			log.Fatal(err)
		}

		caCertPool := x509.NewCertPool()
		if ok := caCertPool.AppendCertsFromPEM(caCert); !ok {
			t.Fatalf("could not append ca cert to pool")
		}

		// Retain the default transport settings
		httpClient := cleanhttp.DefaultPooledClient()
		httpClient.Transport.(*http.Transport).TLSClientConfig = &tls.Config{
			RootCAs:      caCertPool,
			Certificates: []tls.Certificate{cert},
		}

		client.HTTPClient = httpClient
	}

	go func() {
		if err := rr.Start(ctx); err != nil {
			t.Fatal("Could not start router", zap.Error(err))
		}
	}()

	graphQLPath := "/graphql"
	if cfg.OverrideGraphQLPath != "" {
		graphQLPath = cfg.OverrideGraphQLPath
	}

	absinthePath := "/absinthe/socket"
	if cfg.OverrideAbsinthePath != "" {
		absinthePath = cfg.OverrideAbsinthePath
	}

	if cfg.Subgraphs.Employees.CloseOnStart {
		employeesServer.Close()
	}
	if cfg.Subgraphs.Family.CloseOnStart {
		familyServer.Close()
	}
	if cfg.Subgraphs.Hobbies.CloseOnStart {
		hobbiesServer.Close()
	}
	if cfg.Subgraphs.Products.CloseOnStart {
		productsServer.Close()
	}
	if cfg.Subgraphs.Test1.CloseOnStart {
		test1Server.Close()
	}
	if cfg.Subgraphs.Availability.CloseOnStart {
		availabilityServer.Close()
	}
	if cfg.Subgraphs.Mood.CloseOnStart {
		moodServer.Close()
	}
	if cfg.Subgraphs.Countries.CloseOnStart {
		countriesServer.Close()
	}
	if cfg.Subgraphs.ProductsFg.CloseOnStart {
		productFgServer.Close()
	}

	if cfg.ShutdownDelay == 0 {
		cfg.ShutdownDelay = 30 * time.Second
	}

	e := &Environment{
		t:                       t,
		routerConfigVersionMain: routerConfig.Version,
		graphQLPath:             graphQLPath,
		absinthePath:            absinthePath,
		Context:                 ctx,
		cancel:                  cancel,
		Router:                  rr,
		RouterURL:               rr.BaseURL(),
		RouterClient:            client.StandardClient(),
		CDN:                     cdn,
		NatsServer:              natsData.Server,
		NatsConnectionDefault:   natsData.Connections[0],
		NatsConnectionMyNats:    natsData.Connections[1],
		SubgraphRequestCount:    counters,
		KafkaAdminClient:        kafkaAdminClient,
		KafkaClient:             kafkaClient,
		shutdownDelay:           cfg.ShutdownDelay,
		shutdown:                atomic.NewBool(false),
		Servers: []*httptest.Server{
			employeesServer,
			familyServer,
			hobbiesServer,
			productsServer,
			test1Server,
			availabilityServer,
			moodServer,
			countriesServer,
		},
	}

	if routerConfig.FeatureFlagConfigs != nil {
		myFF, ok := routerConfig.FeatureFlagConfigs.ConfigByFeatureFlagName["myff"]
		if ok {
			e.routerConfigVersionMyFF = myFF.Version
		}
	}

	e.WaitForServer(ctx, e.RouterURL+"/health/live", 100, 10)

	return e, nil
}

func configureRouter(listenerAddr string, testConfig *Config, routerConfig *nodev1.RouterConfig, cdn *httptest.Server, natsServer *natsserver.Server) (*core.Router, error) {
	cfg := config.Config{
		Graph: config.Graph{},
		CDN: config.CDNConfiguration{
			URL:       cdn.URL,
			CacheSize: 1024 * 1024,
		},
		SubgraphErrorPropagation: config.SubgraphErrorPropagationConfiguration{
			Enabled:              true,
			PropagateStatusCodes: true,
			Mode:                 config.SubgraphErrorPropagationModeWrapped,
			OmitExtensions:       false,
			OmitLocations:        true,
			RewritePaths:         true,
		},
	}

	if testConfig.ModifyCDNConfig != nil {
		testConfig.ModifyCDNConfig(&cfg.CDN)
	}

	ec := zap.NewProductionEncoderConfig()
	ec.EncodeDuration = zapcore.SecondsDurationEncoder
	ec.TimeKey = "time"

	syncer := zapcore.AddSync(os.Stderr)

	zapLogger := zap.New(zapcore.NewCore(
		zapcore.NewConsoleEncoder(ec),
		syncer,
		zapcore.ErrorLevel,
	))

	t := jwt.New(jwt.SigningMethodHS256)
	t.Claims = testTokenClaims()
	graphApiToken, err := t.SignedString([]byte("hunter2"))
	if err != nil {
		return nil, err
	}

	engineExecutionConfig := config.EngineExecutionConfiguration{
		EnableWebSocketEpollKqueue:             true,
		EnableSingleFlight:                     true,
		EnableRequestTracing:                   true,
		EnableExecutionPlanCacheResponseHeader: true,
		EnableNormalizationCache:               true,
		NormalizationCacheSize:                 1024,
		Debug: config.EngineDebugConfiguration{
			ReportWebSocketConnections:                   true,
			PrintQueryPlans:                              false,
			EnablePersistedOperationsCacheResponseHeader: true,
			EnableNormalizationCacheResponseHeader:       true,
		},
		EpollKqueuePollTimeout:         300 * time.Millisecond,
		EpollKqueueConnBufferSize:      1,
		WebSocketReadTimeout:           time.Millisecond * 100,
		MaxConcurrentResolvers:         32,
		ExecutionPlanCacheSize:         1024,
		EnablePersistedOperationsCache: true,
		ParseKitPoolSize:               8,
		EnableValidationCache:          true,
		ValidationCacheSize:            1024,
	}
	if testConfig.ModifyEngineExecutionConfiguration != nil {
		testConfig.ModifyEngineExecutionConfiguration(&engineExecutionConfig)
	}

	if testConfig.ModifySecurityConfiguration != nil {
		testConfig.ModifySecurityConfiguration(&cfg.SecurityConfiguration)
	}

	if testConfig.ModifySubgraphErrorPropagation != nil {
		testConfig.ModifySubgraphErrorPropagation(&cfg.SubgraphErrorPropagation)
	}

	natsEventSources := make([]config.NatsEventSource, len(demoNatsProviders))
	kafkaEventSources := make([]config.KafkaEventSource, len(demoKafkaProviders))

	for _, sourceName := range demoNatsProviders {
		natsEventSources = append(natsEventSources, config.NatsEventSource{
			ID:  sourceName,
			URL: natsServer.ClientURL(),
		})
	}
	for _, sourceName := range demoKafkaProviders {
		kafkaEventSources = append(kafkaEventSources, config.KafkaEventSource{
			ID:      sourceName,
			Brokers: testConfig.KafkaSeeds,
		})
	}

	routerOpts := []core.Option{
		core.WithLogger(zapLogger),
		core.WithGraphApiToken(graphApiToken),
		core.WithDevelopmentMode(true),
		core.WithPlayground(true),
		core.WithEngineExecutionConfig(engineExecutionConfig),
		core.WithSecurityConfig(cfg.SecurityConfiguration),
		core.WithCDN(cfg.CDN),
		core.WithListenerAddr(listenerAddr),
		core.WithSubgraphErrorPropagation(cfg.SubgraphErrorPropagation),
		core.WithTLSConfig(testConfig.TLSConfig),
		core.WithInstanceID("test-instance"),
		core.WithGracePeriod(15 * time.Second),
		core.WithIntrospection(true),
		core.WithEvents(config.EventsConfiguration{
			Providers: config.EventProviders{
				Nats:  natsEventSources,
				Kafka: kafkaEventSources,
			},
		}),
	}
	routerOpts = append(routerOpts, testConfig.RouterOptions...)

	if testConfig.RouterConfig != nil {
		if testConfig.RouterConfig.StaticConfig != nil {
			routerOpts = append(routerOpts, core.WithStaticExecutionConfig(testConfig.RouterConfig.StaticConfig))
		} else if testConfig.RouterConfig.ConfigPollerFactory != nil {
			routerOpts = append(routerOpts, core.WithConfigPoller(testConfig.RouterConfig.ConfigPollerFactory(routerConfig)))
		} else {
			return nil, errors.New("router config is nil")
		}
	} else if routerConfig != nil {
		routerOpts = append(routerOpts, core.WithStaticExecutionConfig(routerConfig))
	}

	if testConfig.TraceExporter != nil {
		c := core.TraceConfigFromTelemetry(&config.Telemetry{
			ServiceName:        "cosmo-router",
			Attributes:         testConfig.OtelAttributes,
			ResourceAttributes: testConfig.OtelResourceAttributes,
			Tracing: config.Tracing{
				Enabled:            true,
				SamplingRate:       1,
				ParentBasedSampler: !testConfig.DisableParentBasedSampler,
				Exporters:          []config.TracingExporter{},
				Propagation: config.PropagationConfig{
					TraceContext: true,
				},
				TracingGlobalFeatures: config.TracingGlobalFeatures{},
			},
		})

		c.TestMemoryExporter = testConfig.TraceExporter

		routerOpts = append(routerOpts, core.WithTracing(c))
	}

	var prometheusConfig rmetric.PrometheusConfig

	if testConfig.PrometheusRegistry != nil {
		port, err := freeport.GetFreePort()
		if err != nil {
			return nil, fmt.Errorf("could not get free port: %w", err)
		}
		prometheusConfig = rmetric.PrometheusConfig{
			Enabled:      true,
			ListenAddr:   fmt.Sprintf("localhost:%d", port),
			Path:         "/metrics",
			TestRegistry: testConfig.PrometheusRegistry,
		}
	}

	if testConfig.MetricReader != nil {
		c := core.MetricConfigFromTelemetry(&config.Telemetry{
			ServiceName:        "cosmo-router",
			Attributes:         testConfig.OtelAttributes,
			ResourceAttributes: testConfig.OtelResourceAttributes,
			Tracing:            config.Tracing{},
			Metrics: config.Metrics{
				Prometheus: config.Prometheus{
					Enabled: true,
				},
				OTLP: config.MetricsOTLP{
					Enabled:       true,
					RouterRuntime: false,
				},
			},
		})

		c.Prometheus = prometheusConfig
		c.OpenTelemetry.TestReader = testConfig.MetricReader

		routerOpts = append(routerOpts, core.WithMetrics(c))

	}

	if testConfig.OverrideGraphQLPath != "" {
		routerOpts = append(routerOpts, core.WithGraphQLPath(testConfig.OverrideGraphQLPath))
	}

	if !testConfig.DisableWebSockets {
		wsConfig := &config.WebSocketConfiguration{
			Enabled: true,
			AbsintheProtocol: config.AbsintheProtocolConfiguration{
				Enabled:     true,
				HandlerPath: "/absinthe/socket",
			},
			ForwardUpgradeHeaders: config.ForwardUpgradeHeadersConfiguration{
				Enabled: true,
				AllowList: []string{
					"Authorization",
					"X-Custom-*",
					"Canonical-Header-Name",
					"reverse-canonical-header-name",
				},
			},
			ForwardUpgradeQueryParams: config.ForwardUpgradeQueryParamsConfiguration{
				Enabled: true,
				AllowList: []string{
					"token",
					"Authorization",
					"x-custom-*",
				},
			},
			ForwardInitialPayload: true,
		}
		if testConfig.ModifyWebsocketConfiguration != nil {
			testConfig.ModifyWebsocketConfiguration(wsConfig)
		}
		routerOpts = append(routerOpts, core.WithWebSocketConfiguration(wsConfig))
	}
	return core.NewRouter(routerOpts...)
}

func testTokenClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"federated_graph_id": "graph",
		"organization_id":    "organization",
	}
}

func setupCDNServer() *httptest.Server {
	cdnFileServer := http.FileServer(http.Dir(filepath.Join("testenv", "testdata", "cdn")))
	var cdnRequestLog []string
	cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			requestLog, err := json.Marshal(cdnRequestLog)
			if err != nil {
				panic(err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, err = w.Write(requestLog)
			if err != nil {
				panic(err)
			}
			return
		}
		cdnRequestLog = append(cdnRequestLog, r.Method+" "+r.URL.Path)
		// Ensure we have an authorization header with a valid token
		authorization := r.Header.Get("Authorization")
		if authorization == "" {
			panic("missing authorization header")
		}
		token := authorization[len("Bearer "):]
		parsedClaims := make(jwt.MapClaims)
		jwtParser := new(jwt.Parser)
		_, _, err := jwtParser.ParseUnverified(token, parsedClaims)
		if err != nil {
			panic(err)
		}
		cdnFileServer.ServeHTTP(w, r)
	}))
	return cdnServer
}

func gqlURL(srv *httptest.Server) string {
	path, err := url.JoinPath(srv.URL, "/graphql")
	if err != nil {
		panic(err)
	}
	return path
}

type Environment struct {
	t                     testing.TB
	graphQLPath           string
	absinthePath          string
	shutdown              *atomic.Bool
	Context               context.Context
	cancel                context.CancelCauseFunc
	Router                *core.Router
	RouterURL             string
	RouterClient          *http.Client
	Servers               []*httptest.Server
	CDN                   *httptest.Server
	NatsServer            *natsserver.Server
	NatsConnectionDefault *nats.Conn
	NatsConnectionMyNats  *nats.Conn
	SubgraphRequestCount  *SubgraphRequestCount
	KafkaAdminClient      *kadm.Client
	KafkaClient           *kgo.Client
	shutdownDelay         time.Duration

	extraURLQueryValues url.Values

	routerConfigVersionMain string
	routerConfigVersionMyFF string
}

func (e *Environment) RouterConfigVersionMain() string {
	return e.routerConfigVersionMain
}

func (e *Environment) RouterConfigVersionMyFF() string {
	return e.routerConfigVersionMyFF
}

func (e *Environment) SetExtraURLQueryValues(values url.Values) {
	e.extraURLQueryValues = values
}

// Shutdown closes all resources associated with the test environment. Can be called multiple times but will only
// shut down resources once.
func (e *Environment) Shutdown() {
	if e.shutdown.Load() {
		return
	}

	e.shutdown.Store(true)

	ctx, cancel := context.WithTimeout(e.Context, e.shutdownDelay)
	defer cancel()

	// Gracefully shutdown router
	err := e.Router.Shutdown(ctx)
	if err != nil && !errors.Is(err, context.DeadlineExceeded) {
		e.t.Errorf("could not shutdown router: %s", err)
	}

	// Terminate test server resources
	e.cancel(errors.New("test environment closed"))

	// Close all test servers
	for _, s := range e.Servers {
		s.CloseClientConnections()
	}

	// Close the CDN
	e.CDN.CloseClientConnections()

	// Close NATS
	e.NatsConnectionDefault.Close()
	e.NatsConnectionMyNats.Close()
	e.NatsServer.Shutdown()

	// Close Kafka
	e.KafkaAdminClient.Close()
	e.KafkaClient.Close()
}

type SubgraphRequestCount struct {
	Global       *atomic.Int64
	Employees    *atomic.Int64
	Family       *atomic.Int64
	Hobbies      *atomic.Int64
	Products     *atomic.Int64
	ProductFg    *atomic.Int64
	Test1        *atomic.Int64
	Availability *atomic.Int64
	Mood         *atomic.Int64
	Countries    *atomic.Int64
}

type GraphQLRequest struct {
	Query         string          `json:"query"`
	Variables     json.RawMessage `json:"variables,omitempty"`
	Extensions    json.RawMessage `json:"extensions,omitempty"`
	OperationName json.RawMessage `json:"operationName,omitempty"`
	Header        http.Header     `json:"-"`
	Files         [][]byte        `json:"-"`
}

type TestResponse struct {
	Body     string
	Response *http.Response
	Proto    string
}

func (e *Environment) WaitForServer(ctx context.Context, url string, timeoutMs int, maxAttempts int) {
	for {
		if maxAttempts == 0 {
			e.t.Fatalf("timed out waiting for server to be ready")
		}
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for router to be ready")
		default:
			req, err := http.NewRequest("GET", url, nil)
			if err != nil {
				e.t.Fatalf("Could not create request for health check")
			}
			req.Header.Set("User-Agent", "Router-tests")
			resp, err := e.RouterClient.Do(req)
			if err == nil && resp.StatusCode == 200 {
				return
			}
			time.Sleep(time.Millisecond * time.Duration(timeoutMs))
			maxAttempts--
		}
	}
}

func (e *Environment) MakeGraphQLRequestOK(request GraphQLRequest) *TestResponse {
	var resp *TestResponse
	var err error
	if request.Files == nil {
		resp, err = e.MakeGraphQLRequest(request)
	} else {
		resp, err = e.MakeGraphQLRequestAsMultipartForm(request)
	}
	require.NoError(e.t, err)
	require.Equal(e.t, http.StatusOK, resp.Response.StatusCode)
	return resp
}

func (e *Environment) MakeGraphQLRequestWithContext(ctx context.Context, request GraphQLRequest) (*TestResponse, error) {
	return e.makeGraphQLRequest(ctx, request)
}

func (e *Environment) makeGraphQLRequest(ctx context.Context, request GraphQLRequest) (*TestResponse, error) {
	data, err := json.Marshal(request)
	require.NoError(e.t, err)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.GraphQLRequestURL(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if request.Header != nil {
		req.Header = request.Header
	}
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := e.RouterClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(resp.Body)
	if err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(buf.Bytes()))
	body := buf.String()
	return &TestResponse{
		Body:     strings.TrimSpace(body),
		Response: resp,
		Proto:    resp.Proto,
	}, nil
}

func (e *Environment) MakeGraphQLRequest(request GraphQLRequest) (*TestResponse, error) {
	return e.makeGraphQLRequest(e.Context, request)
}

func (e *Environment) MakeGraphQLRequestAsMultipartForm(request GraphQLRequest) (*TestResponse, error) {
	data, err := json.Marshal(request)
	require.NoError(e.t, err)
	formValues := make(map[string]io.Reader)
	formValues["operations"] = bytes.NewReader(data)

	if len(request.Files) == 1 {
		formValues["map"] = strings.NewReader(`{ "0": ["variables.file"] }`)
		formValues["0"] = bytes.NewReader(request.Files[0])
	} else {
		mapStr := `{`
		for i := 0; i < len(request.Files); i++ {
			if i > 0 {
				mapStr += ", "
			}
			mapStr += fmt.Sprintf(`"%d": ["variables.files.%d"]`, i, i)
		}
		mapStr += `}`
		formValues["map"] = strings.NewReader(mapStr)
		for i := 0; i < len(request.Files); i++ {
			formValues[fmt.Sprintf("%d", i)] = bytes.NewReader(request.Files[i])
		}
	}

	multipartBody, contentType, err := multipartBytes(formValues)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(e.Context, http.MethodPost, e.GraphQLRequestURL(), &multipartBody)
	if err != nil {
		return nil, err
	}

	if request.Header != nil {
		req.Header = request.Header
	}
	req.Header.Add("Content-Type", contentType)

	resp, err := e.RouterClient.Do(req)
	if err != nil {
		return nil, err
	}

	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(resp.Body)
	if err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(buf.Bytes()))
	body := buf.String()

	return &TestResponse{
		Body:     strings.TrimSpace(body),
		Response: resp,
		Proto:    resp.Proto,
	}, nil
}

func multipartBytes(values map[string]io.Reader) (bytes.Buffer, string, error) {
	var err error
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for key, r := range values {
		var fw io.Writer
		x, ok := r.(io.Closer)
		if key != "operations" && key != "map" {
			// Add a file
			if fw, err = w.CreateFormFile(key, uuid.NewString()); err != nil {
				return b, "", err
			}
		} else {
			// Add other fields
			if fw, err = w.CreateFormField(key); err != nil {
				return b, "", err
			}
		}
		if _, err = io.Copy(fw, r); err != nil {
			return b, "", err
		}
		if ok {
			x.Close()
		}
	}
	w.Close()

	return b, w.FormDataContentType(), nil
}

func (e *Environment) MakeRequest(method, path string, header http.Header, body io.Reader) (*http.Response, error) {
	requestURL, err := url.JoinPath(e.RouterURL, path)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(e.Context, method, requestURL, body)
	if err != nil {
		return nil, err
	}
	req.Header = header

	return e.RouterClient.Do(req)
}

func (e *Environment) GraphQLRequestURL() string {
	urlStr, err := url.JoinPath(e.RouterURL, e.graphQLPath)
	require.NoError(e.t, err)
	if e.extraURLQueryValues != nil {
		u, err := url.Parse(urlStr)
		require.NoError(e.t, err)
		u.RawQuery = e.extraURLQueryValues.Encode()
		urlStr = u.String()
	}
	return urlStr
}

func (e *Environment) GraphQLSubscriptionURL() string {
	u, err := url.Parse(e.GraphQLRequestURL())
	require.NoError(e.t, err)
	u.Scheme = "ws"
	return u.String()
}

func (e *Environment) AbsintheSubscriptionURL() string {
	joined, err := url.JoinPath(e.RouterURL, e.absinthePath)
	require.NoError(e.t, err)
	u, err := url.Parse(joined)
	require.NoError(e.t, err)
	u.Scheme = "ws"
	return u.String()
}

func (e *Environment) GraphQLServeSentEventsURL() string {
	u, err := url.Parse(e.GraphQLRequestURL())
	require.NoError(e.t, err)
	u.RawQuery = "wg_sse"
	return u.String()
}

type WebSocketMessage struct {
	ID      string          `json:"id,omitempty"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type GraphQLResponse struct {
	Data   json.RawMessage `json:"data,omitempty"`
	Errors []GraphQLError  `json:"errors,omitempty"`
}

type GraphQLError struct {
	Message string `json:"message"`
}

const maxSocketRetries = 5

func (e *Environment) GraphQLWebsocketDialWithRetry(header http.Header, query url.Values) (*websocket.Conn, *http.Response, error) {
	dialer := websocket.Dialer{
		Subprotocols: []string{"graphql-transport-ws"},
	}

	waitBetweenRetriesInMs := rand.Intn(10)
	timeToSleep := time.Duration(waitBetweenRetriesInMs) * time.Millisecond

	var err error

	for i := 0; i <= maxSocketRetries; i++ {
		urlStr := e.GraphQLSubscriptionURL()
		if query != nil {
			urlStr += "?" + query.Encode()
		}
		conn, resp, err := dialer.Dial(urlStr, header)

		if resp != nil && err == nil {
			return conn, resp, err
		}

		if errors.Is(err, websocket.ErrBadHandshake) {
			return conn, resp, err
		}

		// Make sure that on the final attempt we won't wait
		if i != maxSocketRetries {
			time.Sleep(timeToSleep)
			timeToSleep *= 2
		}
	}

	return nil, nil, err
}

func (e *Environment) InitGraphQLWebSocketConnection(header http.Header, query url.Values, initialPayload json.RawMessage) *websocket.Conn {
	conn, _, err := e.GraphQLWebsocketDialWithRetry(header, query)
	require.NoError(e.t, err)
	e.t.Cleanup(func() {
		_ = conn.Close()
	})
	err = conn.WriteJSON(WebSocketMessage{
		Type:    "connection_init",
		Payload: initialPayload,
	})
	require.NoError(e.t, err)
	var ack WebSocketMessage
	err = conn.ReadJSON(&ack)
	require.NoError(e.t, err)
	require.Equal(e.t, "connection_ack", ack.Type)
	return conn
}

func (e *Environment) AbsintheWebsocketDialWithRetry(header http.Header) (*websocket.Conn, *http.Response, error) {
	dialer := websocket.Dialer{
		// Subprotocols: []string{"absinthe"}, explicitly removed as this needs to be added by the absinthe handler
	}

	waitBetweenRetriesInMs := rand.Intn(10)
	timeToSleep := time.Duration(waitBetweenRetriesInMs) * time.Millisecond

	var err error

	for i := 0; i < maxSocketRetries; i++ {
		u := e.AbsintheSubscriptionURL()

		conn, resp, err := dialer.Dial(u, header)

		if resp != nil && err == nil {
			return conn, resp, err
		}

		if errors.Is(err, websocket.ErrBadHandshake) {
			return conn, resp, err
		}

		// Make sure that on the final attempt we won't wait
		if i != maxSocketRetries {
			time.Sleep(timeToSleep)
			timeToSleep *= 2
		}
	}

	return nil, nil, err
}

func (e *Environment) InitAbsintheWebSocketConnection(header http.Header, initialPayload json.RawMessage) *websocket.Conn {
	conn, _, err := e.AbsintheWebsocketDialWithRetry(header)
	require.NoError(e.t, err)
	e.t.Cleanup(func() {
		_ = conn.Close()
	})
	err = conn.WriteJSON(initialPayload)
	require.NoError(e.t, err)
	var ack json.RawMessage
	err = conn.ReadJSON(&ack)
	require.NoError(e.t, err)
	require.Equal(e.t, string(ack), `["1","1","__absinthe__:control","phx_reply",{"status":"ok","response":{}}]`)
	return conn
}

func (e *Environment) WaitForSubscriptionCount(desiredCount uint64, timeout time.Duration) {
	e.t.Helper()

	report := e.Router.WebsocketStats.GetReport()
	if report.Subscriptions == desiredCount {
		return
	}

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	sub := e.Router.WebsocketStats.Subscribe(ctx)

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for subscription count, got %d, want %d", report.Subscriptions, desiredCount)
			return
		case r, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for subscription count, got %d, want %d", r.Subscriptions, desiredCount)
				return
			}
			report = r
			if report.Subscriptions == desiredCount {
				time.Sleep(100 * time.Millisecond) // Give NATS some time to have the subscription set up
				return
			}
		}
	}
}

func (e *Environment) WaitForConnectionCount(desiredCount uint64, timeout time.Duration) {
	e.t.Helper()

	report := e.Router.WebsocketStats.GetReport()

	if report.Connections == desiredCount {
		return
	}

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	sub := e.Router.WebsocketStats.Subscribe(ctx)

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for connection count, got %d, want %d", report.Connections, desiredCount)
			return
		case r, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for connection count, got %d, want %d", r.Connections, desiredCount)
				return
			}
			report = r
			if report.Connections == desiredCount {
				return
			}
		}
	}
}

func (e *Environment) WaitForMessagesSent(desiredCount uint64, timeout time.Duration) {
	e.t.Helper()

	report := e.Router.WebsocketStats.GetReport()
	if report.MessagesSent == desiredCount {
		return
	}

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	sub := e.Router.WebsocketStats.Subscribe(ctx)

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for messages sent, got %d, want %d", report.MessagesSent, desiredCount)
			return
		case r, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for messages sent, got %d, want %d", r.MessagesSent, desiredCount)
				return
			}
			report = r
			if report.MessagesSent == desiredCount {
				return
			}
		}
	}
}

func (e *Environment) WaitForTriggerCount(desiredCount uint64, timeout time.Duration) {
	e.t.Helper()

	report := e.Router.WebsocketStats.GetReport()
	if report.Triggers == desiredCount {
		return
	}

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	sub := e.Router.WebsocketStats.Subscribe(ctx)

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for trigger count, got %d, want %d", report.Triggers, desiredCount)
			return
		case r, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for trigger count, got %d, want %d", r.Triggers, desiredCount)
				return
			}
			report = r
			if report.Triggers == desiredCount {
				return
			}
		}
	}

}

func subgraphOptions(ctx context.Context, t testing.TB, natsServer *natsserver.Server) *subgraphs.SubgraphOptions {
	natsPubSubByProviderID := make(map[string]pubsub_datasource.NatsPubSub, len(demoNatsProviders))
	for _, sourceName := range demoNatsProviders {
		natsConnection, err := nats.Connect(natsServer.ClientURL())
		require.NoError(t, err)

		js, err := jetstream.New(natsConnection)
		require.NoError(t, err)

		natsPubSubByProviderID[sourceName] = pubsubNats.NewConnector(zap.NewNop(), natsConnection, js).New(ctx)
	}

	return &subgraphs.SubgraphOptions{
		NatsPubSubByProviderID: natsPubSubByProviderID,
	}
}

type Subgraph struct {
	handler          http.Handler
	globalMiddleware func(http.Handler) http.Handler
	middleware       func(http.Handler) http.Handler

	globalDelay time.Duration
	localDelay  time.Duration

	globalCounter *atomic.Int64
	localCounter  *atomic.Int64
}

func (s *Subgraph) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.globalCounter.Inc()
	s.localCounter.Inc()

	if s.globalDelay > 0 {
		time.Sleep(s.globalDelay)
	}
	if s.localDelay > 0 {
		time.Sleep(s.localDelay)
	}

	if s.globalMiddleware != nil {
		s.globalMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if s.middleware != nil {
				s.middleware(s.handler).ServeHTTP(w, r)
				return
			}
			s.handler.ServeHTTP(w, r)
		})).ServeHTTP(w, r)
		return
	}
	if s.middleware != nil {
		s.middleware(s.handler).ServeHTTP(w, r)
		return
	}
	s.handler.ServeHTTP(w, r)
}
