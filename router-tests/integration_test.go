package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/buger/jsonparser"
	"github.com/golang-jwt/jwt/v5"
	"github.com/phayes/freeport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/runner"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

var (
	subgraphsMode = flag.String("subgraphs", "in-process", "How to run the subgraphs: in-process | subprocess | external")
	workers       = flag.Int("workers", 4, "Number of workers to use for parallel benchmarks")

	subgraphsRunner     runner.SubgraphsRunner
	subgraphsConfigFile string

	natsPort int
)

/*func TestMain(m *testing.M) {
	flag.Parse()

	var (
		err error
	)

	natsPort, err = freeport.GetFreePort()
	if err != nil {
		panic(err)
	}

	opts := natsserver.Options{
		Host:   "localhost",
		Port:   natsPort,
		NoLog:  true,
		NoSigs: true,
	}
	nats := natstest.RunServer(&opts)
	if nats == nil {
		panic("could not start NATS test server")
	}

	defer nats.Shutdown()

	// Set this to allow the subgraphs to connect to the NATS server
	err = os.Setenv("NATS_URL", fmt.Sprintf("nats://localhost:%d", natsPort))
	if err != nil {
		panic(err)
	}

	ctx := context.Background()

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
			if errors.Is(err, context.Canceled) {
				return
			}
			panic(err)
		}
	}()

	timeoutCtx, cancelFunc := context.WithTimeout(ctx, 50*time.Second)
	defer cancelFunc()
	// Wait until the ports are open
	if err := runner.Wait(timeoutCtx, subgraphsRunner); err != nil {
		panic(err)
	}

	subgraphsConfigFile, err = routerconfig.SerializeRunner(subgraphsRunner)
	if err != nil {
		panic(err)
	}

	res := m.Run()
	stop()
	os.Exit(res)
}*/

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

func sendQueryOK(tb testing.TB, server *core.Server, graphqlPath string, query *testQuery) string {
	rr := sendData(server, graphqlPath, query.Data())
	if rr.Code != http.StatusOK {
		tb.Error("unexpected status code", rr.Code)
	}
	return rr.Body.String()
}

func sendData(server *core.Server, graphqlPath string, data []byte) *httptest.ResponseRecorder {
	return sendDataWithHeader(server, graphqlPath, data, nil)
}

func sendDataWithHeader(server *core.Server, graphqlPath string, data []byte, header http.Header) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", graphqlPath, bytes.NewBuffer(data))
	if header != nil {
		req.Header = header
	}
	server.Server.Handler.ServeHTTP(rr, req)
	return rr
}

func sendHtmlRequest(server *core.Server, path string) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", path, nil)
	req.Header.Set("Accept", "text/html")
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

	routerConfig, err := core.SerializeConfigFromFile(subgraphsConfigFile)
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
		core.WithPlayground(true),
		core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{
			EnableSingleFlight:                     true,
			EnableRequestTracing:                   true,
			EnableExecutionPlanCacheResponseHeader: true,
		}),
		core.WithEvents(config.EventsConfiguration{
			Sources: []config.EventSource{
				{
					Provider: "NATS",
					URL:      fmt.Sprintf("nats://localhost:%d", natsPort),
				},
			},
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

	port, err := freeport.GetFreePort()
	require.NoError(tb, err)

	serverOpts := append([]core.Option{
		core.WithListenerAddr(":" + strconv.Itoa(port)),
	}, opts...)
	server := setupServer(tb, serverOpts...)
	go func() {
		err := server.Server.ListenAndServe()
		if !errors.Is(err, http.ErrServerClosed) {
			require.NoError(tb, err)
		}
	}()
	tb.Cleanup(func() {
		err := server.Shutdown(context.Background())
		assert.NoError(tb, err)
	})
	return server, port
}

func normalizeJSON(tb testing.TB, data []byte) string {
	var v interface{}
	err := json.Unmarshal(data, &v)
	if err != nil {
		tb.Fatal(err)
	}
	require.NoError(tb, err)
	normalized, err := json.MarshalIndent(v, "", "  ")
	require.NoError(tb, err)
	return string(normalized)
}

func TestIntegration(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
	})
}

func TestPlayground(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeRequest(http.MethodGet, "/", http.Header{
			"Accept": []string{"text/html"},
		}, nil)
		require.NoError(t, err)
		defer res.Body.Close()
		require.Contains(t, res.Header.Get("Content-Type"), "text/html")
		body, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		require.Contains(t, string(body), `WunderGraph Playground`)
	})
}

func TestExecutionPlanCache(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res.Response.StatusCode)
		require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

		res2, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res2.Response.StatusCode)
		require.Equal(t, "HIT", res2.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res2.Body)

		res3, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `query Find($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res3.Response.StatusCode)
		require.Equal(t, "HIT", res3.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res3.Body)
	})
}

func TestVariables(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("correct validation", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)
		})

		t.Run("query with variables", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})

		t.Run("inline variables", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id:1) { id details { forename surname } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})

		t.Run("invalid number", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`1`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"variables value must not be a number"}],"data":null}`, res.Body)
		})

		t.Run("invalid string", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`"1"`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"variables value must not be a string"}],"data":null}`, res.Body)
		})

		t.Run("invalid boolean", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`true`),
			})
			require.NoError(t, err)
			assert.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			assert.Equal(t, `{"errors":[{"message":"variables value must not be a boolean"}],"data":null}`, res.Body)
		})

		t.Run("invalid array", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`[]`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"variables value must not be an array"}],"data":null}`, res.Body)
		})

		t.Run("missing", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}],"data":null}`, res.Body)
		})

		t.Run("wrong value variable", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" got invalid value 1; Expected type \"SearchInput\" to be an object."}],"data":null}`, res.Body)
		})
	})
}

func TestAnonymousQuery(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
	})
}

func TestTracing(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: bigEmployeesQuery,
			Header: http.Header{
				"X-WG-Trace": []string{"true", "enable_predictable_debug_timings"},
			},
		})
		require.NoError(t, err)
		assert.Equal(t, http.StatusOK, res.Response.StatusCode)
		tracingJsonBytes, err := os.ReadFile("testdata/tracing.json")
		require.NoError(t, err)
		// we generate a random port for the test server, so we need to replace the port in the tracing json
		rex, err := regexp.Compile(`http://127.0.0.1:\d+/graphql`)
		require.NoError(t, err)
		tracingJson := string(rex.ReplaceAll(tracingJsonBytes, []byte("http://localhost/graphql")))
		resultBody := rex.ReplaceAllString(res.Body, "http://localhost/graphql")
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
		res2, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: bigEmployeesQuery,
			Header: http.Header{
				"X-WG-Trace": []string{"true"},
			},
		})
		require.NoError(t, err)
		assert.Equal(t, http.StatusOK, res2.Response.StatusCode)
		body := []byte(res2.Body)
		data, _, _, err := jsonparser.Get(body, "data")
		require.NoError(t, err)
		assert.NotNilf(t, data, "data should not be nil: %s", body)
		tracing, _, _, err := jsonparser.Get(body, "extensions", "trace")
		require.NoError(t, err)
		assert.NotNilf(t, tracing, "tracing should not be nil: %s", body)
		assert.NotEqual(t, prettifyJSON(t, tracingJson), prettifyJSON(t, string(body)))
	})
}

func prettifyJSON(t *testing.T, jsonStr string) string {
	var v interface{}
	err := json.Unmarshal([]byte(jsonStr), &v)
	require.NoError(t, err)
	normalized, err := json.MarshalIndent(v, "", "  ")
	require.NoError(t, err)
	return string(normalized)
}

func TestOperationSelection(t *testing.T) {
	t.Parallel()

	t.Run("anonymous query", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("multiple anonymous queries", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } } { employees { id } }`,
			})
			assert.Equal(t, `{"errors":[{"message":"operation name is required when multiple operations are defined"}],"data":null}`, res.Body)
		})
	})

	t.Run("operation name null returns data", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `{ employees { id } }`,
				OperationName: []byte(`null`),
			})
			assert.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
		})
	})

	t.Run("operation name wrong on anonymous operation", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `{ employees { id } }`,
				OperationName: []byte(`"Missing"`),
			})
			assert.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}],"data":null}`, res.Body)
		})
	})

	t.Run("operation name wrong on named operation", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query Exists { employees { id } }`,
				OperationName: []byte(`"Missing"`),
			})
			assert.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}],"data":null}`, res.Body)
		})

		t.Run("multiple named operations", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query A { employees { id } } query B { employees { id details { forename surname } } }`,
					OperationName: []byte(`"A"`),
				})
				assert.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body)
			})
		})

		t.Run("multiple named operations B", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query A { employees { id } } query B { employees { id details { forename surname } } }`,
					OperationName: []byte(`"B"`),
				})
				assert.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":9,"details":{"forename":"Alberto","surname":"Garcia Hierro"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
			})
		})

		t.Run("multiple named operations B", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query A { employees { id } } query B { employees { id details { forename surname } } }`,
					OperationName: []byte(`"C"`),
				})
				assert.Equal(t, `{"errors":[{"message":"operation with name 'C' not found"}],"data":null}`, res.Body)
			})
		})
	})
}

func TestTestdataQueries(t *testing.T) {
	t.Parallel()
	queries := filepath.Join("testdata", "queries")
	entries, err := os.ReadDir(queries)
	require.NoError(t, err)
	for _, entry := range entries {
		if !entry.IsDir() {
			t.Fatalf("unexpected file in %s: %s", queries, entry.Name())
		}
		name := entry.Name()
		t.Run(name, func(t *testing.T) {
			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				testDir := filepath.Join(queries, name)
				queryData, err := os.ReadFile(filepath.Join(testDir, "query.graphql"))
				require.NoError(t, err)
				payload := map[string]any{
					"query": string(queryData),
				}
				payloadData, err := json.Marshal(payload)
				require.NoError(t, err)

				res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, bytes.NewReader(payloadData))
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.StatusCode)
				result, err := io.ReadAll(res.Body)
				require.NoError(t, err)
				expectedData, err := os.ReadFile(filepath.Join(testDir, "result.json"))
				require.NoError(t, err)

				expected := normalizeJSON(t, expectedData)
				actual := normalizeJSON(t, result)
				assert.Equal(t, expected, actual)
			})
		})
	}
}

func TestIntegrationWithUndefinedField(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id notDefined } }`,
		})
		assert.JSONEq(t, `{"errors":[{"message":"field: notDefined not defined on type: Employee","path":["query","employees","notDefined"]}],"data":null}`, res.Body)
	})
}

func TestParallel(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
		trigger := make(chan struct{})
		wg := sync.WaitGroup{}
		wg.Add(10)
		for i := 0; i < 10; i++ {
			go func() {
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				assert.JSONEq(t, expect, res.Body)
				wg.Done()
			}()
		}
		time.Sleep(10 * time.Millisecond)
		close(trigger)
		wg.Wait()
	})
}

func BenchmarkSequential(b *testing.B) {
	testenv.Bench(b, &testenv.Config{}, func(b *testing.B, xEnv *testenv.Environment) {
		expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
		b.SetBytes(int64(len(expect)))
		b.ReportAllocs()
		b.ResetTimer()
		for ii := 0; ii < b.N; ii++ {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query Employee ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				OperationName: []byte(`"Employee"`),
				Variables:     json.RawMessage(`{"n":1}`),
			})
			if res.Body != expect {
				b.Errorf("unexpected result %q, expecting %q", res.Body, expect)
			}
		}
	})
}

func BenchmarkParallel(b *testing.B) {
	testenv.Bench(b, &testenv.Config{}, func(b *testing.B, xEnv *testenv.Environment) {
		expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
		b.SetBytes(int64(len(expect)))
		b.ReportAllocs()
		b.ResetTimer()
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query Employee($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					OperationName: []byte(`"Employee"`),
					Variables:     json.RawMessage(`{"n":1}`),
				})
				if res.Body != expect {
					b.Errorf("unexpected result %q, expecting %q", res.Body, expect)
				}
			}
		})
	})
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
	testenv.Bench(b, &testenv.Config{}, func(b *testing.B, xEnv *testenv.Environment) {
		b.SetBytes(int64(len(bigEmployeesResponse)))
		b.ReportAllocs()
		b.ResetTimer()
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: bigEmployeesQuery,
				})
				if len(res.Body) < 3000 {
					b.Errorf("unexpected result %q, expecting \n\n%q", res.Body, bigEmployeesResponse)
				}
			}
		})
	})
}

func FuzzQuery(f *testing.F) {
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
		{
			Query: `($team:Department!= MARKETING) {
				te		  ites(team:$team) {
		am_mad
				}
			  }`,
			Variables: []byte("{\"team\":\"MARK"),
		},
		{
			Query:     `{te&m_mates}`,
			Variables: []byte("\xc9\xc9\xc9\xc9\xc9\xc9\xc9\xc9{}"),
		},
	}
	for _, tc := range corpus {
		f.Add(tc.Query, tc.Variables)
	}
	f.Fuzz(func(t *testing.T, query string, variables []byte) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var q testQuery
			if err := json.Unmarshal(variables, &q.Variables); err != nil {
				// Invalid JSON, mark as uninteresting input
				t.Skip()
			}
			q.Body = query

			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     query,
				Variables: variables,
			})
			require.NoError(t, err)
			if res.Response.StatusCode != http.StatusOK && res.Response.StatusCode != http.StatusBadRequest {
				t.Error("unexpected status code", res.Response.StatusCode)
			}
		})
	})
}

func TestPlannerErrorMessage(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		// Error message should contain the invalid argument name instead of a
		// generic planning error message
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{  employee(id:3, does_not_exist: 42) { id } }`,
		})
		var resp testenv.GraphQLResponse
		if err := json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		require.Len(t, resp.Errors, 1)
		assert.Equal(t, `Unknown argument "does_not_exist" on field "Query.employee".`, resp.Errors[0].Message)
	})
}

func TestConcurrentQueriesWithDelay(t *testing.T) {
	const (
		numQueries   = 20
		queryDelayMs = 100
	)
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalMiddleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					time.Sleep(time.Millisecond * queryDelayMs)
					handler.ServeHTTP(w, r)
				})
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var wg sync.WaitGroup
		wg.Add(numQueries)
		for ii := 0; ii < numQueries; ii++ {
			go func(ii int) {
				defer wg.Done()
				resp := strconv.FormatInt(rand.Int63(), 10)
				// For this test, we don't need any delays on the server side
				query := fmt.Sprintf(`{ delay(response:"%s", ms:%d) }`, resp, queryDelayMs)
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: query,
				})
				assert.JSONEq(t, fmt.Sprintf(`{"data":{"delay":"%s"}}`, resp), res.Body, "query %d failed", ii)
			}(ii)
		}
		wg.Wait()
	})
}

func TestPartialOriginErrors(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				CloseOnStart: true,
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at path 'query.employees.@'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":9,"details":{"forename":"Alberto","surname":"Garcia Hierro"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginErrors500(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusInternalServerError)
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at path 'query.employees.@'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":9,"details":{"forename":"Alberto","surname":"Garcia Hierro"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestWithOriginErrors(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				CloseOnStart: true,
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0' at path 'query'."}],"data":null}`, res.Body)
	})
}

func TestWithOriginErrors500(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusInternalServerError)
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		assert.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0' at path 'query'."}],"data":null}`, res.Body)
	})
}
