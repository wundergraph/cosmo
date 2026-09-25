package integration

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	sum := sha256.Sum256([]byte(query))
	bodyHash := hex.EncodeToString(sum[:])
	customHexID := strings.Repeat("a", 64)
	subscriptionID := strings.Repeat("b", 64)
	operations := map[string]string{
		"get_employee_v1": query,
		customHexID:       query,
		bodyHash:          query,
		subscriptionID:    `subscription { currentTime { unixTime } }`,
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
		CdnSever: cdn,
		AccessLogFields: []config.CustomAttribute{
			{Key: "body_hash", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldOperationSha256}},
			{Key: "persisted_id", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldPersistedOperationSha256}},
			{Key: "persisted_hit", ValueFrom: &config.CustomDynamicAttribute{Expression: "request.operation.persistedOperationCacheHit"}},
		},
		LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
	}, func(t *testing.T, e *testenv.Environment) {
		ids := []string{"get_employee_v1", customHexID}
		for _, id := range ids {
			e.Observer().TakeAll()
			assert.JSONEq(t, expected, customOperationIDRequest(t, e, id, false).Body)
			// Cache admission is asynchronous. Exercise GET while waiting for a confirmed hit.
			require.Eventually(t, func() bool {
				assert.JSONEq(t, expected, customOperationIDRequest(t, e, id, true).Body)
				logs := e.Observer().FilterMessage("/graphql").All()
				return len(logs) >= 2 && logs[len(logs)-1].ContextMap()["persisted_hit"] == true
			}, 5*time.Second, 10*time.Millisecond)
			for _, entry := range e.Observer().FilterMessage("/graphql").All() {
				fields := entry.ContextMap()
				assert.Equal(t, id, fields["persisted_id"])
				assert.Equal(t, bodyHash, fields["body_hash"])
			}
		}
		cases := []struct {
			id     string
			status int
		}{
			{id: bodyHash, status: http.StatusOK},
			{id: customHexID, status: http.StatusBadRequest},
		}
		for _, tc := range cases {
			response, err := e.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:      query,
				Header:     http.Header{"Graphql-Client-Name": []string{"web"}},
				Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + tc.id + `"}}`),
			})
			require.NoError(t, err)
			assert.Equal(t, tc.status, response.Response.StatusCode)
			if tc.status == http.StatusOK {
				assert.JSONEq(t, expected, response.Body)
			} else {
				assert.Contains(t, response.Body, "persistedQuery sha256 hash does not match query body")
			}
		}
		assert.Contains(t, customOperationIDRequest(t, e, "missing", false).Body, "PersistedQueryNotFound")

		conn := e.InitGraphQLWebSocketConnection(http.Header{"Graphql-Client-Name": []string{"web"}}, nil, nil)
		defer conn.Close()
		require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{ID: "1", Type: "subscribe", Payload: []byte(`{"extensions":{"persistedQuery":{"version":1,"sha256Hash":"` + subscriptionID + `"}}}`)}))
		var msg testenv.WebSocketMessage
		require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
		assert.Equal(t, "next", msg.Type)
		assert.Contains(t, string(msg.Payload), "unixTime")
	})
}

func TestCustomOperationIDsWarmup(t *testing.T) {
	t.Parallel()

	const query = `query Get { employee(id: 1) { id } }`
	sum := sha256.Sum256([]byte(query))
	bodyHash := hex.EncodeToString(sum[:])
	ids := []string{"get_employee_v1", strings.Repeat("a", 64), bodyHash}
	var operations []map[string]any
	for _, id := range ids {
		copiedBody := `query Get { employee(id: 2) { id } }`
		if id == bodyHash {
			copiedBody = query
		}
		operations = append(operations, map[string]any{
			"client": map[string]string{"name": "web"},
			"request": map[string]any{
				"query":      copiedBody,
				"extensions": map[string]any{"persistedQuery": map[string]any{"version": 1, "sha256Hash": id}},
			},
		})
	}
	var fetches atomic.Int32
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/cache_warmup/operations.json") {
			assert.NoError(t, json.NewEncoder(w).Encode(map[string]any{"operations": operations}))
			return
		}
		fetches.Add(1)
		assert.NoError(t, json.NewEncoder(w).Encode(map[string]any{"version": 1, "body": query}))
	}))
	defer cdn.Close()
	testenv.Run(t, &testenv.Config{CdnSever: cdn, RouterOptions: []core.Option{
		core.WithCacheWarmupConfig(&config.CacheWarmupConfiguration{
			Enabled: true,
			Workers: 1,
			Timeout: 5 * time.Second,
			Source:  config.CacheWarmupSource{CdnSource: config.CacheWarmupCDNSource{Enabled: true}},
		}),
	}}, func(t *testing.T, e *testenv.Environment) {
		for _, id := range ids {
			response := customOperationIDRequest(t, e, id, false)
			assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, response.Body)
			assert.Equal(t, "HIT", response.Response.Header.Get(core.PersistedOperationCacheHeader))
		}
		// Only the two custom IDs need fetching; the matching SHA256 body is retained.
		assert.Equal(t, int32(2), fetches.Load())
	})
}

func TestCustomOperationIDsManifest(t *testing.T) {
	t.Parallel()

	id := strings.Repeat("a", 64)
	var current atomic.Value
	current.Store(`{"version":1,"revision":"one","operations":{"` + id + `":"query Get { employee(id: 1) { id } }"}}`)
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
		core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{Manifest: config.PQLManifestConfig{
			Enabled: true, PollInterval: 50 * time.Millisecond, PollJitter: time.Millisecond,
			Warmup: config.PQLManifestWarmupConfig{Enabled: true, Workers: 1, Timeout: 5 * time.Second},
		}}),
	}}, func(t *testing.T, e *testenv.Environment) {
		response := customOperationIDRequest(t, e, id, false)
		assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, response.Body)
		assert.Equal(t, "HIT", response.Response.Header.Get(core.PersistedOperationCacheHeader))

		current.Store(`{"version":1,"revision":"two","operations":{}}`)
		require.Eventually(t, func() bool {
			return strings.Contains(customOperationIDRequest(t, e, id, false).Body, "PersistedQueryNotFound")
		}, 5*time.Second, 20*time.Millisecond)
		current.Store(`{"version":1,"revision":"three","operations":{"` + id + `":"query Get { employee(id: 2) { id } }"}}`)
		assert.Eventually(t, func() bool {
			return customOperationIDRequest(t, e, id, false).Body == `{"data":{"employee":{"id":2}}}`
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
