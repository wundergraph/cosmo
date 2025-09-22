package testenv

import (
	"bufio"
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
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cloudflare/backoff"
	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/hashicorp/consul/sdk/freeport"
	"github.com/hashicorp/go-cleanhttp"
	"github.com/hashicorp/go-retryablehttp"
	"github.com/nats-io/nats.go"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/service"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	pubsubNats "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

var ErrEnvironmentClosed = errors.New("test environment closed")

const (
	natsDefaultSourceName = "default"
	myNatsProviderID      = "my-nats"
	myKafkaProviderID     = "my-kafka"
	myRedisProviderID     = "my-redis"
)

var (
	//go:embed testdata/config.json
	ConfigJSONTemplate string
	//go:embed testdata/configWithEdfs.json
	ConfigWithEdfsJSONTemplate string
	//go:embed testdata/configWithEdfsKafka.json
	ConfigWithEdfsKafkaJSONTemplate string
	//go:embed testdata/configWithEdfsNats.json
	ConfigWithEdfsNatsJSONTemplate string
	//go:embed testdata/configWithEdfsRedis.json
	ConfigWithEdfsRedisJSONTemplate string
	//go:embed testdata/configWithPlugins.json
	ConfigWithPluginsJSONTemplate string
	//go:embed testdata/configWithGRPC.json
	ConfigWithGRPCJSONTemplate string
	//go:embed testdata/configWithRequireFetchReasons.json
	ConfigWithRequireFetchReasonsJSONTemplate string

	DemoNatsProviders  = []string{natsDefaultSourceName, myNatsProviderID}
	DemoKafkaProviders = []string{myKafkaProviderID}
	DemoRedisProviders = []string{myRedisProviderID}
)

func init() {
	freeport.SetLogLevel(freeport.ERROR)
}

// Run runs the test and fails the test if an error occurs
func Run(t *testing.T, cfg *Config, f func(t *testing.T, xEnv *Environment)) {
	t.Helper()
	env, err := CreateTestEnv(t, cfg)
	if env != nil {
		t.Cleanup(env.Shutdown)
	}
	if err != nil {
		t.Fatalf("could not create environment: %s", err)
	}
	f(t, env)
	if cfg.AssertCacheMetrics != nil {
		assertCacheMetrics(t, env, cfg.AssertCacheMetrics.BaseGraphAssertions, "")

		for ff, v := range cfg.AssertCacheMetrics.FeatureFlagAssertions {
			assertCacheMetrics(t, env, v, ff)
		}
	}
}

// FailsOnStartup runs the test and ensures that the router fails during bootstrapping
func FailsOnStartup(t *testing.T, cfg *Config, f func(t *testing.T, err error)) {
	t.Helper()
	env, err := CreateTestEnv(t, cfg)
	require.Error(t, err)
	require.Nil(t, env)
	f(t, err)
}

// RunWithError runs the test but returns an error instead of failing the test
// Useful when you want to assert errors during router bootstrapping
func RunWithError(t *testing.T, cfg *Config, f func(t *testing.T, xEnv *Environment)) error {
	t.Helper()
	env, err := CreateTestEnv(t, cfg)
	if env != nil {
		t.Cleanup(env.Shutdown)
	}
	if err != nil {
		return err
	}
	f(t, env)
	if cfg.AssertCacheMetrics != nil {
		assertCacheMetrics(t, env, cfg.AssertCacheMetrics.BaseGraphAssertions, "")
	}

	return nil
}

func Bench(b *testing.B, cfg *Config, f func(b *testing.B, xEnv *Environment)) {
	b.Helper()
	b.StopTimer()
	env, err := CreateTestEnv(b, cfg)
	if env != nil {
		b.Cleanup(env.Shutdown)
	}
	if err != nil {
		b.Fatalf("could not create environment: %s", err)
	}
	b.StartTimer()
	f(b, env)
	if cfg.AssertCacheMetrics != nil {
		assertCacheMetrics(b, env, cfg.AssertCacheMetrics.BaseGraphAssertions, "")

		for ff, v := range cfg.AssertCacheMetrics.FeatureFlagAssertions {
			assertCacheMetrics(b, env, v, ff)
		}
	}
}

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

func RandString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}
	return string(b)
}

func assertCacheMetrics(t testing.TB, env *Environment, expected CacheMetricsAssertion, featureFlag string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond*100)
	defer cancel()
	rm := metricdata.ResourceMetrics{}
	err := env.metricReader.Collect(ctx, &rm)
	require.NoError(t, err)
	actual := CacheMetricsAssertion{}
	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "cosmo.router.cache" {
			continue
		}
		for _, m := range sm.Metrics {
			if m.Name != "router.graphql.cache.requests.stats" {
				continue
			}
			if data, ok := m.Data.(metricdata.Sum[int64]); ok {
				for _, dp := range data.DataPoints {
					ct, ok := dp.Attributes.Value("cache_type")
					if !ok {
						continue
					}
					tp, ok := dp.Attributes.Value("type")
					if !ok {
						continue
					}

					ff, isFF := dp.Attributes.Value("wg.feature_flag")
					if isFF && featureFlag == "" || ff.AsString() != featureFlag {
						continue
					}

					cacheType := ct.AsString()
					hm := tp.AsString()
					switch {
					case cacheType == "persisted_query_normalization" && hm == "hits":
						actual.PersistedQueryNormalizationHits = dp.Value
					case cacheType == "persisted_query_normalization" && hm == "misses":
						actual.PersistedQueryNormalizationMisses = dp.Value
					case cacheType == "query_normalization" && hm == "hits":
						actual.QueryNormalizationHits = dp.Value
					case cacheType == "query_normalization" && hm == "misses":
						actual.QueryNormalizationMisses = dp.Value
					case cacheType == "validation" && hm == "hits":
						actual.ValidationHits = dp.Value
					case cacheType == "validation" && hm == "misses":
						actual.ValidationMisses = dp.Value
					case cacheType == "plan" && hm == "hits":
						actual.PlanHits = dp.Value
					case cacheType == "plan" && hm == "misses":
						actual.PlanMisses = dp.Value
					case cacheType == "query_hash" && hm == "misses":
						actual.QueryHashMisses = dp.Value
					case cacheType == "query_hash" && hm == "hits":
						actual.QueryHashHits = dp.Value
					}
				}
			}
		}
	}
	require.Equal(t, expected, actual)
}

type RouterConfig struct {
	StaticConfig        *nodev1.RouterConfig
	ConfigPollerFactory func(config *nodev1.RouterConfig) configpoller.ConfigPoller
}

type MetricExclusions struct {
	ExcludedPrometheusMetrics      []*regexp.Regexp
	ExcludedPrometheusMetricLabels []*regexp.Regexp
	ExcludedOTLPMetrics            []*regexp.Regexp
	ExcludedOTLPMetricLabels       []*regexp.Regexp
	ExcludeScopeInfo               bool
}

type EngineStatOptions struct {
	EnableSubscription bool
}

type MetricOptions struct {
	MetricExclusions                      MetricExclusions
	EnableRuntimeMetrics                  bool
	EnableOTLPRouterCache                 bool
	EnablePrometheusRouterCache           bool
	OTLPEngineStatsOptions                EngineStatOptions
	PrometheusEngineStatsOptions          EngineStatOptions
	PrometheusSchemaFieldUsage            PrometheusSchemaFieldUsage
	EnableOTLPConnectionMetrics           bool
	EnableOTLPCircuitBreakerMetrics       bool
	EnableOTLPStreamMetrics               bool
	EnablePrometheusConnectionMetrics     bool
	EnablePrometheusCircuitBreakerMetrics bool
	EnablePrometheusStreamMetrics         bool
}

type PrometheusSchemaFieldUsage struct {
	Enabled             bool
	IncludeOperationSha bool
}

type Config struct {
	Subgraphs                          SubgraphsConfig
	RouterConfig                       *RouterConfig
	RouterOptions                      []core.Option
	OverrideGraphQLPath                string
	OverrideAbsinthePath               string
	RouterConfigJSONTemplate           string
	ModifyRouterConfig                 func(routerConfig *nodev1.RouterConfig)
	ModifyEngineExecutionConfiguration func(engineExecutionConfiguration *config.EngineExecutionConfiguration)
	ModifySecurityConfiguration        func(securityConfiguration *config.SecurityConfiguration)
	ModifySubgraphErrorPropagation     func(subgraphErrorPropagation *config.SubgraphErrorPropagationConfiguration)
	ModifyWebsocketConfiguration       func(websocketConfiguration *config.WebSocketConfiguration)
	ModifyCDNConfig                    func(cdnConfig *config.CDNConfiguration)
	DemoMode                           bool
	KafkaSeeds                         []string
	DisableWebSockets                  bool
	DisableParentBasedSampler          bool
	TLSConfig                          *core.TlsConfig
	TraceExporter                      trace.SpanExporter
	CustomMetricAttributes             []config.CustomAttribute
	CustomTelemetryAttributes          []config.CustomAttribute
	CustomTracingAttributes            []config.CustomAttribute
	CustomResourceAttributes           []config.CustomStaticAttribute
	MetricReader                       metric.Reader
	PrometheusRegistry                 *prometheus.Registry
	PrometheusPort                     int
	ShutdownDelay                      time.Duration
	NoRetryClient                      bool
	PropagationConfig                  config.PropagationConfig
	CacheControlPolicy                 config.CacheControlPolicy
	ApqConfig                          config.AutomaticPersistedQueriesConfig
	LogObservation                     LogObservationConfig
	ClientHeader                       config.ClientHeader
	ResponseTraceHeader                config.ResponseTraceHeader
	Logger                             *zap.Logger
	AccessLogger                       *zap.Logger
	AccessLogFields                    []config.CustomAttribute
	MetricOptions                      MetricOptions
	ModifyEventsConfiguration          func(cfg *config.EventsConfiguration)
	EnableRuntimeMetrics               bool
	EnableNats                         bool
	BatchingConfig                     config.BatchingConfig
	EnableKafka                        bool
	SubgraphAccessLogsEnabled          bool
	SubgraphAccessLogFields            []config.CustomAttribute
	AssertCacheMetrics                 *CacheMetricsAssertions
	DisableSimulateCloudExporter       bool
	CdnSever                           *httptest.Server
	UseVersionedGraph                  bool
	NoShutdownTestServer               bool
	MCP                                config.MCPConfiguration
	EnableRedis                        bool
	EnableRedisCluster                 bool
	Plugins                            PluginConfig
	EnableGRPC                         bool
	IgnoreQueryParamsList              []string
}

type PluginConfig struct {
	Path    string
	Enabled bool
}

type CacheMetricsAssertions struct {
	BaseGraphAssertions   CacheMetricsAssertion
	FeatureFlagAssertions map[string]CacheMetricsAssertion
}

type CacheMetricsAssertion struct {
	QueryNormalizationMisses          int64
	QueryNormalizationHits            int64
	PersistedQueryNormalizationMisses int64
	PersistedQueryNormalizationHits   int64
	ValidationMisses                  int64
	ValidationHits                    int64
	PlanMisses                        int64
	PlanHits                          int64
	QueryHashMisses                   int64
	QueryHashHits                     int64
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
	Projects         SubgraphConfig
}

type SubgraphConfig struct {
	Middleware   func(http.Handler) http.Handler
	Delay        time.Duration
	CloseOnStart bool
}

type LogObservationConfig struct {
	Enabled  bool
	LogLevel zapcore.Level
}

type MCPConfig struct {
	Enabled bool
	Port    int
}

var redisHost = "redis://localhost:6379"
var redisClusterHost = "redis://localhost:7001"

// CreateTestSupervisorEnv is currently tailored specifically for /lifecycle/supervisor_test.go, refer to that test
// for usage example. CreateTestSupervisorEnv is not a drop-in replacement for CreateTestEnv!
func CreateTestSupervisorEnv(t testing.TB, cfg *Config) (*Environment, error) {
	t.Helper()

	var (
		kafkaAdminClient *kadm.Client
		kafkaClient      *kgo.Client
		natsSetup        *NatsData
		pubSubPrefix     = strconv.FormatUint(rand.Uint64(), 16)
	)

	if cfg.EnableKafka {
		cfg.KafkaSeeds = []string{"localhost:9092"}

		client, err := kgo.NewClient(
			kgo.SeedBrokers(cfg.KafkaSeeds...),
		)
		if err != nil {
			return nil, err
		}

		kafkaClient = client
		kafkaAdminClient = kadm.NewClient(kafkaClient)
	}

	if cfg.EnableNats {
		s, err := setupNatsClients(t)
		if err != nil {
			t.Fatalf("could not setup nats clients: %s", err.Error())
		}
		natsSetup = s
	}

	if cfg.AssertCacheMetrics != nil {
		if cfg.MetricReader == nil {
			cfg.MetricReader = metric.NewManualReader()
		}
		cfg.MetricOptions.EnableOTLPRouterCache = true
	}

	var logObserver *observer.ObservedLogs

	if oc := cfg.LogObservation; oc.Enabled {
		var zCore zapcore.Core
		zCore, logObserver = observer.New(oc.LogLevel)
		cfg.Logger = logging.NewZapLoggerWithCore(zCore, true)
	} else {
		ec := zap.NewProductionEncoderConfig()
		ec.EncodeDuration = zapcore.SecondsDurationEncoder
		ec.TimeKey = "time"

		syncer := zapcore.AddSync(os.Stderr)
		cfg.Logger = logging.NewZapLogger(syncer, false, true, zapcore.ErrorLevel)
	}

	if cfg.AccessLogger == nil {
		cfg.AccessLogger = cfg.Logger
	}

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

	requiredPorts := 2

	ports := freeport.GetN(t, requiredPorts)

	getPubSubName := GetPubSubNameFn(pubSubPrefix)

	ctx, cancel := context.WithCancelCause(context.Background())

	employees := &Subgraph{
		handler:          subgraphs.EmployeesHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Employees.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Employees,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Employees.Delay,
	}

	family := &Subgraph{
		handler:          subgraphs.FamilyHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Family.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Family,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Family.Delay,
	}

	hobbies := &Subgraph{
		handler:          subgraphs.HobbiesHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Hobbies.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Hobbies,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Hobbies.Delay,
	}

	products := &Subgraph{
		handler:          subgraphs.ProductsHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Products.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Products,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Products.Delay,
	}

	productsFg := &Subgraph{
		handler:          subgraphs.ProductsFGHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.ProductsFg.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.ProductFg,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.ProductsFg.Delay,
	}

	test1 := &Subgraph{
		handler:          subgraphs.Test1Handler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Test1.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Test1,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Test1.Delay,
	}

	availability := &Subgraph{
		handler:          subgraphs.AvailabilityHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Availability.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Availability,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Availability.Delay,
	}

	mood := &Subgraph{
		handler:          subgraphs.MoodHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Mood.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Mood,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Mood.Delay,
	}

	countries := &Subgraph{
		handler:          subgraphs.CountriesHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Countries.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Countries,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Countries.Delay,
	}

	employeesServer := makeSafeHttpTestServer(t, employees)
	familyServer := makeSafeHttpTestServer(t, family)
	hobbiesServer := makeSafeHttpTestServer(t, hobbies)
	productsServer := makeSafeHttpTestServer(t, products)
	test1Server := makeSafeHttpTestServer(t, test1)
	availabilityServer := makeSafeHttpTestServer(t, availability)
	moodServer := makeSafeHttpTestServer(t, mood)
	countriesServer := makeSafeHttpTestServer(t, countries)
	productFgServer := makeSafeHttpTestServer(t, productsFg)

	var (
		projectServer *grpc.Server
		endpoint      string
	)

	if cfg.EnableGRPC {
		projectServer, endpoint = makeSafeGRPCServer(t, &projects.ProjectsService_ServiceDesc, &service.ProjectsService{})
	}

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
		subgraphs.ProjectsDefaultDemoURL:     grpcURL(endpoint),
	}

	if cfg.RouterConfigJSONTemplate == "" {
		cfg.RouterConfigJSONTemplate = ConfigJSONTemplate
	}
	replaced := cfg.RouterConfigJSONTemplate

	for k, v := range replacements {
		replaced = strings.ReplaceAll(replaced, k, v)
	}

	var routerConfig nodev1.RouterConfig
	if err := protojson.Unmarshal([]byte(replaced), &routerConfig); err != nil {
		cancel(err)
		return nil, err
	}

	addPubSubPrefixToEngineConfiguration(routerConfig.EngineConfig, getPubSubName)
	for _, ffConfig := range routerConfig.FeatureFlagConfigs.GetConfigByFeatureFlagName() {
		addPubSubPrefixToEngineConfiguration(ffConfig.EngineConfig, getPubSubName)
	}

	if cfg.ModifyRouterConfig != nil {
		cfg.ModifyRouterConfig(&routerConfig)
	}

	cdnServer := cfg.CdnSever
	if cfg.CdnSever == nil {
		cdnServer = SetupCDNServer(t, freeport.GetOne(t))
	}

	if cfg.PrometheusRegistry != nil {
		cfg.PrometheusPort = ports[0]
	}

	listenerAddr := fmt.Sprintf("localhost:%d", ports[1])

	client := &http.Client{}

	if !cfg.NoRetryClient {
		retryClient := retryablehttp.NewClient()
		retryClient.Logger = nil
		retryClient.RetryMax = 10
		retryClient.RetryWaitMin = 100 * time.Millisecond

		client = retryClient.StandardClient()
	}

	if cfg.MCP.Enabled {
		cfg.MCP.Server.ListenAddr = fmt.Sprintf("localhost:%d", freeport.GetOne(t))
	}

	baseURL := fmt.Sprintf("http://%s", listenerAddr)

	rs, err := core.NewRouterSupervisor(&core.RouterSupervisorOpts{
		BaseLogger: cfg.Logger,
		ConfigFactory: func() (*config.Config, error) {
			return &config.Config{}, nil
		},
		RouterFactory: func(ctx context.Context, res *core.RouterResources) (*core.Router, error) {
			rr, err := configureRouter(listenerAddr, cfg, &routerConfig, cdnServer, natsSetup)
			if err != nil {
				cancel(err)
				return nil, err
			}

			return rr, nil
		},
	})

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

		if cfg.NoRetryClient {
			client = httpClient
		} else {
			retryClient := retryablehttp.NewClient()
			retryClient.Logger = nil
			retryClient.RetryMax = 10
			retryClient.RetryWaitMin = 100 * time.Millisecond
			retryClient.HTTPClient = httpClient

			client = retryClient.StandardClient()
		}
	}

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
	if cfg.EnableGRPC && cfg.Subgraphs.Projects.CloseOnStart {
		projectServer.Stop()
	}

	if cfg.ShutdownDelay == 0 {
		cfg.ShutdownDelay = 30 * time.Second
	}

	e := &Environment{
		t:                       t,
		cfg:                     cfg,
		routerConfigVersionMain: routerConfig.Version,
		graphQLPath:             graphQLPath,
		absinthePath:            absinthePath,
		Context:                 ctx,
		cancel:                  cancel,
		Router:                  nil,
		RouterURL:               baseURL,
		RouterSupervisor:        rs,
		RouterClient:            client,
		CDN:                     cdnServer,
		NatsData:                natsSetup,
		SubgraphRequestCount:    counters,
		KafkaAdminClient:        kafkaAdminClient,
		KafkaClient:             kafkaClient,
		shutdownDelay:           cfg.ShutdownDelay,
		shutdown:                atomic.NewBool(false),
		logObserver:             logObserver,
		getPubSubName:           getPubSubName,
		metricReader:            cfg.MetricReader,
		Servers: []*httptest.Server{
			employeesServer,
			familyServer,
			hobbiesServer,
			productsServer,
			test1Server,
			availabilityServer,
			moodServer,
			countriesServer,
			productFgServer,
		},
		GRPCServers: []*grpc.Server{
			projectServer,
		},
	}

	if natsSetup != nil {
		e.NatsConnectionDefault = natsSetup.Connections[0]
		e.NatsConnectionMyNats = natsSetup.Connections[1]
	}

	if cfg.EnableRedis {
		e.RedisHosts = []string{redisHost}
	}

	if cfg.EnableRedisCluster {
		e.RedisHosts = []string{redisClusterHost}
		e.RedisWithClusterMode = true
	}

	if routerConfig.FeatureFlagConfigs != nil {
		myFF, ok := routerConfig.FeatureFlagConfigs.ConfigByFeatureFlagName["myff"]
		if ok {
			e.routerConfigVersionMyFF = myFF.Version
		}
	}

	if cfg.MCP.Enabled {
		// Create MCP client connecting to the MCP server
		mcpAddr := fmt.Sprintf("http://%s/mcp", cfg.MCP.Server.ListenAddr)
		client, err := mcpclient.NewStreamableHttpClient(mcpAddr)
		if err != nil {
			t.Fatalf("Failed to create MCP client: %v", err)
		}

		e.MCPClient = client

		err = e.WaitForMCPServer(e.Context, 250, 10)
		if err != nil {
			return nil, err
		}
	}

	return e, err
}

func CreateTestEnv(t testing.TB, cfg *Config) (*Environment, error) {
	t.Helper()

	var (
		kafkaAdminClient *kadm.Client
		kafkaClient      *kgo.Client
		natsSetup        *NatsData
		pubSubPrefix     = strconv.FormatUint(rand.Uint64(), 16)
	)

	if cfg.EnableKafka {
		cfg.KafkaSeeds = []string{"localhost:9092"}
		client, err := kgo.NewClient(
			kgo.SeedBrokers(cfg.KafkaSeeds...),
			kgo.FetchMaxWait(time.Millisecond*100),
		)
		if err != nil {
			return nil, err
		}

		kafkaClient = client
		kafkaAdminClient = kadm.NewClient(kafkaClient)
	}

	if cfg.EnableNats {
		s, err := setupNatsClients(t)
		if err != nil {
			t.Fatalf("could not setup nats clients: %s", err.Error())
		}
		natsSetup = s
	}

	if cfg.AssertCacheMetrics != nil {
		if cfg.MetricReader == nil {
			cfg.MetricReader = metric.NewManualReader()
		}
		cfg.MetricOptions.EnableOTLPRouterCache = true
	}

	var logObserver *observer.ObservedLogs

	if oc := cfg.LogObservation; oc.Enabled {
		var zCore zapcore.Core
		zCore, logObserver = observer.New(oc.LogLevel)
		cfg.Logger = logging.NewZapLoggerWithCore(zCore, true)
	} else {
		ec := zap.NewProductionEncoderConfig()
		ec.EncodeDuration = zapcore.SecondsDurationEncoder
		ec.TimeKey = "time"

		syncer := zapcore.AddSync(os.Stderr)
		cfg.Logger = logging.NewZapLogger(syncer, false, true, zapcore.ErrorLevel)
	}

	if cfg.AccessLogger == nil {
		cfg.AccessLogger = cfg.Logger
	}

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

	requiredPorts := 2

	ports := freeport.GetN(t, requiredPorts)

	getPubSubName := GetPubSubNameFn(pubSubPrefix)

	ctx, cancel := context.WithCancelCause(context.Background())

	employees := &Subgraph{
		handler:          subgraphs.EmployeesHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Employees.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Employees,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Employees.Delay,
	}

	family := &Subgraph{
		handler:          subgraphs.FamilyHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Family.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Family,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Family.Delay,
	}

	hobbies := &Subgraph{
		handler:          subgraphs.HobbiesHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Hobbies.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Hobbies,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Hobbies.Delay,
	}

	products := &Subgraph{
		handler:          subgraphs.ProductsHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Products.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Products,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Products.Delay,
	}

	productsFg := &Subgraph{
		handler:          subgraphs.ProductsFGHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.ProductsFg.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.ProductFg,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.ProductsFg.Delay,
	}

	test1 := &Subgraph{
		handler:          subgraphs.Test1Handler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Test1.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Test1,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Test1.Delay,
	}

	availability := &Subgraph{
		handler:          subgraphs.AvailabilityHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Availability.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Availability,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Availability.Delay,
	}

	mood := &Subgraph{
		handler:          subgraphs.MoodHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Mood.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Mood,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Mood.Delay,
	}

	countries := &Subgraph{
		handler:          subgraphs.CountriesHandler(subgraphOptions(ctx, t, cfg.Logger, natsSetup, getPubSubName)),
		middleware:       cfg.Subgraphs.Countries.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Countries,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Countries.Delay,
	}

	employeesServer := makeSafeHttpTestServer(t, employees)
	familyServer := makeSafeHttpTestServer(t, family)
	hobbiesServer := makeSafeHttpTestServer(t, hobbies)
	productsServer := makeSafeHttpTestServer(t, products)
	test1Server := makeSafeHttpTestServer(t, test1)
	availabilityServer := makeSafeHttpTestServer(t, availability)
	moodServer := makeSafeHttpTestServer(t, mood)
	countriesServer := makeSafeHttpTestServer(t, countries)
	productFgServer := makeSafeHttpTestServer(t, productsFg)

	var (
		projectServer *grpc.Server
		endpoint      string
	)

	if cfg.EnableGRPC {
		projectServer, endpoint = makeSafeGRPCServer(t, &projects.ProjectsService_ServiceDesc, &service.ProjectsService{})
	}

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
		subgraphs.ProjectsDefaultDemoURL:     grpcURL(endpoint),
	}

	if cfg.RouterConfigJSONTemplate == "" {
		cfg.RouterConfigJSONTemplate = ConfigJSONTemplate
	}
	replaced := cfg.RouterConfigJSONTemplate

	for k, v := range replacements {
		replaced = strings.ReplaceAll(replaced, k, v)
	}

	var routerConfig nodev1.RouterConfig
	if err := protojson.Unmarshal([]byte(replaced), &routerConfig); err != nil {
		cancel(err)
		return nil, err
	}

	addPubSubPrefixToEngineConfiguration(routerConfig.EngineConfig, getPubSubName)
	for _, ffConfig := range routerConfig.FeatureFlagConfigs.GetConfigByFeatureFlagName() {
		addPubSubPrefixToEngineConfiguration(ffConfig.EngineConfig, getPubSubName)
	}

	if cfg.ModifyRouterConfig != nil {
		cfg.ModifyRouterConfig(&routerConfig)
	}

	cdnServer := cfg.CdnSever
	if cfg.CdnSever == nil {
		cdnServer = SetupCDNServer(t, freeport.GetOne(t))
	}

	if cfg.PrometheusRegistry != nil {
		cfg.PrometheusPort = ports[0]
	}

	listenerAddr := fmt.Sprintf("localhost:%d", ports[1])

	client := &http.Client{}

	if !cfg.NoRetryClient {
		retryClient := retryablehttp.NewClient()
		retryClient.Logger = nil
		retryClient.RetryMax = 10
		retryClient.RetryWaitMin = 100 * time.Millisecond

		client = retryClient.StandardClient()
	}

	if cfg.MCP.Enabled {
		cfg.MCP.Server.ListenAddr = fmt.Sprintf("localhost:%d", freeport.GetOne(t))
	}

	rr, err := configureRouter(listenerAddr, cfg, &routerConfig, cdnServer, natsSetup)
	if err != nil {
		cancel(err)
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

		if cfg.NoRetryClient {
			client = httpClient
		} else {
			retryClient := retryablehttp.NewClient()
			retryClient.Logger = nil
			retryClient.RetryMax = 10
			retryClient.RetryWaitMin = 100 * time.Millisecond
			retryClient.HTTPClient = httpClient

			client = retryClient.StandardClient()
		}
	}

	if err := rr.Start(ctx); err != nil {
		cancel(err)
		return nil, err
	}

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

	if cfg.EnableGRPC && cfg.Subgraphs.Projects.CloseOnStart {
		projectServer.Stop()
	}

	if cfg.ShutdownDelay == 0 {
		cfg.ShutdownDelay = 30 * time.Second
	}

	e := &Environment{
		t:                       t,
		cfg:                     cfg,
		routerConfigVersionMain: routerConfig.Version,
		graphQLPath:             graphQLPath,
		absinthePath:            absinthePath,
		Context:                 ctx,
		cancel:                  cancel,
		Router:                  rr,
		RouterURL:               rr.BaseURL(),
		RouterClient:            client,
		CDN:                     cdnServer,
		NatsData:                natsSetup,
		SubgraphRequestCount:    counters,
		KafkaAdminClient:        kafkaAdminClient,
		KafkaClient:             kafkaClient,
		shutdownDelay:           cfg.ShutdownDelay,
		shutdown:                atomic.NewBool(false),
		logObserver:             logObserver,
		getPubSubName:           getPubSubName,
		metricReader:            cfg.MetricReader,
		Servers: []*httptest.Server{
			employeesServer,
			familyServer,
			hobbiesServer,
			productsServer,
			test1Server,
			availabilityServer,
			moodServer,
			countriesServer,
			productFgServer,
		},
		GRPCServers: []*grpc.Server{
			projectServer,
		},
	}

	if natsSetup != nil {
		e.NatsConnectionDefault = natsSetup.Connections[0]
		e.NatsConnectionMyNats = natsSetup.Connections[1]
	}

	if cfg.EnableRedis {
		e.RedisHosts = []string{redisHost}
	}

	if cfg.EnableRedisCluster {
		e.RedisHosts = []string{redisClusterHost}
		e.RedisWithClusterMode = true
	}

	if routerConfig.FeatureFlagConfigs != nil {
		myFF, ok := routerConfig.FeatureFlagConfigs.ConfigByFeatureFlagName["myff"]
		if ok {
			e.routerConfigVersionMyFF = myFF.Version
		}
	}

	err = e.WaitForServer(ctx, e.RouterURL+"/health/ready", 250, 30)
	if err != nil {
		return nil, err
	}

	if cfg.MCP.Enabled {
		// Create MCP client connecting to the MCP server
		mcpAddr := fmt.Sprintf("http://%s/mcp", cfg.MCP.Server.ListenAddr)
		client, err := mcpclient.NewStreamableHttpClient(mcpAddr)
		if err != nil {
			t.Fatalf("Failed to create MCP client: %v", err)
		}

		e.MCPClient = client

		err = e.WaitForMCPServer(e.Context, 250, 10)
		if err != nil {
			return nil, err
		}
	}

	return e, err
}

func generateJwtToken() (string, error) {
	jwtToken := jwt.New(jwt.SigningMethodHS256)
	jwtToken.Claims = testTokenClaims()
	return jwtToken.SignedString([]byte("hunter2"))
}

func GenerateVersionedJwtToken() (string, error) {
	jwtToken := jwt.New(jwt.SigningMethodHS256)
	jwtToken.Claims = testVersionedTokenClaims()
	return jwtToken.SignedString([]byte("hunter2"))
}

func configureRouter(listenerAddr string, testConfig *Config, routerConfig *nodev1.RouterConfig, cdn *httptest.Server, natsData *NatsData) (*core.Router, error) {
	cfg := config.Config{
		Graph: config.Graph{},
		CDN: config.CDNConfiguration{
			URL:       cdn.URL,
			CacheSize: 1024 * 1024,
		},
		SubgraphErrorPropagation: config.SubgraphErrorPropagationConfiguration{
			Enabled:                true,
			PropagateStatusCodes:   true,
			Mode:                   config.SubgraphErrorPropagationModeWrapped,
			OmitExtensions:         false,
			OmitLocations:          true,
			RewritePaths:           true,
			AllowedExtensionFields: []string{"code"},
		},
		CacheControl:              testConfig.CacheControlPolicy,
		AutomaticPersistedQueries: testConfig.ApqConfig,
	}

	if testConfig.ModifyCDNConfig != nil {
		testConfig.ModifyCDNConfig(&cfg.CDN)
	}

	if testConfig.DemoMode {
		cfg.DemoMode = true
	}

	graphApiToken, err := generateJwtToken()
	if testConfig.UseVersionedGraph {
		graphApiToken, err = GenerateVersionedJwtToken()
	}
	if err != nil {
		return nil, err
	}

	engineExecutionConfig := config.EngineExecutionConfiguration{
		EnableNetPoll:                          true,
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
		WebSocketClientPollTimeout:    300 * time.Millisecond,
		WebSocketClientConnBufferSize: 1,
		WebSocketClientReadTimeout:    1 * time.Second,
		WebSocketClientWriteTimeout:   2 * time.Second,
		// Avoid get in conflict with any test that doesn't expect to handle pings
		WebSocketClientPingInterval:    30 * time.Second,
		MaxConcurrentResolvers:         32,
		ExecutionPlanCacheSize:         1024,
		EnablePersistedOperationsCache: true,
		OperationHashCacheSize:         2048,
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

	var natsEventSources []config.NatsEventSource
	var kafkaEventSources []config.KafkaEventSource
	var redisEventSources []config.RedisEventSource

	if natsData != nil {
		for _, sourceName := range DemoNatsProviders {
			natsEventSources = append(natsEventSources, config.NatsEventSource{
				ID:  sourceName,
				URL: nats.DefaultURL,
			})
		}
	}

	if testConfig.KafkaSeeds != nil {
		for _, sourceName := range DemoKafkaProviders {
			kafkaEventSources = append(kafkaEventSources, config.KafkaEventSource{
				ID:           sourceName,
				Brokers:      testConfig.KafkaSeeds,
				FetchMaxWait: 100 * time.Millisecond,
			})
		}
	}

	if testConfig.EnableRedis {
		for _, sourceName := range DemoRedisProviders {
			redisEventSources = append(redisEventSources, config.RedisEventSource{
				ID:   sourceName,
				URLs: []string{redisHost},
			})
		}
	}

	if testConfig.EnableRedisCluster {
		for _, sourceName := range DemoRedisProviders {
			redisEventSources = append(redisEventSources, config.RedisEventSource{
				ID:   sourceName,
				URLs: []string{redisClusterHost},
			})
		}
	}

	eventsConfiguration := config.EventsConfiguration{
		Providers: config.EventProviders{
			Nats:  natsEventSources,
			Kafka: kafkaEventSources,
			Redis: redisEventSources,
		},
	}
	if testConfig.ModifyEventsConfiguration != nil {
		testConfig.ModifyEventsConfiguration(&eventsConfiguration)
	}

	routerOpts := []core.Option{
		core.WithDisableUsageTracking(),
		core.WithLogger(testConfig.Logger),
		core.WithAccessLogs(&core.AccessLogsConfig{
			Logger:                testConfig.AccessLogger,
			Attributes:            testConfig.AccessLogFields,
			IgnoreQueryParamsList: testConfig.IgnoreQueryParamsList,
			SubgraphEnabled:       testConfig.SubgraphAccessLogsEnabled,
			SubgraphAttributes:    testConfig.SubgraphAccessLogFields,
		}),
		core.WithGraphApiToken(graphApiToken),
		core.WithDevelopmentMode(true),
		core.WithPlayground(true),
		core.WithPlaygroundConfig(config.PlaygroundConfig{Enabled: true}),
		core.WithEngineExecutionConfig(engineExecutionConfig),
		core.WithSecurityConfig(cfg.SecurityConfiguration),
		core.WithCacheControlPolicy(cfg.CacheControl),
		core.WithAutomatedPersistedQueriesConfig(cfg.AutomaticPersistedQueries),
		core.WithCDN(cfg.CDN),
		core.WithListenerAddr(listenerAddr),
		core.WithBatching(&core.BatchingConfig{
			Enabled:               testConfig.BatchingConfig.Enabled,
			MaxConcurrentRoutines: testConfig.BatchingConfig.MaxConcurrency,
			MaxEntriesPerBatch:    testConfig.BatchingConfig.MaxEntriesPerBatch,
			OmitExtensions:        testConfig.BatchingConfig.OmitExtensions,
		}),
		core.WithSubgraphErrorPropagation(cfg.SubgraphErrorPropagation),
		core.WithTLSConfig(testConfig.TLSConfig),
		core.WithInstanceID("test-instance"),
		core.WithGracePeriod(15 * time.Second),
		core.WithIntrospection(true),
		core.WithQueryPlans(true),
		core.WithEvents(eventsConfiguration),
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

	if testConfig.MCP.Enabled {
		// Add Storage provider
		routerOpts = append(routerOpts, core.WithStorageProviders(config.StorageProviders{
			FileSystem: []config.FileSystemStorageProvider{
				{
					ID:   "test",
					Path: "testdata/mcp_operations",
				},
			},
		}))

		testConfig.MCP.Storage.ProviderID = "test"

		routerOpts = append(routerOpts, core.WithMCP(testConfig.MCP))
	}

	routerOpts = append(routerOpts, core.WithPlugins(config.PluginsConfiguration{
		Path:    testConfig.Plugins.Path,
		Enabled: testConfig.Plugins.Enabled,
	}))

	if testConfig.TraceExporter != nil {
		testConfig.PropagationConfig.TraceContext = true

		c := core.TraceConfigFromTelemetry(&config.Telemetry{
			ServiceName:        "cosmo-router",
			ResourceAttributes: testConfig.CustomResourceAttributes,
			Tracing: config.Tracing{
				Enabled:               true,
				SamplingRate:          1,
				ParentBasedSampler:    !testConfig.DisableParentBasedSampler,
				Exporters:             []config.TracingExporter{},
				Propagation:           testConfig.PropagationConfig,
				TracingGlobalFeatures: config.TracingGlobalFeatures{},
				ResponseTraceHeader:   testConfig.ResponseTraceHeader,
			},
		})

		c.TestMemoryExporter = testConfig.TraceExporter

		routerOpts = append(routerOpts,
			core.WithTracing(c),
		)
	}

	if testConfig.CustomTelemetryAttributes != nil {
		routerOpts = append(routerOpts, core.WithTelemetryAttributes(testConfig.CustomTelemetryAttributes))
	}

	if testConfig.CustomTracingAttributes != nil {
		routerOpts = append(routerOpts, core.WithTracingAttributes(testConfig.CustomTracingAttributes))
	}

	var prometheusConfig rmetric.PrometheusConfig

	if testConfig.PrometheusRegistry != nil {
		prometheusConfig = rmetric.PrometheusConfig{
			Enabled:         true,
			ListenAddr:      fmt.Sprintf("localhost:%d", testConfig.PrometheusPort),
			Path:            "/metrics",
			TestRegistry:    testConfig.PrometheusRegistry,
			GraphqlCache:    testConfig.MetricOptions.EnablePrometheusRouterCache,
			ConnectionStats: testConfig.MetricOptions.EnablePrometheusConnectionMetrics,
			EngineStats: rmetric.EngineStatsConfig{
				Subscription: testConfig.MetricOptions.PrometheusEngineStatsOptions.EnableSubscription,
			},
			CircuitBreaker:      testConfig.MetricOptions.EnablePrometheusCircuitBreakerMetrics,
			ExcludeMetrics:      testConfig.MetricOptions.MetricExclusions.ExcludedPrometheusMetrics,
			ExcludeMetricLabels: testConfig.MetricOptions.MetricExclusions.ExcludedPrometheusMetricLabels,
			Streams:             testConfig.MetricOptions.EnablePrometheusStreamMetrics,
			ExcludeScopeInfo:    testConfig.MetricOptions.MetricExclusions.ExcludeScopeInfo,
			PromSchemaFieldUsage: rmetric.PrometheusSchemaFieldUsage{
				Enabled:             testConfig.MetricOptions.PrometheusSchemaFieldUsage.Enabled,
				IncludeOperationSha: testConfig.MetricOptions.PrometheusSchemaFieldUsage.IncludeOperationSha,
			},
		}
	}

	if testConfig.MetricReader != nil {
		c := core.MetricConfigFromTelemetry(&config.Telemetry{
			ServiceName:        "cosmo-router",
			ResourceAttributes: testConfig.CustomResourceAttributes,
			Tracing:            config.Tracing{},
			Metrics: config.Metrics{
				Attributes: testConfig.CustomMetricAttributes,
				Prometheus: config.Prometheus{
					Enabled: true,
				},
				OTLP: config.MetricsOTLP{
					Enabled:         true,
					RouterRuntime:   testConfig.MetricOptions.EnableRuntimeMetrics,
					GraphqlCache:    testConfig.MetricOptions.EnableOTLPRouterCache,
					Streams:         testConfig.MetricOptions.EnableOTLPStreamMetrics,
					ConnectionStats: testConfig.MetricOptions.EnableOTLPConnectionMetrics,
					EngineStats: config.EngineStats{
						Subscriptions: testConfig.MetricOptions.OTLPEngineStatsOptions.EnableSubscription,
					},
					CircuitBreaker:      testConfig.MetricOptions.EnableOTLPCircuitBreakerMetrics,
					ExcludeMetrics:      testConfig.MetricOptions.MetricExclusions.ExcludedOTLPMetrics,
					ExcludeMetricLabels: testConfig.MetricOptions.MetricExclusions.ExcludedOTLPMetricLabels,
				},
			},
		})

		c.Prometheus = prometheusConfig
		c.OpenTelemetry.TestReader = testConfig.MetricReader
		c.IsUsingCloudExporter = !testConfig.DisableSimulateCloudExporter

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
			Authentication: config.WebSocketAuthenticationConfiguration{
				FromInitialPayload: config.InitialPayloadAuthenticationConfiguration{
					Enabled: false,
					Key:     "Authorization",
				},
			},
			ClientInfoFromInitialPayload: config.WebSocketClientInfoFromInitialPayloadConfiguration{
				Enabled:      true,
				NameField:    "graphql-client-name",
				VersionField: "graphql-client-version",
				ForwardToRequestHeaders: config.ForwardToRequestHeadersConfiguration{
					Enabled:             true,
					NameTargetHeader:    "graphql-client-name",
					VersionTargetHeader: "graphql-client-version",
				},
			},
		}
		if testConfig.ModifyWebsocketConfiguration != nil {
			testConfig.ModifyWebsocketConfiguration(wsConfig)
		}
		routerOpts = append(routerOpts, core.WithWebSocketConfiguration(wsConfig))
		routerOpts = append(routerOpts, core.WithClientHeader(testConfig.ClientHeader))
	}
	return core.NewRouter(routerOpts...)
}

func testTokenClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"federated_graph_id": "graph",
		"organization_id":    "organization",
	}
}

func testVersionedTokenClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"federated_graph_id": "versioned-graph",
		"organization_id":    "organization",
	}
}

func makeHttpTestServerWithPort(t testing.TB, handler http.Handler, port int) *httptest.Server {
	s := httptest.NewUnstartedServer(handler)
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("could not listen on port: %s", err.Error())
	}
	_ = s.Listener.Close()
	s.Listener = l
	s.Start()

	return s
}

func makeSafeHttpTestServer(t testing.TB, handler http.Handler) *httptest.Server {
	s := httptest.NewUnstartedServer(handler)
	port := freeport.GetOne(t)
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("could not listen on port: %s", err.Error())
	}
	_ = s.Listener.Close()
	s.Listener = l
	s.Start()

	return s
}

func makeSafeGRPCServer(t testing.TB, sd *grpc.ServiceDesc, service any) (*grpc.Server, string) {
	t.Helper()

	port := freeport.GetOne(t)

	endpoint := fmt.Sprintf("localhost:%d", port)

	lis, err := net.Listen("tcp", endpoint)
	require.NoError(t, err)

	require.NotNil(t, service)

	s := grpc.NewServer()
	s.RegisterService(sd, service)

	go func() {
		err := s.Serve(lis)
		require.NoError(t, err)
	}()

	return s, endpoint
}

func SetupCDNServer(t testing.TB, port int) *httptest.Server {
	_, filePath, _, ok := runtime.Caller(0)
	require.True(t, ok)
	baseCdnFile := filepath.Join(path.Dir(filePath), "testdata", "cdn")
	cdnFileServer := http.FileServer(http.Dir(baseCdnFile))
	var cdnRequestLog []string
	cdnServer := makeHttpTestServerWithPort(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			requestLog, err := json.Marshal(cdnRequestLog)
			require.NoError(t, err)
			w.Header().Set("Content-Type", "application/json")
			_, err = w.Write(requestLog)
			require.NoError(t, err)
			return
		}
		cdnRequestLog = append(cdnRequestLog, r.Method+" "+r.URL.Path)
		// Ensure we have an authorization header with a valid token
		authorization := r.Header.Get("Authorization")
		if authorization == "" {
			require.NotEmpty(t, authorization, "missing authorization header")
		}
		token := authorization[len("Bearer "):]
		parsedClaims := make(jwt.MapClaims)
		jwtParser := new(jwt.Parser)
		_, _, err := jwtParser.ParseUnverified(token, parsedClaims)
		require.NoError(t, err)
		cdnFileServer.ServeHTTP(w, r)
	}), port)

	return cdnServer
}

func gqlURL(srv *httptest.Server) string {
	path, err := url.JoinPath(srv.URL, "/graphql")
	if err != nil {
		panic(err)
	}
	return path
}

func grpcURL(endpoint string) string {
	return "dns:///" + endpoint
}

func ReadAndCheckJSON(t testing.TB, conn *websocket.Conn, v interface{}) (err error) {
	_, payload, err := conn.ReadMessage()
	if err != nil {
		return err
	}
	if err := json.Unmarshal(payload, &v); err != nil {
		t.Logf("Failed to decode WebSocket message. Raw payload: %s", string(payload))
		return err
	}
	return nil
}

type Environment struct {
	t                     testing.TB
	cfg                   *Config
	graphQLPath           string
	absinthePath          string
	shutdown              *atomic.Bool
	Context               context.Context
	cancel                context.CancelCauseFunc
	Router                *core.Router
	RouterSupervisor      *core.RouterSupervisor
	RouterURL             string
	RouterClient          *http.Client
	Servers               []*httptest.Server
	GRPCServers           []*grpc.Server
	CDN                   *httptest.Server
	NatsData              *NatsData
	NatsConnectionDefault *nats.Conn
	NatsConnectionMyNats  *nats.Conn
	SubgraphRequestCount  *SubgraphRequestCount
	KafkaAdminClient      *kadm.Client
	KafkaClient           *kgo.Client
	logObserver           *observer.ObservedLogs
	getPubSubName         func(name string) string
	MCPClient             *mcpclient.Client
	RedisHosts            []string
	RedisWithClusterMode  bool

	shutdownDelay       time.Duration
	extraURLQueryValues url.Values

	routerConfigVersionMain string
	routerConfigVersionMyFF string

	metricReader  metric.Reader
	routerCmd     *exec.Cmd
	cmdLogChannel chan string
}

func GetPubSubNameFn(prefix string) func(name string) string {
	return func(name string) string {
		return prefix + name
	}
}

// GetPubSubName returns the name of a PubSub entity (subject, topic, subscription, etc.) unique for this test environment.
// Using this method avoid conflicts between tests running in parallel.
func (e *Environment) GetPubSubName(name string) string {
	return e.getPubSubName(name)
}

func (e *Environment) GetKafkaSeeds() []string {
	return e.cfg.KafkaSeeds
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

func (e *Environment) Observer() *observer.ObservedLogs {
	if e.logObserver == nil {
		e.t.Fatal("Log observation is not enabled. Enable it in the environment config")
	}

	return e.logObserver
}

// GetMCPServerAddr returns the MCP server address for testing
func (e *Environment) GetMCPServerAddr() string {
	if e.cfg.MCP.Enabled {
		return fmt.Sprintf("http://%s/mcp", e.cfg.MCP.Server.ListenAddr)
	}
	return ""
}

// Shutdown closes all resources associated with the test environment. Can be called multiple times but will only
// shut down resources once.
func (e *Environment) Shutdown() {
	if !e.shutdown.CompareAndSwap(false, true) {
		return
	}

	ctx, cancel := context.WithTimeout(e.Context, e.shutdownDelay)
	defer cancel()

	// Gracefully shutdown router
	if e.Router != nil {
		err := e.Router.Shutdown(ctx)
		if err != nil {
			e.t.Errorf("could not shutdown router: %s", err)
		}
	}

	// Terminate test server resources
	e.cancel(ErrEnvironmentClosed)

	// Close all test servers
	if !e.cfg.NoShutdownTestServer {
		for _, s := range e.Servers {
			s.CloseClientConnections()
		}
	}

	for _, s := range e.Servers {
		// Do not call s.Close() here, as it will get stuck on connections left open!
		lErr := s.Listener.Close()
		if lErr != nil {
			e.t.Logf("could not close server listener: %s", lErr)
		}
	}

	for _, s := range e.GRPCServers {
		if s != nil {
			s.Stop()
		}
	}

	// Close the CDN
	e.CDN.CloseClientConnections()
	// Do not call s.Close() here, as it will get stuck on connections left open!
	lErr := e.CDN.Listener.Close()
	if lErr != nil {
		e.t.Logf("could not close CDN listener: %s", lErr)
	}

	// Flush NATS connections
	if e.cfg.EnableNats {
		if e.NatsConnectionMyNats != nil {
			err := e.NatsConnectionMyNats.Flush()
			if err != nil {
				e.t.Logf("could not flush MyNats NATS connection: %s", err)
			}
		}
		if e.NatsConnectionDefault != nil {
			err := e.NatsConnectionDefault.Flush()
			if err != nil {
				e.t.Logf("could not flush Default NATS connection: %s", err)
			}
		}
	}

	// Flush Kafka connection
	if e.cfg.EnableKafka && e.KafkaClient != nil {
		err := e.KafkaClient.Flush(ctx)
		if err != nil {
			e.t.Logf("could not flush Kafka connection: %s", err)
		}
	}

	if e.routerCmd != nil {
		if err := e.routerCmd.Process.Signal(os.Interrupt); err != nil {
			e.t.Logf("could not interrupt router process: %s", err)
		}
	}
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
	Files         []FileUpload    `json:"-"`
	Cookies       []*http.Cookie  `json:"-"`
}

type FileUpload struct {
	VariablesPath string
	FileContent   []byte
}

type TestResponse struct {
	Body     string
	Response *http.Response
	Proto    string
}

func (e *Environment) WaitForServer(ctx context.Context, url string, timeoutMs int, maxAttempts int) error {
	for {
		if maxAttempts == 0 {
			return errors.New("max attempts reached, timed out waiting for server to be ready")
		}
		select {
		case <-ctx.Done():
			return errors.New("context timed out waiting for router to be ready")
		default:
			reqCtx, cancelFn := context.WithTimeout(context.Background(), time.Second)
			req, err := http.NewRequestWithContext(reqCtx, "GET", url, nil)
			if err != nil {
				cancelFn()
				e.t.Fatalf("Could not create request for health check")
			}
			req.Header.Set("User-Agent", "Router-tests")
			resp, err := e.RouterClient.Do(req)
			cancelFn()
			if err == nil && resp.StatusCode == 200 {
				return nil
			}
			time.Sleep(time.Millisecond * time.Duration(timeoutMs))
			maxAttempts--
		}
	}
}

func (e *Environment) WaitForMCPServer(ctx context.Context, timeoutMs int, maxAttempts int) error {
	if err := e.MCPClient.Start(ctx); err != nil {
		e.t.Fatalf("Failed to start MCP client: %v", err)
	}

	for {
		if maxAttempts == 0 {
			return errors.New("timed out waiting for server to be ready")
		}
		select {
		case <-ctx.Done():
			return errors.New("timed out waiting for router to be ready")
		default:
			reqCtx, cancelFn := context.WithTimeout(context.Background(), time.Second)
			initRequest := mcp.InitializeRequest{}
			initRequest.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
			initRequest.Params.ClientInfo = mcp.Implementation{
				Name:    "testenv-client",
				Version: "1.0.0",
			}

			_, err := e.MCPClient.Initialize(reqCtx, initRequest)
			if err != nil {
				e.t.Fatalf("Failed to initialize MCP client: %v", err)
			}

			cancelFn()

			// Test Ping
			if err := e.MCPClient.Ping(ctx); err != nil {
				e.t.Logf("Ping failed: %v", err)
			} else {
				return nil
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
	data, err := json.Marshal(request)
	require.NoError(e.t, err)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.GraphQLRequestURL(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if request.Header != nil {
		req.Header = request.Header
	}

	if request.Cookies != nil {
		for _, c := range request.Cookies {
			req.AddCookie(c)
		}
	}

	req.Header.Set("Accept-Encoding", "identity")
	return e.MakeGraphQLRequestRaw(req)
}

func (e *Environment) MakeGraphQLBatchedRequestRequest(
	request []GraphQLRequest,
	headers map[string]string,
) (*TestResponse, error) {
	return e.MakeGraphQLBatchedRequestRequestWithContext(e.Context, request, headers)
}

func (e *Environment) MakeGraphQLBatchedRequestRequestWithContext(
	ctx context.Context,
	request []GraphQLRequest,
	headers map[string]string,
) (*TestResponse, error) {
	data, err := json.Marshal(request)
	require.NoError(e.t, err)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.GraphQLRequestURL(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept-Encoding", "identity")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	return e.MakeGraphQLRequestRaw(req)
}

func (e *Environment) MakeGraphQLRequestWithHeaders(request GraphQLRequest, headers map[string]string) (*TestResponse, error) {
	data, err := json.Marshal(request)
	require.NoError(e.t, err)
	req, err := http.NewRequestWithContext(e.Context, http.MethodPost, e.GraphQLRequestURL(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if request.Header != nil {
		req.Header = request.Header
	}
	req.Header.Set("Accept-Encoding", "identity")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return e.MakeGraphQLRequestRaw(req)
}

func (e *Environment) MakeGraphQLRequestOverGET(request GraphQLRequest) (*TestResponse, error) {
	req, err := e.newGraphQLRequestOverGET(e.GraphQLRequestURL(), request)
	if err != nil {
		return nil, err
	}

	return e.MakeGraphQLRequestRaw(req)
}

func (e *Environment) newGraphQLRequestOverGET(baseURL string, request GraphQLRequest) (*http.Request, error) {
	req, err := http.NewRequestWithContext(e.Context, http.MethodGet, baseURL, nil)
	if err != nil {
		return nil, err
	}
	if request.Header != nil {
		req.Header = request.Header
	}
	req.Header.Set("Accept-Encoding", "identity")

	q := req.URL.Query()
	if request.Query != "" {
		q.Add("query", request.Query)
	}
	if request.Variables != nil {
		q.Add("variables", string(request.Variables))
	}
	if request.OperationName != nil {
		q.Add("operationName", string(request.OperationName))
	}
	if request.Extensions != nil {
		q.Add("extensions", string(request.Extensions))
	}
	req.URL.RawQuery = q.Encode()

	return req, nil
}

func (e *Environment) MakeGraphQLRequestRaw(request *http.Request) (*TestResponse, error) {
	request.Header.Set("Accept-Encoding", "identity")
	resp, err := e.RouterClient.Do(request)
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
	return e.MakeGraphQLRequestWithContext(e.Context, request)
}

func (e *Environment) MakeGraphQLRequestAsMultipartForm(request GraphQLRequest) (*TestResponse, error) {
	data, err := json.Marshal(request)
	require.NoError(e.t, err)
	formValues := make(map[string]io.Reader)
	formValues["operations"] = bytes.NewReader(data)

	if len(request.Files) > 0 {
		mapStr := `{`
		for i := 0; i < len(request.Files); i++ {
			if i > 0 {
				mapStr += ", "
			}
			mapStr += fmt.Sprintf(`"%d": ["%s"]`, i, request.Files[i].VariablesPath)
		}
		mapStr += `}`
		formValues["map"] = strings.NewReader(mapStr)
		for i := 0; i < len(request.Files); i++ {
			formValues[fmt.Sprintf("%d", i)] = bytes.NewReader(request.Files[i].FileContent)
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

func (e *Environment) MakeGraphQLMultipartRequest(method string, body io.Reader) *http.Request {
	req, err := http.NewRequest(method, e.GraphQLRequestURL(), body)
	require.NoError(e.t, err)

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "multipart/mixed;subscriptionSpec=\"1.0\", application/json")
	req.Header.Set("Connection", "keep-alive")

	return req
}

func (e *Environment) GraphQLWebSocketSubscriptionURL() string {
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

type GraphQLErrorExtensions struct {
	Code        string         `json:"code"`
	StatusCode  int            `json:"statusCode"`
	ServiceName string         `json:"serviceName"`
	Errors      []GraphQLError `json:"errors"`
}

type GraphQLError struct {
	Message    string                 `json:"message"`
	Path       []any                  `json:"path,omitempty"`
	Extensions GraphQLErrorExtensions `json:"extensions,omitempty"`
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
		urlStr := e.GraphQLWebSocketSubscriptionURL()
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
	require.NoError(e.t, ReadAndCheckJSON(e.t, conn, &ack))
	require.Equal(e.t, "connection_ack", ack.Type)
	return conn
}

func (e *Environment) GraphQLSubscriptionOverSSE(ctx context.Context, request GraphQLRequest, handler func(data string)) {
	req, err := e.newGraphQLRequestOverGET(e.GraphQLRequestURL(), request)
	if err != nil {
		e.t.Fatalf("could not create request: %s", err)
	}

	resp, err := e.RouterClient.Do(req)
	if err != nil {
		e.t.Fatalf("could not make request: %s", err)
	}
	defer resp.Body.Close()

	require.Equal(e.t, "text/event-stream", resp.Header.Get("Content-Type"))
	require.Equal(e.t, "no-cache", resp.Header.Get("Cache-Control"))
	require.Equal(e.t, "keep-alive", resp.Header.Get("Connection"))
	require.Equal(e.t, "no", resp.Header.Get("X-Accel-Buffering"))

	// Check for the correct response status code
	if resp.StatusCode != http.StatusOK {
		e.t.Fatalf("expected status code 200, got %d", resp.StatusCode)
	}

	e.ReadSSE(ctx, resp.Body, handler)
}

func (e *Environment) GraphQLSubscriptionOverSSEWithQueryParam(ctx context.Context, request GraphQLRequest, handler func(data string)) {
	req, err := e.newGraphQLRequestOverGET(e.GraphQLServeSentEventsURL(), request)
	if err != nil {
		e.t.Fatalf("could not create request: %s", err)
	}

	resp, err := e.RouterClient.Do(req)
	if err != nil {
		e.t.Fatalf("could not make request: %s", err)
	}
	defer resp.Body.Close()

	require.Equal(e.t, "text/event-stream", resp.Header.Get("Content-Type"))
	require.Equal(e.t, "no-cache", resp.Header.Get("Cache-Control"))
	require.Equal(e.t, "keep-alive", resp.Header.Get("Connection"))
	require.Equal(e.t, "no", resp.Header.Get("X-Accel-Buffering"))

	// Check for the correct response status code
	if resp.StatusCode != http.StatusOK {
		e.t.Fatalf("expected status code 200, got %d", resp.StatusCode)
	}

	e.ReadSSE(ctx, resp.Body, handler)
}

func (e *Environment) ReadSSE(ctx context.Context, body io.ReadCloser, handler func(data string)) {
	reader := bufio.NewReader(body)

	// Process incoming events
	for {
		select {
		case <-ctx.Done():
			return
		case <-e.Context.Done():
			return
		case <-ctx.Done():
			return
		default:
			line, err := reader.ReadString('\n')
			if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, io.EOF) && !errors.Is(err, ErrEnvironmentClosed) {
				e.t.Fatalf("could not read line: %s", err)
				return
			}

			// SSE lines typically start with "event", "data", etc.
			if strings.HasPrefix(line, "data: ") {
				data := strings.TrimPrefix(line, "data: ")
				handler(data)
			}
		}
	}
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

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	report := e.Router.EngineStats.GetReport()
	if report.Subscriptions == desiredCount {
		return
	}

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for subscription count, got %d, want %d", report.Subscriptions, desiredCount)
			return
		case <-time.After(100 * time.Millisecond):
			report = e.Router.EngineStats.GetReport()
			if report.Subscriptions == desiredCount {
				return
			}
		}
	}
}

func (e *Environment) WaitForConnectionCount(desiredCount uint64, timeout time.Duration) {
	e.t.Helper()

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	report := e.Router.EngineStats.GetReport()
	if report.Connections == desiredCount {
		return
	}

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for connection count, got %d, want %d", report.Connections, desiredCount)
			return
		case <-time.After(100 * time.Millisecond):
			report = e.Router.EngineStats.GetReport()
			if report.Connections == desiredCount {
				return
			}
		}
	}
}

type EngineStatisticAssertion struct {
	Subscriptions int64
	Connections   int64
	MessagesSent  int64
	Triggers      int64
}

func (e *Environment) AssertEngineStatistics(t testing.TB, metricReader metric.Reader, assertions EngineStatisticAssertion) {
	t.Helper()

	rm := metricdata.ResourceMetrics{}
	require.NoError(t, metricReader.Collect(context.Background(), &rm))

	actual := EngineStatisticAssertion{}

	for _, sm := range rm.ScopeMetrics {
		if sm.Scope.Name != "cosmo.router.engine" {
			continue
		}

		for _, m := range sm.Metrics {
			d, ok := m.Data.(metricdata.Sum[int64])
			require.True(t, ok)

			require.Len(t, d.DataPoints, 1)

			switch m.Name {
			case "router.engine.subscriptions":
				actual.Subscriptions = d.DataPoints[0].Value
			case "router.engine.connections":
				actual.Connections = d.DataPoints[0].Value
			case "router.engine.messages.sent":
				actual.MessagesSent = d.DataPoints[0].Value
			case "router.engine.triggers":
				actual.Triggers = d.DataPoints[0].Value
			}
		}
	}

	require.Equal(t, assertions.Subscriptions, actual.Subscriptions)
	require.Equal(t, assertions.Connections, actual.Connections)
	require.Equal(t, assertions.Triggers, actual.Triggers)
	// messages sent depends on how slow the test execution is, so we only check that it's greater or equal
	require.GreaterOrEqual(t, actual.MessagesSent, assertions.MessagesSent)
}

func (e *Environment) WaitForMessagesSent(desiredCount uint64, timeout time.Duration) {
	e.t.Helper()

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	report := e.Router.EngineStats.GetReport()
	if report.MessagesSent == desiredCount {
		return
	}

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for messages sent, got %d, want %d", report.MessagesSent, desiredCount)
			return
		case <-time.After(100 * time.Millisecond):
			report = e.Router.EngineStats.GetReport()
			if report.MessagesSent == desiredCount {
				return
			}
		}
	}
}

func (e *Environment) WaitForMinMessagesSent(minCount uint64, timeout time.Duration) {
	e.t.Helper()

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	report := e.Router.EngineStats.GetReport()
	if report.MessagesSent >= minCount {
		return
	}

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for messages sent, got %d, want at least %d", report.MessagesSent, minCount)
			return
		case <-time.After(100 * time.Millisecond):
			report = e.Router.EngineStats.GetReport()
			if report.MessagesSent >= minCount {
				return
			}
		}
	}
}

func (e *Environment) WaitForTriggerCount(desiredCount uint64, timeout time.Duration) {
	e.t.Helper()

	ctx, cancel := context.WithTimeout(e.Context, timeout)
	defer cancel()

	report := e.Router.EngineStats.GetReport()
	if report.Triggers == desiredCount {
		return
	}

	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for trigger count, got %d, want %d", report.Triggers, desiredCount)
			return
		case <-time.After(100 * time.Millisecond):
			report = e.Router.EngineStats.GetReport()
			if report.Triggers == desiredCount {
				return
			}
		}
	}
}

func WSReadMessage(t testing.TB, conn *websocket.Conn) (messageType int, p []byte, err error) {
	b := backoff.New(5*time.Second, 100*time.Millisecond)

	attempts := 0
	maxAttempts := 10

	for attempts < maxAttempts {
		attempts++

		// Set a reasonable read deadline
		readDeadline := time.Now().Add(2 * time.Second)
		if err = conn.SetReadDeadline(readDeadline); err != nil {
			t.Logf("Failed to set read deadline: %v", err)
			return 0, nil, err
		}

		messageType, p, err = conn.ReadMessage()

		// Reset the deadline to prevent future operations from timing out
		if resetErr := conn.SetReadDeadline(time.Time{}); resetErr != nil {
			t.Logf("Failed to reset read deadline: %v", resetErr)
		}

		if err == nil {
			return messageType, p, nil
		}

		if attempts >= maxAttempts {
			return 0, nil, fmt.Errorf("failed to read from WebSocket after %d attempts: %w", attempts, err)
		}

		// Get backoff duration for this attempt
		duration := b.Duration()
		t.Logf("WebSocket read error (attempt %d/%d): %v - retrying in %v...",
			attempts, maxAttempts, err, duration)

		time.Sleep(duration)
	}

	// This should not be reached
	return 0, nil, fmt.Errorf("failed to read from WebSocket: %w", err)
}

func WSReadJSON(t testing.TB, conn *websocket.Conn, v interface{}) (err error) {
	b := backoff.New(5*time.Second, 100*time.Millisecond)

	attempts := 0
	maxAttempts := 10

	for attempts < maxAttempts {
		attempts++

		// Set a reasonable read deadline
		readDeadline := time.Now().Add(2 * time.Second)
		if err = conn.SetReadDeadline(readDeadline); err != nil {
			t.Logf("Failed to set read deadline: %v", err)
			return err
		}

		require.NoError(t, ReadAndCheckJSON(t, conn, v))

		// Reset the deadline to prevent future operations from timing out
		if resetErr := conn.SetReadDeadline(time.Time{}); resetErr != nil {
			t.Logf("Failed to reset read deadline: %v", resetErr)
		}

		if err == nil {
			return nil
		}

		if attempts >= maxAttempts {
			return fmt.Errorf("failed to read JSON from WebSocket after %d attempts: %w", attempts, err)
		}

		// Get backoff duration for this attempt
		duration := b.Duration()
		t.Logf("WebSocket read JSON error (attempt %d/%d): %v - retrying in %v...",
			attempts, maxAttempts, err, duration)

		time.Sleep(duration)
	}

	// This should not be reached
	return fmt.Errorf("failed to read JSON from WebSocket: %w", err)
}

func WSWriteMessage(t testing.TB, conn *websocket.Conn, messageType int, data []byte) (err error) {
	b := backoff.New(5*time.Second, 100*time.Millisecond)

	attempts := 0
	maxAttempts := 10

	for attempts < maxAttempts {
		attempts++

		// Set a reasonable write deadline
		writeDeadline := time.Now().Add(2 * time.Second)
		if err = conn.SetWriteDeadline(writeDeadline); err != nil {
			t.Logf("Failed to set write deadline: %v", err)
			return err
		}

		err = conn.WriteMessage(messageType, data)

		// Reset the deadline to prevent future operations from timing out
		if resetErr := conn.SetWriteDeadline(time.Time{}); resetErr != nil {
			t.Logf("Failed to reset write deadline: %v", resetErr)
		}

		if err == nil {
			return nil
		}

		if attempts >= maxAttempts {
			return fmt.Errorf("failed to write message to WebSocket after %d attempts: %w", attempts, err)
		}

		// Get backoff duration for this attempt
		duration := b.Duration()
		t.Logf("WebSocket write message error (attempt %d/%d): %v - retrying in %v...",
			attempts, maxAttempts, err, duration)

		time.Sleep(duration)
	}

	// This should not be reached
	return fmt.Errorf("failed to write message to WebSocket: %w", err)
}

func WSWriteJSON(t testing.TB, conn *websocket.Conn, v interface{}) (err error) {
	b := backoff.New(5*time.Second, 100*time.Millisecond)

	attempts := 0
	maxAttempts := 10

	for attempts < maxAttempts {
		attempts++

		// Set a reasonable write deadline
		writeDeadline := time.Now().Add(2 * time.Second)
		if err = conn.SetWriteDeadline(writeDeadline); err != nil {
			t.Logf("Failed to set write deadline: %v", err)
			return err
		}

		err = conn.WriteJSON(v)

		// Reset the deadline to prevent future operations from timing out
		if resetErr := conn.SetWriteDeadline(time.Time{}); resetErr != nil {
			t.Logf("Failed to reset write deadline: %v", resetErr)
		}

		if err == nil {
			return nil
		}

		if attempts >= maxAttempts {
			return fmt.Errorf("failed to write JSON to WebSocket after %d attempts: %w", attempts, err)
		}

		// Get backoff duration for this attempt
		duration := b.Duration()
		t.Logf("WebSocket write JSON error (attempt %d/%d): %v - retrying in %v...",
			attempts, maxAttempts, err, duration)

		time.Sleep(duration)
	}

	// This should not be reached
	return fmt.Errorf("failed to write JSON to WebSocket: %w", err)
}

func subgraphOptions(ctx context.Context, t testing.TB, logger *zap.Logger, natsData *NatsData, pubSubName func(string) string) *subgraphs.SubgraphOptions {
	if natsData == nil {
		return &subgraphs.SubgraphOptions{
			NatsPubSubByProviderID: map[string]pubsubNats.Adapter{},
			GetPubSubName:          pubSubName,
		}
	}
	natsPubSubByProviderID := make(map[string]pubsubNats.Adapter, len(DemoNatsProviders))
	for _, sourceName := range DemoNatsProviders {
		adapter, err := pubsubNats.NewAdapter(ctx, logger, natsData.Params[0].Url, natsData.Params[0].Opts, "hostname", "listenaddr", datasource.ProviderOpts{
			StreamMetricStore: rmetric.NewNoopStreamMetricStore(),
		})
		require.NoError(t, err)
		require.NoError(t, adapter.Startup(ctx))
		t.Cleanup(func() {
			require.NoError(t, adapter.Shutdown(context.Background()))
		})
		natsPubSubByProviderID[sourceName] = adapter
	}

	return &subgraphs.SubgraphOptions{
		NatsPubSubByProviderID: natsPubSubByProviderID,
		GetPubSubName:          pubSubName,
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
