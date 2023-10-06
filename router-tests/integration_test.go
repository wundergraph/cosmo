package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

var (
	useSubprocess = flag.Bool("subprocess", false, "Run the subgraphs in a separate subprocess")
	workers       = flag.Int("workers", 4, "Number of workers to use for parallel benchmarks")
)

func TestMain(m *testing.M) {
	flag.Parse()
	ctx := context.Background()
	var runner SubgraphsRunner
	var err error
	if *useSubprocess {
		runner, err = NewSubprocessSubgraphsRunner()
	} else {
		runner, err = NewInProcessSubgraphsRunner()
	}
	if err != nil {
		panic(err)
	}
	// defer this in case we panic, then call it manually before os.Exit()
	stop := func() {
		if err := runner.Stop(ctx); err != nil {
			panic(err)
		}
	}
	defer stop()
	go func() {
		err := runner.Start(ctx)
		if err != nil {
			panic(err)
		}
	}()

	const maxRetries = 10

	// Wait until the ports are open
	for _, port := range runner.Ports() {
		retries := 0
		for {
			_, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
			if err == nil {
				break
			}
			retries++
			if retries > maxRetries {
				panic(fmt.Errorf("could not connect to port %d after %d retries", port, maxRetries))
			}
			time.Sleep(100 * time.Millisecond)
		}
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

func sendQuery(tb testing.TB, server *core.Server, query *testQuery) string {
	return sendData(tb, server, query.Data())
}

func sendData(tb testing.TB, server *core.Server, data []byte) string {
	rr := httptest.NewRecorder()

	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(data))
	server.Server.Handler.ServeHTTP(rr, req)

	if rr.Code != 200 {
		tb.Error("unexpected status code", rr.Code)
	}
	return rr.Body.String()
}

func setupServer(tb testing.TB) *core.Server {
	ctx := context.Background()
	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
	}

	routerConfig, err := core.SerializeConfigFromFile(filepath.Join("testdata", "config.json"))
	require.Nil(tb, err)

	ec := zap.NewProductionEncoderConfig()
	ec.EncodeDuration = zapcore.SecondsDurationEncoder
	ec.TimeKey = "time"

	syncer := zapcore.AddSync(os.Stderr)

	zapLogger := zap.New(zapcore.NewCore(
		zapcore.NewConsoleEncoder(ec),
		syncer,
		zapcore.ErrorLevel,
	))
	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithLogger(zapLogger),
		core.WithListenerAddr("http://localhost:3002"),
	)
	require.Nil(tb, err)

	tb.Cleanup(func() {
		assert.Nil(tb, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.Nil(tb, err)
	return server
}

func TestIntegration(t *testing.T) {
	server := setupServer(t)
	result := sendQuery(t, server, &testQuery{
		Body: "{ employees { id } }",
	})
	assert.JSONEq(t, result, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`)
}

func BenchmarkSequential(b *testing.B) {
	server := setupServer(b)
	q := &testQuery{
		Body:      "($n:Int!) { employee(id:$n) { id } }",
		Variables: map[string]interface{}{"n": 4},
	}
	data := q.Data()
	expect := sendData(b, server, data)
	b.ReportAllocs()
	b.ResetTimer()
	for ii := 0; ii < b.N; ii++ {
		got := sendData(b, server, data)
		if got != expect {
			b.Errorf("unexpected result %q, expecting %q", got, expect)
		}
	}
}

func BenchmarkParallel(b *testing.B) {
	server := setupServer(b)
	q := &testQuery{
		Body:      "($n:Int!) { employee(id:$n) { id } }",
		Variables: map[string]interface{}{"n": 4},
	}
	data := q.Data()
	expect := sendData(b, server, data)
	ch := make(chan struct{})
	// Start the workers
	var wg sync.WaitGroup
	wg.Add(*workers)
	for ii := 0; ii < *workers; ii++ {
		go func() {
			defer wg.Done()
			for range ch {
				got := sendData(b, server, data)
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
