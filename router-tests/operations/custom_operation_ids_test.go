package integration

import (
	"crypto/sha256"
	"encoding/hex"
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

	const iterations = 3
	const first = `query Get($show: Boolean!) { employee(id: 1) @include(if: $show) { id } }`
	const second = `query Get($hide: Boolean!) { employee(id: 2) @skip(if: $hide) { id } }`
	operations := map[string]string{
		"web-client/shared": first,
		"ios-client/shared": second,
		"abc/def":           `{ employee(id: 1) { id } }`,
		"abcd/ef":           `{ employee(id: 2) { id } }`,
		"bc/a":              `{ employee(id: 1) { id } }`,
		"c/ab":              `{ employee(id: 2) { id } }`,
		"ws-client/time":    `subscription { currentTime { unixTime } }`,
	}
	var fetches atomic.Int32
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, key, ok := strings.Cut(r.URL.Path, "/operations/")
		body, found := operations[strings.TrimSuffix(key, ".json")]
		if !ok || !found {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fetches.Add(1)
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
		request := func(client, id, vars string, get bool) *testenv.TestResponse {
			req := testenv.GraphQLRequest{Header: http.Header{"Graphql-Client-Name": []string{client}}, Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + id + `"}}`), Variables: []byte(vars)}
			var res *testenv.TestResponse
			var err error
			if get {
				res, err = e.MakeGraphQLRequestOverGET(req)
			} else {
				res, err = e.MakeGraphQLRequest(req)
			}
			if !assert.NoError(t, err) {
				return &testenv.TestResponse{}
			}
			return res
		}
		cases := []struct{ client, vars, want string }{
			{"web-client", `{"show":true}`, `{"data":{"employee":{"id":1}}}`},
			{"ios-client", `{"hide":false}`, `{"data":{"employee":{"id":2}}}`},
			{"web-client", `{"show":false}`, `{"data":{}}`},
			{"ios-client", `{"hide":true}`, `{"data":{}}`},
		}
		for round := range iterations {
			for _, tc := range cases {
				assert.JSONEq(t, tc.want, request(tc.client, "shared", tc.vars, round == 1).Body)
			}
		}
		// Wait for asynchronous cache admission, then prove normalization hits retain the body hash.
		require.Eventually(t, func() bool {
			assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, request("web-client", "shared", `{"show":true}`, false).Body)
			logs := e.Observer().FilterMessage("/graphql").All()
			return len(logs) > 0 && logs[len(logs)-1].ContextMap()["persisted_hit"] == true
		}, 5*time.Second, 10*time.Millisecond)
		count := fetches.Load()
		for range iterations {
			assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, request("web-client", "shared", `{"show":true}`, false).Body)
		}
		assert.Equal(t, count, fetches.Load())
		for _, entry := range e.Observer().FilterMessage("/graphql").All() {
			fields := entry.ContextMap()
			assert.Equal(t, "shared", fields["persisted_id"])
			h1 := sha256.Sum256([]byte(first))
			h2 := sha256.Sum256([]byte(second))
			assert.Contains(t, []string{hex.EncodeToString(h1[:]), hex.EncodeToString(h2[:])}, fields["body_hash"])
		}
		for range iterations {
			assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, request("abc", "def", "{}", false).Body)
			assert.JSONEq(t, `{"data":{"employee":{"id":2}}}`, request("abcd", "ef", "{}", false).Body)
			assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, request("bc", "a", "{}", false).Body)
			assert.JSONEq(t, `{"data":{"employee":{"id":2}}}`, request("c", "ab", "{}", false).Body)
		}
		assert.Contains(t, request("other-client", "shared", "{}", false).Body, "PersistedQueryNotFound")
		assert.Contains(t, request("web-client", "missing", "{}", false).Body, "PersistedQueryNotFound")
		invalid, err := e.MakeGraphQLRequest(testenv.GraphQLRequest{
			Header:     http.Header{"Graphql-Client-Name": []string{"web-client"}},
			Query:      "{ __typename }",
			Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"shared"}}`),
		})
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, invalid.Response.StatusCode)
		assert.Contains(t, invalid.Body, "custom id cannot be combined with a query body")
		conn := e.InitGraphQLWebSocketConnection(http.Header{"Graphql-Client-Name": []string{"ws-client"}}, nil, nil)
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

	for _, warmup := range []bool{false, true} {
		t.Run(fmt.Sprintf("warmup=%t", warmup), func(t *testing.T) {
			t.Parallel()
			var current atomic.Value
			current.Store(`{"version":1,"revision":"one","operations":{"` + strings.Repeat("x", 250) + `":"query Get { employee(id: 1) { id } }"}}`)
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
					Warmup: config.PQLManifestWarmupConfig{Enabled: warmup, Workers: 1, Timeout: 5 * time.Second},
				}}),
			}, AccessLogFields: []config.CustomAttribute{
				{Key: "persisted_hit", ValueFrom: &config.CustomDynamicAttribute{Expression: "request.operation.persistedOperationCacheHit"}},
			}, LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel}}, func(t *testing.T, e *testenv.Environment) {
				request := func() string {
					res, err := e.MakeGraphQLRequest(testenv.GraphQLRequest{Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"` + strings.Repeat("x", 250) + `"}}`)})
					if !assert.NoError(t, err) {
						return ""
					}
					return res.Body
				}
				assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, request())
				require.Eventually(t, func() bool {
					assert.JSONEq(t, `{"data":{"employee":{"id":1}}}`, request())
					logs := e.Observer().FilterMessage("/graphql").All()
					return len(logs) > 0 && logs[len(logs)-1].ContextMap()["persisted_hit"] == true
				}, 5*time.Second, 10*time.Millisecond)
				// A cached body must never survive removal from the authoritative manifest.
				current.Store(`{"version":1,"revision":"two","operations":{}}`)
				require.Eventually(t, func() bool { return strings.Contains(request(), "PersistedQueryNotFound") }, 5*time.Second, 20*time.Millisecond)
				current.Store(`{"version":1,"revision":"three","operations":{"` + strings.Repeat("x", 250) + `":"query Get { employee(id: 2) { id } }"}}`)
				assert.Eventually(t, func() bool { return request() == `{"data":{"employee":{"id":2}}}` }, 5*time.Second, 20*time.Millisecond)
				assert.Zero(t, individual.Load())
			})
		})
	}
}
