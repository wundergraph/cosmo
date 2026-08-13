package events_test

import (
	"encoding/json"
	"math"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

var (
	_ core.Module                 = (*blockingHydrationModule)(nil)
	_ core.EnginePreOriginHandler = (*blockingHydrationModule)(nil)
)

// blockingHydrationModule simulates an origin hook or transport operation that does not
// honor request-context cancellation. It blocks exactly one employees hydration request.
type blockingHydrationModule struct {
	armed             *atomic.Bool
	started           chan struct{}
	release           chan struct{}
	startedOnce       *sync.Once
	honorCancellation bool
}

func (m *blockingHydrationModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "blockingHydrationModule",
		Priority: math.MaxInt32,
		New: func() core.Module {
			return &blockingHydrationModule{
				armed:             m.armed,
				started:           m.started,
				release:           m.release,
				startedOnce:       m.startedOnce,
				honorCancellation: m.honorCancellation,
			}
		},
	}
}

func (m *blockingHydrationModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	subgraph := ctx.ActiveSubgraph(req)
	if subgraph != nil && subgraph.Name == "employees" && m.armed.CompareAndSwap(true, false) {
		m.startedOnce.Do(func() { close(m.started) })
		if m.honorCancellation {
			select {
			case <-m.release:
			case <-req.Context().Done():
			}
		} else {
			<-m.release
		}
	}
	return req, nil
}

// TestKafkaSubscriptionContinuesWhenHydrationIgnoresCancellation verifies that
// one non-cooperative origin operation cannot stall the shared trigger. The
// timed-out event emits an inline error and a later Kafka event continues over
// the same WebSocket subscription.
func TestKafkaSubscriptionContinuesWhenHydrationIgnoresCancellation(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping Kafka integration test in short mode")
	}

	recovered, receivedError := runKafkaHydrationTimeoutScenario(t, "employeeUpdated-hydration-hang", false)
	require.True(t, receivedError, "expected the stuck event to emit an error over the subscription")
	require.True(t, recovered, "expected the shared trigger to dispatch the later Kafka event")
}

// TestKafkaSubscriptionContinuesAfterHydrationHonorsCancellation is the control
// case for the regression above. It proves that the request timeout already lets
// the same WebSocket subscription receive an inline error and then a later event
// when the blocked hydration operation returns on context cancellation.
func TestKafkaSubscriptionContinuesAfterHydrationHonorsCancellation(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping Kafka integration test in short mode")
	}

	recovered, receivedError := runKafkaHydrationTimeoutScenario(t, "employeeUpdated-hydration-canceled", true)
	require.True(t, receivedError, "expected the timed-out event to emit an error over the subscription")
	require.True(t, recovered, "expected the existing subscription to receive a later Kafka event")
}

func runKafkaHydrationTimeoutScenario(t *testing.T, topic string, honorCancellation bool) (recovered bool, receivedError bool) {
	t.Helper()

	armed := &atomic.Bool{}
	started := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })

	module := &blockingHydrationModule{
		armed:             armed,
		started:           started,
		release:           release,
		startedOnce:       &sync.Once{},
		honorCancellation: honorCancellation,
	}

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
		EnableKafka:              true,
		ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
			overrideKafkaTopicsForField(t, routerConfig, "employeeUpdatedMyKafka",
				[]string{"employeeUpdated", "employeeUpdatedTwo"}, topic)
		},
		RouterOptions: []core.Option{
			core.WithCustomModules(module),
			core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(config.TrafficShapingRules{
				All: config.GlobalSubgraphRequestRule{
					RequestTimeout: testutils.ToPtr(100 * time.Millisecond),
				},
			})),
			core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
		},
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.SubscriptionFetchTimeout = 100 * time.Millisecond
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topic)

		conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
		defer conn.Close()

		require.NoError(t, testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
			ID:      "1",
			Type:    "subscribe",
			Payload: []byte(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 3) { id details { forename surname } } }"}`),
		}))

		xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
		xEnv.WaitForTriggerCount(1, EventWaitTimeout)

		// Warm up the Kafka pipeline before arming the blocking hydration request.
		xEnv.KafkaPublishUntilReceived(topic,
			`{"__typename":"Employee","id":1,"update":{"name":"warmup"}}`, 1, EventWaitTimeout)

		var message testenv.WebSocketMessage
		require.NoError(t, testenv.WSReadJSON(t, conn, &message))
		require.Equal(t, "next", message.Type)

		armed.Store(true)
		events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topic,
			`{"__typename":"Employee","id":2,"update":{"name":"blocked"}}`)

		select {
		case <-started:
		case <-time.After(EventWaitTimeout):
			t.Fatal("timed out waiting for hydration request to block")
		}

		// This record is queued behind the stuck hydration on current main.
		events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topic,
			`{"__typename":"Employee","id":3,"update":{"name":"recovery"}}`)

		deadline := time.Now().Add(500 * time.Millisecond)
		require.NoError(t, conn.SetReadDeadline(deadline))

		for time.Now().Before(deadline) {
			message = testenv.WebSocketMessage{}
			if err := conn.ReadJSON(&message); err != nil {
				break
			}

			var payload struct {
				Data struct {
					Employee struct {
						ID int `json:"id"`
					} `json:"employeeUpdatedMyKafka"`
				} `json:"data"`
				Errors []json.RawMessage `json:"errors"`
			}
			if json.Unmarshal(message.Payload, &payload) != nil {
				continue
			}
			if len(payload.Errors) != 0 {
				receivedError = true
			}
			if payload.Data.Employee.ID == 3 {
				recovered = true
				break
			}
		}

		// Always release the intentionally stuck goroutine before an assertion can stop the test.
		releaseOnce.Do(func() { close(release) })
	})

	return recovered, receivedError
}
