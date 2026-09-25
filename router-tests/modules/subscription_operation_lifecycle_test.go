package module_test

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

type subscriptionLifecycleRecorder struct {
	mu     sync.Mutex
	starts map[string]subscriptionLifecycleDetails
	ends   map[string]subscriptionLifecycleDetails
}

type subscriptionLifecycleDetails struct {
	rootFieldName string
	operationName string
	clientName    string
}

func (r *subscriptionLifecycleRecorder) counts() (starts, ends int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.starts), len(r.ends)
}

type subscriptionLifecycleModule struct {
	recorder *subscriptionLifecycleRecorder
}

func (m *subscriptionLifecycleModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "subscriptionLifecycleTest",
		Priority: 1,
		New: func() core.Module {
			return &subscriptionLifecycleModule{recorder: m.recorder}
		},
	}
}

func (m *subscriptionLifecycleModule) OnSubscriptionOperationStart(ctx core.GraphQLSubscriptionHookContext) error {
	m.recorder.mu.Lock()
	defer m.recorder.mu.Unlock()
	m.recorder.starts[ctx.SubscriptionInstanceID()] = subscriptionLifecycleDetails{
		rootFieldName: ctx.RootFieldName(),
		operationName: ctx.Operation().Name(),
		clientName:    ctx.Operation().ClientInfo().Name,
	}
	return nil
}

func (m *subscriptionLifecycleModule) OnSubscriptionOperationEnd(ctx core.GraphQLSubscriptionHookContext) {
	m.recorder.mu.Lock()
	defer m.recorder.mu.Unlock()
	m.recorder.ends[ctx.SubscriptionInstanceID()] = subscriptionLifecycleDetails{
		rootFieldName: ctx.RootFieldName(),
		operationName: ctx.Operation().Name(),
		clientName:    ctx.Operation().ClientInfo().Name,
	}
}

func TestSubscriptionOperationLifecycleIsPerSubscriberOnOneWebSocket(t *testing.T) {
	recorder := &subscriptionLifecycleRecorder{
		starts: make(map[string]subscriptionLifecycleDetails),
		ends:   make(map[string]subscriptionLifecycleDetails),
	}
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithCustomModules(&subscriptionLifecycleModule{recorder: recorder}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		conn := xEnv.InitGraphQLWebSocketConnection(http.Header{
			"GraphQL-Client-Name": []string{"lifecycle-test"},
		}, nil, nil)
		query := []byte(`{"query":"subscription watch { currentTime { unixTime timeStamp } }"}`)
		for _, id := range []string{"first", "second"} {
			require.NoError(t, conn.WriteJSON(&testenv.WebSocketMessage{ID: id, Type: "subscribe", Payload: query}))
		}
		xEnv.WaitForSubscriptionCount(2, 10*time.Second)
		require.Eventually(t, func() bool {
			starts, ends := recorder.counts()
			return starts == 2 && ends == 0
		}, 10*time.Second, 20*time.Millisecond)

		require.NoError(t, conn.WriteJSON(&testenv.WebSocketMessage{ID: "first", Type: "complete"}))
		require.Eventually(t, func() bool {
			starts, ends := recorder.counts()
			return starts == 2 && ends == 1
		}, 10*time.Second, 20*time.Millisecond)

		require.NoError(t, conn.Close())
		require.Eventually(t, func() bool {
			_, ends := recorder.counts()
			return ends == 2
		}, 10*time.Second, 20*time.Millisecond)

		recorder.mu.Lock()
		defer recorder.mu.Unlock()
		require.Len(t, recorder.starts, 2)
		for instanceID, details := range recorder.starts {
			require.NotEmpty(t, instanceID)
			require.Equal(t, subscriptionLifecycleDetails{
				rootFieldName: "currentTime",
				operationName: "watch",
				clientName:    "lifecycle-test",
			}, details)
			require.Equal(t, details, recorder.ends[instanceID])
		}
	})
}

func TestSubscriptionOperationLifecycleIsPerSSESubscriber(t *testing.T) {
	recorder := &subscriptionLifecycleRecorder{
		starts: make(map[string]subscriptionLifecycleDetails),
		ends:   make(map[string]subscriptionLifecycleDetails),
	}
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithCustomModules(&subscriptionLifecycleModule{recorder: recorder}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		const query = `{"query":"subscription watch { tick: currentTime { unixTime timeStamp } }"}`
		client := &http.Client{}
		open := func() (*http.Response, context.CancelFunc) {
			requestCtx, cancel := context.WithCancel(t.Context())
			request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, xEnv.GraphQLRequestURL(), strings.NewReader(query))
			require.NoError(t, err)
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Accept", "text/event-stream")
			request.Header.Set("GraphQL-Client-Name", "sse-lifecycle-test")
			response, err := client.Do(request)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, response.StatusCode)
			require.Equal(t, "text/event-stream", response.Header.Get("Content-Type"))
			return response, cancel
		}

		first, cancelFirst := open()
		defer first.Body.Close()
		defer cancelFirst()
		second, cancelSecond := open()
		defer second.Body.Close()
		defer cancelSecond()
		xEnv.WaitForSubscriptionCount(2, 10*time.Second)
		require.Eventually(t, func() bool {
			starts, ends := recorder.counts()
			return starts == 2 && ends == 0
		}, 10*time.Second, 20*time.Millisecond)

		cancelFirst()
		require.NoError(t, first.Body.Close())
		xEnv.WaitForSubscriptionCount(1, 10*time.Second)
		require.Eventually(t, func() bool {
			starts, ends := recorder.counts()
			return starts == 2 && ends == 1
		}, 10*time.Second, 20*time.Millisecond)

		cancelSecond()
		require.NoError(t, second.Body.Close())
		xEnv.WaitForSubscriptionCount(0, 10*time.Second)
		require.Eventually(t, func() bool {
			_, ends := recorder.counts()
			return ends == 2
		}, 10*time.Second, 20*time.Millisecond)

		recorder.mu.Lock()
		defer recorder.mu.Unlock()
		require.Len(t, recorder.starts, 2)
		for instanceID, details := range recorder.starts {
			require.NotEmpty(t, instanceID)
			require.Equal(t, subscriptionLifecycleDetails{
				rootFieldName: "currentTime", // schema name, not the "tick" alias
				operationName: "watch",
				clientName:    "sse-lifecycle-test",
			}, details)
			require.Equal(t, details, recorder.ends[instanceID])
		}
	})
}
