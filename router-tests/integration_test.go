package module

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

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

	fmt.Println("RES", rr.Body.String())
	//assert.Equal(tb, 200, rr.Code)
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

	sg, err := subgraphs.New(&subgraphs.Config{
		Ports: subgraphs.Ports{
			Employees: 4001,
			Family:    4002,
			Hobbies:   4003,
			Products:  4004,
		},
	})
	require.Nil(tb, err)

	go func() {
		err := sg.ListenAndServe(ctx)
		if err != http.ErrServerClosed {
			require.Nil(tb, err)
		}
	}()
	tb.Cleanup(func() {
		assert.Nil(tb, sg.Shutdown(ctx))
	})

	logger := zap.New()

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithLogger(logger),
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

func BenchmarkIntegration(b *testing.B) {
	server := setupServer(b)
	q := &testQuery{
		Body:      "($n:Int!) { employee(id:$n) { id } }",
		Variables: map[string]interface{}{"n": 4},
	}
	data := q.Data()
	//res := sendData(b, server, data)
	b.ReportAllocs()
	b.ResetTimer()
	var wg sync.WaitGroup
	for ii := 0; ii < b.N; ii++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = sendData(b, server, data)
			//assert.Equal(b, res, result)
		}()
	}
}
