package module_test

import (
	"net/http"
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
