package integration

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
)

func TestCustomOperationIDs(t *testing.T) {
	t.Parallel()

	const query = `query Get { employee(id: 1) { id } }`
	const expected = `{"data":{"employee":{"id":1}}}`
	operations := map[string]string{
		"get_employee_v1": query,
		"time":            `subscription { currentTime { unixTime } }`,
	}
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, id, _ := strings.Cut(r.URL.Path, "/operations/web/")
		body, found := operations[strings.TrimSuffix(id, ".json")]
		if !found {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		assert.NoError(t, json.NewEncoder(w).Encode(map[string]any{"version": 1, "body": body}))
	}))
	defer cdn.Close()
	testenv.Run(t, &testenv.Config{
		CdnSever:      cdn,
		RouterOptions: []core.Option{core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{AllowCustomIDs: true})},
		AccessLogFields: []config.CustomAttribute{
			{Key: "body_hash", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldOperationSha256}},
			{Key: "persisted_id", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldPersistedOperationSha256}},
			{Key: "persisted_hit", ValueFrom: &config.CustomDynamicAttribute{Expression: "request.operation.persistedOperationCacheHit"}},
		},
		LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
	}, func(t *testing.T, e *testenv.Environment) {
		assert.JSONEq(t, expected, customOperationIDRequest(t, e, "get_employee_v1", false).Body)
		// Cache admission is asynchronous. Exercise GET while waiting for a confirmed hit.
		require.Eventually(t, func() bool {
			assert.JSONEq(t, expected, customOperationIDRequest(t, e, "get_employee_v1", true).Body)
			logs := e.Observer().FilterMessage("/graphql").All()
			return len(logs) >= 2 && logs[len(logs)-1].ContextMap()["persisted_hit"] == true
		}, 5*time.Second, 10*time.Millisecond)
		for _, entry := range e.Observer().FilterMessage("/graphql").All() {
			fields := entry.ContextMap()
			assert.Equal(t, "get_employee_v1", fields["persisted_id"])
			assert.Equal(t, fmt.Sprintf("%x", sha256.Sum256([]byte(query))), fields["body_hash"])
		}
		assert.Contains(t, customOperationIDRequest(t, e, "missing", false).Body, "PersistedQueryNotFound")

		conn := e.InitGraphQLWebSocketConnection(http.Header{"Graphql-Client-Name": []string{"web"}}, nil, nil)
		defer conn.Close()
		require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{ID: "1", Type: "subscribe", Payload: []byte(`{"extensions":{"persistedQuery":{"version":1,"sha256Hash":"time"}}}`)}))
		var msg testenv.WebSocketMessage
		require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
		assert.Equal(t, "next", msg.Type)
		assert.Contains(t, string(msg.Payload), "unixTime")
	})
}

func TestCustomOperationIDsManifest(t *testing.T) {
	t.Parallel()

	var current atomic.Value
	current.Store(`{"version":1,"revision":"one","operations":{"get_employee_v1":"query Get { employee(id: 1) { id } }"}}`)
	var individual atomic.Int32
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/operations/manifest.json") {
			_, _ = w.Write([]byte(current.Load().(string)))
			return
		}
		individual.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer cdn.Close()
	testenv.Run(t, &testenv.Config{CdnSever: cdn, RouterOptions: []core.Option{
		core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{AllowCustomIDs: true, Manifest: config.PQLManifestConfig{
			Enabled: true, PollInterval: 50 * time.Millisecond, PollJitter: time.Millisecond,
			Warmup: config.PQLManifestWarmupConfig{Enabled: true, Workers: 1, Timeout: 5 * time.Second},
		}}),
	}}, func(t *testing.T, e *testenv.Environment) {
		response := customOperationIDRequest(t, e, "get_employee_v1", false)
		assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, response.Body)
		assert.Equal(t, "HIT", response.Response.Header.Get(core.PersistedOperationCacheHeader))

		current.Store(`{"version":1,"revision":"two","operations":{}}`)
		require.Eventually(t, func() bool {
			return strings.Contains(customOperationIDRequest(t, e, "get_employee_v1", false).Body, "PersistedQueryNotFound")
		}, 5*time.Second, 20*time.Millisecond)
		current.Store(`{"version":1,"revision":"three","operations":{"get_employee_v1":"query Get { employee(id: 2) { id } }"}}`)
		assert.Eventually(t, func() bool {
			return customOperationIDRequest(t, e, "get_employee_v1", false).Body == `{"data":{"employee":{"id":2}}}`
		}, 5*time.Second, 20*time.Millisecond)
		assert.Zero(t, individual.Load())
	})
}

func customOperationIDRequest(t *testing.T, e *testenv.Environment, id string, get bool) *testenv.TestResponse {
	t.Helper()

	req := testenv.GraphQLRequest{
		Header:     http.Header{"Graphql-Client-Name": []string{"web"}},
		Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + id + `"}}`),
	}
	var response *testenv.TestResponse
	var err error
	if get {
		response, err = e.MakeGraphQLRequestOverGET(req)
	} else {
		response, err = e.MakeGraphQLRequest(req)
	}
	// This helper also runs inside polling callbacks; do not call FailNow here.
	if !assert.NoError(t, err) {
		return &testenv.TestResponse{Response: &http.Response{}}
	}
	return response
}
