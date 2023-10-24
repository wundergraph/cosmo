package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/routerconfig"
	"github.com/wundergraph/cosmo/router-tests/runner"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

var (
	subgraphsMode = flag.String("subgraphs", "in-process", "How to run the subgraphs: in-process | subprocess | external")
	workers       = flag.Int("workers", 4, "Number of workers to use for parallel benchmarks")

	subgraphsRunner runner.SubgraphsRunner
)

func TestMain(m *testing.M) {
	flag.Parse()
	ctx := context.Background()
	var err error
	switch *subgraphsMode {
	case "in-process":
		subgraphsRunner, err = runner.NewInProcessSubgraphsRunner(nil)
	case "subprocess":
		subgraphsRunner, err = runner.NewSubprocessSubgraphsRunner(nil)
	case "external":
		subgraphsRunner, err = runner.NewExternalSubgraphsRunner()
	default:
		panic(fmt.Errorf("unknown subgraphs mode %q", *subgraphsMode))
	}
	if err != nil {
		panic(err)
	}
	// defer this in case we panic, then call it manually before os.Exit()
	stop := func() {
		if err := subgraphsRunner.Stop(ctx); err != nil {
			panic(err)
		}
	}
	defer stop()
	go func() {
		err := subgraphsRunner.Start(ctx)
		if err != nil {
			panic(err)
		}
	}()

	timeoutCtx, cancelFunc := context.WithTimeout(ctx, 50*time.Second)
	defer cancelFunc()
	// Wait until the ports are open
	if err := runner.Wait(timeoutCtx, subgraphsRunner); err != nil {
		panic(err)
	}

	res := m.Run()
	stop()
	os.Exit(res)
}

func randString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}
	return string(b)
}

type testQuery struct {
	Name      string
	Body      string
	Variables map[string]interface{}
}

func (t *testQuery) Data() []byte {
	name := t.Name
	if name == "" {
		name = randString(10)
	}
	values := map[string]interface{}{
		"query":         fmt.Sprintf("query %s %s", name, t.Body),
		"operationName": name,
	}
	if len(t.Variables) > 0 {
		values["variables"] = t.Variables
	}
	data, err := json.Marshal(values)
	if err != nil {
		panic(err)
	}
	return data
}

func sendQueryOK(tb testing.TB, server *core.Server, query *testQuery) string {
	rr := sendData(server, query.Data())
	if rr.Code != http.StatusOK {
		tb.Error("unexpected status code", rr.Code)
	}
	return rr.Body.String()
}

func sendData(server *core.Server, data []byte) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(data))
	server.Server.Handler.ServeHTTP(rr, req)
	return rr
}

func prepareServer(tb testing.TB, opts ...core.Option) *core.Server {
	ctx := context.Background()
	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
	}

	configFile, err := routerconfig.SerializeRunner(subgraphsRunner)
	require.NoError(tb, err)

	routerConfig, err := core.SerializeConfigFromFile(configFile)
	require.NoError(tb, err)

	ec := zap.NewProductionEncoderConfig()
	ec.EncodeDuration = zapcore.SecondsDurationEncoder
	ec.TimeKey = "time"

	syncer := zapcore.AddSync(os.Stderr)

	zapLogger := zap.New(zapcore.NewCore(
		zapcore.NewConsoleEncoder(ec),
		syncer,
		zapcore.ErrorLevel,
	))

	routerOpts := []core.Option{
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithLogger(zapLogger),
	}
	routerOpts = append(routerOpts, opts...)
	rs, err := core.NewRouter(routerOpts...)
	require.NoError(tb, err)

	tb.Cleanup(func() {
		assert.Nil(tb, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(tb, err)
	return server
}

// setupServer sets up the router server without making it listen on a local
// port, allowing tests by calling the server directly via server.Server.Handler.ServeHTTP
func setupServer(tb testing.TB) *core.Server {
	return prepareServer(tb)
}

// setupListeningServer calls setupServer to set up the server but makes it listen
// on the network, automatically registering a cleanup function to shut it down.
// It returns both the server and the local port where the server is listening.
func setupListeningServer(tb testing.TB) (*core.Server, int) {
	listener, err := net.Listen("tcp", ":0")
	require.NoError(tb, err)
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	server := prepareServer(tb, core.WithListenerAddr(":"+strconv.Itoa(port)))
	go func() {
		err := server.Server.ListenAndServe()
		if err != http.ErrServerClosed {
			require.NoError(tb, err)
		}
	}()
	tb.Cleanup(func() {
		err := server.Shutdown(context.Background())
		assert.NoError(tb, err)
	})
	return server, port
}

func normalizeJSON(tb testing.TB, data []byte) []byte {
	var v interface{}
	err := json.Unmarshal(data, &v)
	require.NoError(tb, err)
	normalized, err := json.MarshalIndent(v, "", "  ")
	require.NoError(tb, err)
	return normalized
}

func TestIntegration(t *testing.T) {
	server := setupServer(t)
	result := sendQueryOK(t, server, &testQuery{
		Body: "{ employees { id } }",
	})
	assert.JSONEq(t, result, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`)
}

func TestTestdataQueries(t *testing.T) {
	server := setupServer(t)
	queries := filepath.Join("testdata", "queries")
	entries, err := os.ReadDir(queries)
	require.NoError(t, err)
	for _, entry := range entries {
		if !entry.IsDir() {
			t.Fatalf("unexpected file in %s: %s", queries, entry.Name())
		}
		name := entry.Name()
		t.Run(name, func(t *testing.T) {
			testDir := filepath.Join(queries, name)
			queryData, err := os.ReadFile(filepath.Join(testDir, "query.graphql"))
			require.NoError(t, err)
			payload := map[string]any{
				"query": string(queryData),
			}
			payloadData, err := json.Marshal(payload)
			require.NoError(t, err)
			recorder := sendData(server, payloadData)
			if recorder.Code != http.StatusOK {
				t.Error("unexpected status code", recorder.Code)
			}
			result := recorder.Body.String()
			expectedData, err := os.ReadFile(filepath.Join(testDir, "result.json"))
			require.NoError(t, err)
			assert.Equal(t, normalizeJSON(t, expectedData), normalizeJSON(t, []byte(result)))

		})
	}
}

func TestIntegrationWithUndefinedField(t *testing.T) {
	server := setupServer(t)
	result := sendQueryOK(t, server, &testQuery{
		Body: "{ employees { id notDefined } }",
	})
	assert.JSONEq(t, `{"errors":[{"message":"field: notDefined not defined on type: Employee","path":["query","employees","notDefined"]}]}`, result)
}

func TestIntegrationWithVariables(t *testing.T) {
	server := setupServer(t)
	q := &testQuery{
		Body:      "($n:Int!) { employee(id:$n) { id details { forename surname } } }",
		Variables: map[string]interface{}{"n": 1},
	}
	result := sendQueryOK(t, server, q)
	assert.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, result)
}

func TestIntegrationWithInlineVariables(t *testing.T) {
	server := setupServer(t)
	q := &testQuery{
		Body: "{ employee(id:1) { id details { forename surname } } }",
	}
	result := sendQueryOK(t, server, q)
	assert.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, result)
}

func BenchmarkSequential(b *testing.B) {
	server := setupServer(b)
	q := &testQuery{
		Body:      "($n:Int!) { employee(id:$n) { id details { forename surname } } }",
		Variables: map[string]interface{}{"n": 1},
	}
	expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
	b.ReportAllocs()
	b.ResetTimer()
	for ii := 0; ii < b.N; ii++ {
		got := sendQueryOK(b, server, q)
		if got != expect {
			b.Errorf("unexpected result %q, expecting %q", got, expect)
		}
	}
}

func BenchmarkParallel(b *testing.B) {
	server := setupServer(b)
	q := &testQuery{
		Body:      "($n:Int!) { employee(id:$n) { id details { forename surname } } }",
		Variables: map[string]interface{}{"n": 1},
	}
	expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
	ch := make(chan struct{})
	// Start the workers
	var wg sync.WaitGroup
	wg.Add(*workers)
	for ii := 0; ii < *workers; ii++ {
		go func() {
			defer wg.Done()
			for range ch {
				got := sendQueryOK(b, server, q)
				if got != expect {
					b.Errorf("unexpected result %q, expecting %q", got, expect)
				}
			}
		}()
	}
	b.ReportAllocs()
	b.ResetTimer()
	for ii := 0; ii < b.N; ii++ {
		ch <- struct{}{}
	}
	close(ch)
	wg.Wait()
}

func BenchmarkParallelInlineVariables(b *testing.B) {
	server := setupServer(b)
	q := &testQuery{
		Body: "{ employee(id:1) { id details { forename surname } } }",
	}
	expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
	ch := make(chan struct{})
	// Start the workers
	var wg sync.WaitGroup
	wg.Add(*workers)
	for ii := 0; ii < *workers; ii++ {
		go func() {
			defer wg.Done()
			for range ch {
				got := sendQueryOK(b, server, q)
				if got != expect {
					b.Errorf("unexpected result %q, expecting %q", got, expect)
				}
			}
		}()
	}
	b.ReportAllocs()
	b.ResetTimer()
	for ii := 0; ii < b.N; ii++ {
		ch <- struct{}{}
	}
	close(ch)
	wg.Wait()
}

// Notes on fuzzing! The go fuzzer runs multiple processes in parallel, so we
// need to run the subgraphs off process. This is done by starting demo/cmd/all/main.go
// and running go test -v -subgraphs external -fuzz=.
//
// Keep in mind that during normal test runs the tests generated from fuzzing are ran
// as normal tests so running the subgraphs in-process works fine.

func FuzzQuery(f *testing.F) {
	server := setupServer(f)
	corpus := []struct {
		Query     string
		Variables []byte // As JSON
	}{
		{
			Query: "{ employees { id } }",
		},
		{
			Query: `($team:Department!= MARKETING) {
				team_mates(team:$team) {
				  id
				}
			  }`,
			Variables: []byte(`{"team":"MARKETING"}`),
		},
		{
			Query:     `($n:Int!) { employee(id:$n) { id } }`,
			Variables: []byte(`{"n":4}`),
		},
	}
	for _, tc := range corpus {
		f.Add(tc.Query, tc.Variables)
	}
	f.Fuzz(func(t *testing.T, query string, variables []byte) {
		rr := httptest.NewRecorder()
		var q testQuery
		if err := json.Unmarshal(variables, &q.Variables); err != nil {
			// Invalid JSON, mark as uninteresting input
			t.Skip()
		}
		q.Body = query
		req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(q.Data()))
		server.Server.Handler.ServeHTTP(rr, req)
		if rr.Code != 200 && rr.Code != 400 {
			t.Error("unexpected status code", rr.Code)
		}
	})
}
