package testenv

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

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

var (
	//go:embed testdata/config.json
	configJSONTemplate string
)

func Run(t *testing.T, cfg *Config, f func(t *testing.T, xEnv *Environment)) {
	t.Helper()
	env, err := createTestEnv(t, cfg)
	if err != nil {
		t.Fatalf("could not create environment: %s", err)
	}
	t.Cleanup(env.close)
	f(t, env)
}

func Bench(b *testing.B, cfg *Config, f func(b *testing.B, xEnv *Environment)) {
	b.Helper()
	b.StopTimer()
	env, err := createTestEnv(b, cfg)
	if err != nil {
		b.Fatalf("could not create environment: %s", err)
	}
	b.Cleanup(env.close)
	b.StartTimer()
	f(b, env)
}

type Config struct {
	Subgraphs                          SubgraphsConfig
	RouterOptions                      []core.Option
	OverrideGraphQLPath                string
	OverrideAbsinthePath               string
	ModifyRouterConfig                 func(routerConfig *nodev1.RouterConfig)
	ModifyEngineExecutionConfiguration func(engineExecutionConfiguration *config.EngineExecutionConfiguration)
	ModifyCDNConfig                    func(cdnConfig *config.CDNConfiguration)
	DisableWebSockets                  bool
}

type SubgraphsConfig struct {
	GlobalMiddleware func(http.Handler) http.Handler
	GlobalDelay      time.Duration
	Employees        SubgraphConfig
	Family           SubgraphConfig
	Hobbies          SubgraphConfig
	Products         SubgraphConfig
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

func createTestEnv(t testing.TB, cfg *Config) (*Environment, error) {

	// Ensure that only one test environment is created at a time
	// We use freeport to get a free port for NATS and the Router
	// If we don't lock here, two parallel tests might get the same port
	envCreateMux.Lock()
	defer envCreateMux.Unlock()

	ctx, cancel := context.WithCancelCause(context.Background())

	natsPort, err := freeport.GetFreePort()
	if err != nil {
		t.Fatalf("could not get free port: %s", err)
	}

	opts := natsserver.Options{
		Host:   "localhost",
		Port:   natsPort,
		NoLog:  true,
		NoSigs: true,
	}

	ns := natstest.RunServer(&opts)
	if ns == nil {
		t.Fatalf("could not start NATS test server")
	}

	nc, err := nats.Connect(ns.ClientURL())
	if err != nil {
		return nil, err
	}

	counters := &SubgraphRequestCount{
		Global:       atomic.NewInt64(0),
		Employees:    atomic.NewInt64(0),
		Family:       atomic.NewInt64(0),
		Hobbies:      atomic.NewInt64(0),
		Products:     atomic.NewInt64(0),
		Test1:        atomic.NewInt64(0),
		Availability: atomic.NewInt64(0),
		Mood:         atomic.NewInt64(0),
		Countries:    atomic.NewInt64(0),
	}

	employees := &Subgraph{
		handler:          subgraphs.EmployeesHandler(subgraphOptions(t, ns)),
		middleware:       cfg.Subgraphs.Employees.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Employees,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Employees.Delay,
	}

	family := &Subgraph{
		handler:          subgraphs.FamilyHandler(subgraphOptions(t, ns)),
		middleware:       cfg.Subgraphs.Family.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Family,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Family.Delay,
	}

	hobbies := &Subgraph{
		handler:          subgraphs.HobbiesHandler(subgraphOptions(t, ns)),
		middleware:       cfg.Subgraphs.Hobbies.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Hobbies,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Hobbies.Delay,
	}

	products := &Subgraph{
		handler:          subgraphs.ProductsHandler(subgraphOptions(t, ns)),
		middleware:       cfg.Subgraphs.Products.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Products,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Products.Delay,
	}

	test1 := &Subgraph{
		handler:          subgraphs.Test1Handler(subgraphOptions(t, ns)),
		middleware:       cfg.Subgraphs.Test1.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Test1,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Test1.Delay,
	}

	availability := &Subgraph{
		handler:          subgraphs.AvailabilityHandler(subgraphOptions(t, ns)),
		middleware:       cfg.Subgraphs.Availability.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Availability,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Availability.Delay,
	}

	mood := &Subgraph{
		handler:          subgraphs.MoodHandler(subgraphOptions(t, ns)),
		middleware:       cfg.Subgraphs.Mood.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Mood,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Mood.Delay,
	}

	countries := &Subgraph{
		handler:          subgraphs.CountriesHandler(subgraphOptions(t, ns)),
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

	replacements := map[string]string{
		subgraphs.EmployeesDefaultDemoURL:    gqlURL(employeesServer),
		subgraphs.FamilyDefaultDemoURL:       gqlURL(familyServer),
		subgraphs.HobbiesDefaultDemoURL:      gqlURL(hobbiesServer),
		subgraphs.ProductsDefaultDemoURL:     gqlURL(productsServer),
		subgraphs.Test1DefaultDemoURL:        gqlURL(test1Server),
		subgraphs.AvailabilityDefaultDemoURL: gqlURL(availabilityServer),
		subgraphs.MoodDefaultDemoURL:         gqlURL(moodServer),
		subgraphs.CountriesDefaultDemoURL:    gqlURL(countriesServer),
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
	routerURL := fmt.Sprintf("http://%s", listenerAddr)

	client := retryablehttp.NewClient()
	client.Logger = nil

	rr, err := configureRouter(listenerAddr, cfg, &routerConfig, cdn, ns)
	if err != nil {
		return nil, err
	}

	svr, err := rr.NewServer(ctx)
	require.NoError(t, err)

	go func() {
		if err := svr.HttpServer().ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Errorf("could not start router: %s", err)
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

	e := &Environment{
		t:                    t,
		graphQLPath:          graphQLPath,
		absinthePath:         absinthePath,
		Context:              ctx,
		cancel:               cancel,
		Router:               rr,
		RouterURL:            routerURL,
		RouterClient:         client.StandardClient(),
		CDN:                  cdn,
		Nats:                 ns,
		NC:                   nc,
		SubgraphRequestCount: counters,
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
	e.waitForRouterConnection(ctx)
	return e, nil
}

func configureRouter(listenerAddr string, testConfig *Config, routerConfig *nodev1.RouterConfig, cdn *httptest.Server, nats *natsserver.Server) (*core.Router, error) {
	cfg := config.Config{
		Graph: config.Graph{},
		CDN: config.CDNConfiguration{
			URL:       cdn.URL,
			CacheSize: 1024 * 1024,
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
		Debug: config.EngineDebugConfiguration{
			ReportWebSocketConnections: true,
			PrintQueryPlans:            false,
		},
		EpollKqueuePollTimeout:    300 * time.Millisecond,
		EpollKqueueConnBufferSize: 1,
		WebSocketReadTimeout:      time.Millisecond * 100,
		MaxConcurrentResolvers:    128,
		ExecutionPlanCacheSize:    1024,
	}
	if testConfig.ModifyEngineExecutionConfiguration != nil {
		testConfig.ModifyEngineExecutionConfiguration(&engineExecutionConfig)
	}

	routerOpts := []core.Option{
		core.WithStaticRouterConfig(routerConfig),
		core.WithLogger(zapLogger),
		core.WithGraphApiToken(graphApiToken),
		core.WithDevelopmentMode(true),
		core.WithPlayground(true),
		core.WithEngineExecutionConfig(engineExecutionConfig),
		core.WithCDN(cfg.CDN),
		core.WithListenerAddr(listenerAddr),
		core.WithEvents(config.EventsConfiguration{
			Sources: []config.EventSource{
				{
					Provider: "NATS",
					URL:      nats.ClientURL(),
				},
			},
		}),
	}
	routerOpts = append(routerOpts, testConfig.RouterOptions...)
	if testConfig.OverrideGraphQLPath != "" {
		routerOpts = append(routerOpts, core.WithGraphQLPath(testConfig.OverrideGraphQLPath))
	}
	if !testConfig.DisableWebSockets {
		routerOpts = append(routerOpts, core.WithWebSocketConfiguration(&config.WebSocketConfiguration{
			Enabled: true,
			AbsintheProtocol: config.AbsintheProtocolConfiguration{
				Enabled:     true,
				HandlerPath: "/absinthe/socket",
			},
			ForwardUpgradeHeaders:     true,
			ForwardUpgradeQueryParams: true,
			ForwardInitialPayload:     true,
		}))
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
	cdnFileServer := http.FileServer(http.Dir(filepath.Join("testdata", "cdn")))
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
	t            testing.TB
	graphQLPath  string
	absinthePath string

	Context              context.Context
	cancel               context.CancelCauseFunc
	Router               *core.Router
	RouterURL            string
	RouterClient         *http.Client
	Servers              []*httptest.Server
	CDN                  *httptest.Server
	Nats                 *natsserver.Server
	NC                   *nats.Conn
	SubgraphRequestCount *SubgraphRequestCount

	extraURLQueryValues url.Values
}

func (e *Environment) SetExtraURLQueryValues(values url.Values) {
	e.extraURLQueryValues = values
}

func (e *Environment) Shutdown() {
	// Terminate test server resources
	e.cancel(errors.New("test environment closed"))

	// Gracefully shutdown router
	ctx, cancel := context.WithTimeout(e.Context, 5*time.Second)
	defer cancel()
	err := e.Router.Shutdown(ctx)
	if err != nil {
		e.t.Errorf("could not shutdown router: %s", err)
	}
}

type SubgraphRequestCount struct {
	Global       *atomic.Int64
	Employees    *atomic.Int64
	Family       *atomic.Int64
	Hobbies      *atomic.Int64
	Products     *atomic.Int64
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
}

type TestResponse struct {
	Body     string
	Response *http.Response
}

func (e *Environment) waitForRouterConnection(ctx context.Context) {
	// Wait for the router to be ready
	client := &http.Client{
		Transport: http.DefaultTransport,
		Timeout:   time.Millisecond * 100,
	}
	for {
		select {
		case <-ctx.Done():
			e.t.Fatalf("timed out waiting for router to be ready")
		default:
			resp, err := client.Get(e.RouterURL)
			if err == nil {
				_ = resp.Body.Close()
				return
			}
			time.Sleep(time.Millisecond * 100)
		}
	}
}

func (e *Environment) MakeGraphQLRequestOK(request GraphQLRequest) *TestResponse {
	resp, err := e.MakeGraphQLRequest(request)
	require.NoError(e.t, err)
	require.Equal(e.t, http.StatusOK, resp.Response.StatusCode)
	return resp
}

func (e *Environment) MakeGraphQLRequest(request GraphQLRequest) (*TestResponse, error) {
	data, err := json.Marshal(request)
	require.NoError(e.t, err)
	req, err := http.NewRequestWithContext(e.Context, http.MethodPost, e.GraphQLRequestURL(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if request.Header != nil {
		req.Header = request.Header
	}
	client := &http.Client{
		Transport: http.DefaultTransport,
		Timeout:   time.Second * 5,
	}
	resp, err := client.Do(req)
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
	}, nil
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
	client := &http.Client{
		Transport: http.DefaultTransport,
		Timeout:   time.Second * 5,
	}
	return client.Do(req)

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

func (e *Environment) GraphQLWebsocketDialWithRetry(header http.Header) (*websocket.Conn, *http.Response, error) {
	dialer := websocket.Dialer{
		Subprotocols: []string{"graphql-transport-ws"},
	}

	waitBetweenRetriesInMs := rand.Intn(10)
	timeToSleep := time.Duration(waitBetweenRetriesInMs) * time.Millisecond

	var err error

	for i := 0; i < maxSocketRetries; i++ {
		urlStr := e.GraphQLSubscriptionURL()
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

func (e *Environment) InitGraphQLWebSocketConnection(header http.Header, initialPayload json.RawMessage) *websocket.Conn {
	conn, _, err := e.GraphQLWebsocketDialWithRetry(header)
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

func (e *Environment) close() {
	// Give the router some time to shut down
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Gracefully shutdown router
	err := e.Router.Shutdown(ctx)
	if err != nil {
		e.t.Errorf("could not shutdown router: %s", err)
	}

	// Terminate test server resources
	e.cancel(errors.New("test environment closed"))

	// Close all test servers
	for _, s := range e.Servers {
		s.CloseClientConnections()
		s.Close()
	}

	// Close the CDN
	e.CDN.CloseClientConnections()
	e.CDN.Close()

	// Close NATS
	e.NC.Close()
	e.Nats.Shutdown()
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
		case report, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for subscription count, got %d, want %d", report.Subscriptions, desiredCount)
				return
			}
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
		case report, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for connection count, got %d, want %d", report.Connections, desiredCount)
				return
			}
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
		case report, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for messages sent, got %d, want %d", report.MessagesSent, desiredCount)
				return
			}
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
		case report, ok := <-sub:
			if !ok {
				e.t.Fatalf("timed out waiting for trigger count, got %d, want %d", report.Triggers, desiredCount)
				return
			}
			if report.Triggers == desiredCount {
				return
			}
		}
	}

}

func subgraphOptions(t testing.TB, ns *natsserver.Server) *subgraphs.SubgraphOptions {
	nc, err := nats.Connect(ns.ClientURL())
	require.NoError(t, err)
	return &subgraphs.SubgraphOptions{
		NC: nc,
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
