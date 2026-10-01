package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
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

	const query = `query Get($show: Boolean!) { employee(id: 1) { id @include(if: $show) } }`
	const mobileQuery = `query Get($other: Boolean!) { employee(id: 2) { id @include(if: $other) } }`
	queries := map[string]string{
		"web":    query,
		"mobile": mobileQuery,
	}
	// Lowercase 64-hex IDs must be the SHA256 of their body; uppercase ones are custom IDs.
	ids := []string{"get_employee_v1", strings.Repeat("A", 64)}
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, path, _ := strings.Cut(r.URL.Path, "/operations/")
		client, id, _ := strings.Cut(path, "/")
		id = strings.TrimSuffix(id, ".json")
		body, ok := queries[client]
		if !ok || !slices.Contains(ids, id) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		assert.NoError(t, json.NewEncoder(w).Encode(map[string]any{"version": 1, "body": body}))
	}))
	defer cdn.Close()
	testenv.Run(t, &testenv.Config{
		CdnSever: cdn,
		AccessLogFields: []config.CustomAttribute{
			{Key: "operation_id", ValueFrom: &config.CustomDynamicAttribute{ContextField: core.ContextFieldOperationSha256}},
		},
		LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
		RouterOptions:  []core.Option{core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{LogUnknown: true})},
	}, func(t *testing.T, e *testenv.Environment) {
		request := func(id, client, body, variables string) *testenv.TestResponse {
			res, err := e.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:      body,
				Variables:  json.RawMessage(variables),
				Header:     http.Header{"Graphql-Client-Name": {client}},
				Extensions: []byte(fmt.Sprintf(`{"persistedQuery":{"version":1,"sha256Hash":%q}}`, id)),
			})
			if !assert.NoError(t, err) {
				return &testenv.TestResponse{Response: &http.Response{}}
			}
			return res
		}
		for _, id := range ids {
			// A supplied body neither replaces the published operation nor has to hash to its ID.
			res := request(id, "web", `query { __typename }`, `{"show":true}`)
			require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			logs := e.Observer().FilterMessage("/graphql").All()
			require.Equal(t, id, logs[len(logs)-1].ContextMap()["operation_id"])
			require.Eventually(t, func() bool {
				res = request(id, "web", "", `{"show":true}`)
				return res.Response.Header.Get(core.PersistedOperationCacheHeader) == "HIT"
			}, time.Second*5, time.Millisecond*10)
			require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			logs = e.Observer().FilterMessage("/graphql").All()
			require.Equal(t, id, logs[len(logs)-1].ContextMap()["operation_id"])
		}
		// Different clients may use the same ID with different conditional variables.
		require.Eventually(t, func() bool {
			res := request(ids[0], "mobile", "", `{"other":true}`)
			assert.JSONEq(t, `{"data":{"employee":{"id":2}}}`, res.Body)
			return res.Response.Header.Get(core.PersistedOperationCacheHeader) == "HIT"
		}, time.Second*5, time.Millisecond*10)
		require.JSONEq(t, `{"data":{"employee":{}}}`, request(ids[0], "web", "", `{"show":false,"other":true}`).Body)
		for _, id := range []string{"missing", "GET_EMPLOYEE_V1"} {
			require.Contains(t, request(id, "web", query, `{"show":true}`).Body, "PersistedQueryNotFound")
			require.Contains(t, request(id, "web", "", `{"show":true}`).Body, "PersistedQueryNotFound")
		}

		conn := e.InitGraphQLWebSocketConnection(http.Header{"Graphql-Client-Name": {"web"}}, nil, nil)
		defer conn.Close()
		require.NoError(t, testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{ID: "1", Type: "subscribe", Payload: []byte(`{"query":"query { __typename }","variables":{"show":true},"extensions":{"persistedQuery":{"version":1,"sha256Hash":"get_employee_v1"}}}`)}))
		var msg testenv.WebSocketMessage
		require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
		require.Equal(t, "next", msg.Type)
		require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, string(msg.Payload))
	})
}

func TestCustomOperationIDManifestWarmup(t *testing.T) {
	t.Parallel()

	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.True(t, strings.HasSuffix(r.URL.Path, "/operations/manifest.json"))
		_, _ = w.Write([]byte(`{"version":1,"revision":"one","operations":{"get_employee_v1":"query Get { employee(id: 1) { id } }"}}`))
	}))
	defer cdn.Close()
	testenv.Run(t, &testenv.Config{CdnSever: cdn, RouterOptions: []core.Option{
		core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{Manifest: config.PQLManifestConfig{
			Enabled: true, Warmup: config.PQLManifestWarmupConfig{Enabled: true, Workers: 1, Timeout: 5 * time.Second},
		}}),
	}}, func(t *testing.T, e *testenv.Environment) {
		res := e.MakeGraphQLRequestOK(testenv.GraphQLRequest{Extensions: []byte(`{"persistedQuery":{"version":1,"sha256Hash":"get_employee_v1"}}`)})
		require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.PersistedOperationCacheHeader))
	})
}

func TestCustomOperationIDManifestReload(t *testing.T) {
	t.Parallel()

	const operationID = "employee_v1"
	var manifest atomic.Value
	setManifest := func(revision, query string) {
		operations := map[string]string{}
		if query != "" {
			operations[operationID] = query
		}
		body, err := json.Marshal(map[string]any{
			"version":    1,
			"revision":   revision,
			"operations": operations,
		})
		require.NoError(t, err)
		manifest.Store(body)
	}
	setManifest("one", "query { employee(id: 1) { id } }")
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.True(t, strings.HasSuffix(r.URL.Path, "/operations/manifest.json"))
		_, _ = w.Write(manifest.Load().([]byte))
	}))
	defer cdn.Close()

	testenv.Run(t, &testenv.Config{
		CdnSever: cdn,
		RouterOptions: []core.Option{
			core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
				Manifest: config.PQLManifestConfig{
					Enabled:      true,
					PollInterval: 100 * time.Millisecond,
					PollJitter:   5 * time.Millisecond,
				},
			}),
		},
	}, func(t *testing.T, e *testenv.Environment) {
		request := testenv.GraphQLRequest{
			Extensions: []byte(fmt.Sprintf(`{"persistedQuery":{"version":1,"sha256Hash":%q}}`, operationID)),
		}
		waitForCachedBody := func(expected string) {
			t.Helper()
			require.Eventually(t, func() bool {
				res, err := e.MakeGraphQLRequest(request)
				return err == nil && res.Body == expected &&
					res.Response.Header.Get(core.PersistedOperationCacheHeader) == "HIT"
			}, 5*time.Second, 10*time.Millisecond)
		}
		waitForCachedBody(`{"data":{"employee":{"id":1}}}`)

		// Replacing a custom ID must supersede the cached body from the old revision.
		setManifest("two", "query { employee(id: 2) { id } }")
		waitForCachedBody(`{"data":{"employee":{"id":2}}}`)

		// Removing the ID must reject requests despite both cached revisions.
		setManifest("three", "")
		const notFound = `{"errors":[{"message":"PersistedQueryNotFound",` +
			`"extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`
		require.Eventually(t, func() bool {
			res, err := e.MakeGraphQLRequest(request)
			return err == nil && res.Body == notFound
		}, 5*time.Second, 10*time.Millisecond)
	})
}
