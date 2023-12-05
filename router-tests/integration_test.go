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
	"regexp"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/buger/jsonparser"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/routerconfig"
	"github.com/wundergraph/cosmo/router-tests/runner"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
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
	return sendDataWithHeader(server, data, nil)
}

func sendDataWithHeader(server *core.Server, data []byte, header http.Header) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(data))
	if header != nil {
		req.Header = header
	}
	server.Server.Handler.ServeHTTP(rr, req)
	return rr
}

func sendCustomData(server *core.Server, data []byte, reqMw func(r *http.Request)) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(data))
	reqMw(req)
	server.Server.Handler.ServeHTTP(rr, req)
	return rr
}

func testTokenClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"federated_graph_id": "graph",
		"organization_id":    "organization",
	}
}

// setupServer sets up the router server without making it listen on a local
// port, allowing tests by calling the server directly via server.Server.Handler.ServeHTTP
func setupServer(tb testing.TB, opts ...core.Option) *core.Server {
	server, _ := setupServerConfig(tb, opts...)
	return server
}

func setupCDNServer(tb testing.TB) string {
	cdnFileServer := http.FileServer(http.Dir(filepath.Join("testdata", "cdn")))
	var cdnRequestLog []string
	cdnServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			requestLog, err := json.Marshal(cdnRequestLog)
			require.NoError(tb, err)
			w.Header().Set("Content-Type", "application/json")
			w.Write(requestLog)
			return
		}
		cdnRequestLog = append(cdnRequestLog, r.Method+" "+r.URL.Path)
		// Ensure we have an authorization header with a valid token
		authorization := r.Header.Get("Authorization")
		token := authorization[len("Bearer "):]
		parsedClaims := make(jwt.MapClaims)
		jwtParser := new(jwt.Parser)
		_, _, err := jwtParser.ParseUnverified(token, parsedClaims)
		assert.NoError(tb, err)
		assert.Equal(tb, testTokenClaims(), parsedClaims)
		cdnFileServer.ServeHTTP(w, r)
	}))
	tb.Cleanup(cdnServer.Close)
	return cdnServer.URL
}

func setupServerConfig(tb testing.TB, opts ...core.Option) (*core.Server, config.Config) {
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

	t := jwt.New(jwt.SigningMethodHS256)
	t.Claims = testTokenClaims()
	graphApiToken, err := t.SignedString([]byte("hunter2"))
	require.NoError(tb, err)

	cfg.CDN.URL = setupCDNServer(tb)

	routerOpts := []core.Option{
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithLogger(zapLogger),
		core.WithGraphApiToken(graphApiToken),
		core.WithCDN(config.CDNConfiguration{URL: cfg.CDN.URL, CacheSize: 1024 * 1024}),
		core.WithDevelopmentMode(true),
		core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
			EnableSingleFlight:                     true,
			EnableRequestTracing:                   true,
			EnableExecutionPlanCacheResponseHeader: true,
		}),
	}
	routerOpts = append(routerOpts, opts...)
	rs, err := core.NewRouter(routerOpts...)
	require.NoError(tb, err)
	tb.Cleanup(func() {
		assert.Nil(tb, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(tb, err)
	return server, cfg
}

// setupListeningServer calls setupServer to set up the server but makes it listen
// on the network, automatically registering a cleanup function to shut it down.
// It returns both the server and the local port where the server is listening.
func setupListeningServer(tb testing.TB, opts ...core.Option) (*core.Server, int) {
	listener, err := net.Listen("tcp", ":0")
	require.NoError(tb, err)
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	serverOpts := append([]core.Option{
		core.WithListenerAddr(":" + strconv.Itoa(port)),
	}, opts...)
	server := setupServer(tb, serverOpts...)
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

func TestExecutionPlanCache(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables": {"criteria": {"nationality": "GERMAN"}}}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, "MISS", result.Header().Get("X-WG-Execution-Plan-Cache"))
	assert.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, result.Body.String())

	result2 := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables": {"criteria": {"nationality": "ENGLISH"}}}`))
	assert.Equal(t, http.StatusOK, result2.Result().StatusCode)
	assert.Equal(t, "HIT", result2.Header().Get("X-WG-Execution-Plan-Cache"))
	assert.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, result2.Body.String())

	result3 := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}"}`))
	assert.Equal(t, http.StatusOK, result3.Result().StatusCode)
	assert.Equal(t, "HIT", result3.Header().Get("X-WG-Execution-Plan-Cache"))
	assert.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, result3.Body.String())
}

func TestInvalidVariablesNumber(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":1}`))
	assert.Equal(t, http.StatusBadRequest, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"variables value must not be a number"}],"data":null}`, result.Body.String())
}

func TestInvalidVariablesString(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":"1"}`))
	assert.Equal(t, http.StatusBadRequest, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"variables value must not be a string"}],"data":null}`, result.Body.String())
}

func TestInvalidVariablesBoolean(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":true}`))
	assert.Equal(t, http.StatusBadRequest, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"variables value must not be a boolean"}],"data":null}`, result.Body.String())
}

func TestInvalidVariablesArray(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":[]}`))
	assert.Equal(t, http.StatusBadRequest, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"variables value must not be an array"}],"data":null}`, result.Body.String())
}

func TestVariablesValidationVariableMissing(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{}}`))
	assert.Equal(t, http.StatusBadRequest, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}],"data":null}`, result.Body.String())
}

func TestVariablesValidationVariableWrong(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":1}}`))
	assert.Equal(t, http.StatusBadRequest, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" got invalid value 1; Expected type \"SearchInput\" to be an object."}],"data":null}`, result.Body.String())
}

func TestVariablesValidationVariableCorrect(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, result.Body.String())
}

func TestAnonymousQuery(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"{ employees { id } }"}`))
	assert.Equal(t, http.StatusOK, result.Code)
	assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, result.Body.String())
}

func TestTracing(t *testing.T) {
	server := setupServer(t)
	result := sendCustomData(server, []byte(fmt.Sprintf(`{"query":"%s"}`, bigEmployeesQuery)), func(r *http.Request) {
		r.Header.Add("X-WG-Trace", "true")
		r.Header.Add("X-WG-Trace", "enable_predictable_debug_timings")
	})
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	tracingJsonBytes, err := os.ReadFile("testdata/tracing.json")
	require.NoError(t, err)
	// we generate a random port for the test server, so we need to replace the port in the tracing json
	rex, err := regexp.Compile(`http://localhost:\d+/graphql`)
	require.NoError(t, err)
	tracingJson := string(rex.ReplaceAll(tracingJsonBytes, []byte("http://localhost/graphql")))
	resultBody := rex.ReplaceAllString(result.Body.String(), "http://localhost/graphql")
	// all nodes have UUIDs, so we need to replace them with a static UUID
	rex2, err := regexp.Compile(`"id":"[a-f0-9\-]{36}"`)
	require.NoError(t, err)
	tracingJson = rex2.ReplaceAllString(tracingJson, `"id":"00000000-0000-0000-0000-000000000000"`)
	resultBody = rex2.ReplaceAllString(resultBody, `"id":"00000000-0000-0000-0000-000000000000"`)
	assert.Equal(t, prettifyJSON(t, tracingJson), prettifyJSON(t, resultBody))
	if t.Failed() {
		t.Log(resultBody)
	}
	// make the request again, but with "enable_predictable_debug_timings" disabled
	// compare the result and ensure that the timings are different
	result2 := sendCustomData(server, []byte(fmt.Sprintf(`{"query":"%s"}`, bigEmployeesQuery)), func(r *http.Request) {
		r.Header.Add("X-WG-Trace", "true")
	})
	assert.Equal(t, http.StatusOK, result2.Result().StatusCode)
	body := result2.Body.Bytes()
	data, _, _, err := jsonparser.Get(body, "data")
	require.NoError(t, err)
	assert.NotNilf(t, data, "data should not be nil: %s", body)
	tracing, _, _, err := jsonparser.Get(body, "extensions", "trace")
	require.NoError(t, err)
	assert.NotNilf(t, tracing, "tracing should not be nil: %s", body)
	assert.NotEqual(t, prettifyJSON(t, tracingJson), prettifyJSON(t, string(body)))
}

func prettifyJSON(t *testing.T, jsonStr string) string {
	var v interface{}
	err := json.Unmarshal([]byte(jsonStr), &v)
	require.NoError(t, err)
	normalized, err := json.MarshalIndent(v, "", "  ")
	require.NoError(t, err)
	return string(normalized)
}

func TestMultipleAnonymousQueries(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"{ employees { id } } { employees { id } }"}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"operation name is required when multiple operations are defined"}],"data":null}`, result.Body.String())
}

func TestOperationNameNullReturnsData(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"{ employees { id } }","operationName":null}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, result.Body.String())
}

func TestOperationNameWrongOnAnonymousOperation(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"{ employees { id } }","operationName":"Missing"}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}],"data":null}`, result.Body.String())
}

func TestOperationNameWrongOnNamedOperation(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query Exists { employees { id } }","operationName":"Missing"}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}],"data":null}`, result.Body.String())
}

func TestMultipleNamedOperations(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query A { employees { id } } query B { employees { id details { forename surname } } }","operationName":"A"}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, result.Body.String())
}

func TestMultipleNamedOperationsB(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query A { employees { id } } query B { employees { id details { forename surname } } }","operationName":"B"}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":9,"details":{"forename":"Alberto","surname":"Garcia Hierro"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, result.Body.String())
}

func TestMultipleNamedOperationsC(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, []byte(`{"query":"query A { employees { id } } query B { employees { id details { forename surname } } }","operationName":"C"}`))
	assert.Equal(t, http.StatusOK, result.Result().StatusCode)
	assert.Equal(t, `{"errors":[{"message":"operation with name 'C' not found"}],"data":null}`, result.Body.String())
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
	assert.JSONEq(t, `{"errors":[{"message":"field: notDefined not defined on type: Employee","path":["query","employees","notDefined"]}],"data":null}`, result)
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
		Name:      "Employee",
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

const (
	bigEmployeesQuery = `{
  employees {
    id
    details {
      forename
      surname
      hasChildren
    }
    role {
      title
      departments
    }
    hobbies {
      ... on Exercise {
        category
      }
      ... on Flying {
        planeModels
        yearsOfExperience
      }
      ... on Gaming {
        name
        genres
        yearsOfExperience
      }
      ... on Programming {
        languages
      }
      ... on Travelling {
        countriesLived
      }
      ... on Other {
        name
      }
    }
  }
}`
	bigEmployeesResponse = `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true},"role":{"title":["Founder","CEO"],"departments":["ENGINEERING","MARKETING"]},"hobbies":[{"category":"SPORT"},{"name":"Counter Strike","genres":["FPS"],"yearsOfExperience":20},{"name":"WunderGraph"},{"languages":["GO","TYPESCRIPT"]},{"countriesLived":["ENGLAND","GERMANY"]}]},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false},"role":{"title":["Co-founder","Tech Lead"],"departments":["ENGINEERING"]},"hobbies":[{"category":"STRENGTH_TRAINING"},{"name":"Counter Strike","genres":["FPS"],"yearsOfExperience":0.5},{"languages":["GO","RUST"]}]},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false},"role":{"title":["Co-founder","Head of Growth"],"departments":["MARKETING"]},"hobbies":[{"category":"HIKING"},{"category":"SPORT"},{"name":"Reading"},{"countriesLived":["AMERICA","SERBIA"]}]},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true},"role":{"title":["Co-founder","COO"],"departments":["OPERATIONS"]},"hobbies":[{"category":"HIKING"},{"planeModels":["Aquila AT01","Cessna C172","Cessna C206","Cirrus SR20","Cirrus SR22","Diamond DA40","Diamond HK36","Diamond DA20","Piper Cub","Pitts Special","Robin DR400"],"yearsOfExperience":20},{"countriesLived":["AMERICA","GERMANY"]}]},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false},"role":{"title":["Senior GO Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"name":"Building a house"},{"name":"Forumla 1"},{"name":"Raising cats"}]},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"name":"Chess","genres":["BOARD"],"yearsOfExperience":9.5},{"name":"Watching anime"}]},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"category":"STRENGTH_TRAINING"},{"name":"Miscellaneous","genres":["ADVENTURE","RPG","SIMULATION","STRATEGY"],"yearsOfExperience":17},{"name":"Watching anime"}]},{"id":9,"details":{"forename":"Alberto","surname":"Garcia Hierro","hasChildren":true},"role":{"title":["Senior Backend Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"category":"CALISTHENICS"},{"name":"Chess","genres":["BOARD"],"yearsOfExperience":2},{"languages":["RUST"]}]},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false},"role":{"title":["Senior Frontend Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"languages":["TYPESCRIPT"]},{"category":"CALISTHENICS"},{"category":"HIKING"},{"category":"STRENGTH_TRAINING"},{"name":"saas-ui"},{"countriesLived":["GERMANY","INDONESIA","NETHERLANDS","PORTUGAL","SPAIN","THAILAND"]}]},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true},"role":{"title":["Accounting \\u0026 Finance"],"departments":["OPERATIONS"]},"hobbies":[{"name":"Spending time with the family"}]},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"languages":["CSHARP","GO","RUST","TYPESCRIPT"]},{"category":"STRENGTH_TRAINING"},{"name":"Miscellaneous","genres":["ADVENTURE","BOARD","CARD","ROGUELITE","RPG","SIMULATION","STRATEGY"],"yearsOfExperience":25.5},{"countriesLived":["ENGLAND","KOREA","TAIWAN"]}]}]}}`
)

func BenchmarkPb(b *testing.B) {
	server := setupServer(b)
	q := &testQuery{
		Body: bigEmployeesQuery,
	}
	b.SetBytes(int64(len(bigEmployeesResponse)))
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			got := sendQueryOK(b, server, q)
			if len(got) < 3000 {
				b.Errorf("unexpected result %q, expecting \n\n%q", got, bigEmployeesResponse)
			}
		}
	})
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
