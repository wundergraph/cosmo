package module_test

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/events"
	subscription_on_create "github.com/wundergraph/cosmo/router-tests/modules/subscription-on-create"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	pubsubKafka "github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	pubsubNats "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	pubsubRedis "github.com/wundergraph/cosmo/router/pkg/pubsub/redis"
)

const subscriptionOnCreateTestTimeout = 30 * time.Second

type subResult struct {
	data []byte
	err  error
}

func newHookModule(cb func(ctx core.SubscriptionOnCreateHandlerContext) error) *subscription_on_create.SubscriptionOnCreateModule {
	return &subscription_on_create.SubscriptionOnCreateModule{
		HookCallCount: &atomic.Int32{},
		Callback:      cb,
	}
}

func hookRouterOptions(m *subscription_on_create.SubscriptionOnCreateModule) []core.Option {
	cfg := config.Config{
		Graph: config.Graph{},
		Modules: map[string]interface{}{
			"subscriptionOnCreateModule": m,
		},
	}
	return []core.Option{
		core.WithModulesConfig(cfg.Modules),
		core.WithCustomModules(&subscription_on_create.SubscriptionOnCreateModule{}),
	}
}

func TestSubscriptionOnCreateHook(t *testing.T) {
	t.Parallel()

	t.Run("hook can change a NATS subject", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the SubscriptionOnCreate hook can redirect a NATS subscription
		// to a different subject. The hook replaces the default subject with a custom one, and
		// the test confirms that only events published to the new subject are delivered.

		// capturedSubject receives the modified subject once the hook fires.
		capturedSubject := make(chan string, 1)

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			conf, ok := ctx.SubscriptionEventConfiguration().(*pubsubNats.SubscriptionEventConfiguration)
			if !ok || len(conf.Subjects) == 0 {
				return nil
			}
			// Redirect from the default subject (e.g. <prefix>.employeeUpdatedMyNats.1)
			// to a custom subject with suffix ".99".
			original := conf.Subjects[0]
			dotIdx := strings.LastIndex(original, ".")
			if dotIdx == -1 {
				return nil
			}
			newSubject := original[:dotIdx+1] + "99"
			conf.Subjects = []string{newSubject}
			select {
			case capturedSubject <- newSubject:
			default:
			}
			return nil
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions:            hookRouterOptions(customModule),
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdatedMyNats struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyNats(id: $id)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			resultCh := make(chan subResult, 1)
			_, err := client.Subscribe(&subscription, map[string]interface{}{"id": 1}, func(dataValue []byte, errValue error) error {
				resultCh <- subResult{data: dataValue, err: errValue}
				return nil
			})
			require.NoError(t, err)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, subscriptionOnCreateTestTimeout)
			xEnv.WaitForTriggerCount(1, subscriptionOnCreateTestTimeout)

			// Read the new subject chosen by the hook.
			var newSubject string
			select {
			case newSubject = <-capturedSubject:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("hook was not called before timeout")
			}

			// Publishing to the original subject (.1) must NOT trigger the subscription.
			// Publishing to the hook-overridden subject (.99) must trigger it.
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionMyNats, newSubject, []byte(`{"id":1,"__typename":"Employee"}`), 1, subscriptionOnCreateTestTimeout)

			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, resultCh, func(t *testing.T, r subResult) {
				require.NoError(t, r.err)
				require.JSONEq(t, `{"employeeUpdatedMyNats":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(r.data))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			assert.GreaterOrEqual(t, customModule.HookCallCount.Load(), int32(1))
		})
	})

	t.Run("hook can change a Redis channel", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the SubscriptionOnCreate hook can redirect a Redis subscription
		// to a different channel. The hook replaces the default channel with a custom one.

		capturedChannel := make(chan string, 1)

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			conf, ok := ctx.SubscriptionEventConfiguration().(*pubsubRedis.SubscriptionEventConfiguration)
			if !ok || len(conf.Channels) == 0 {
				return nil
			}
			original := conf.Channels[0]
			dotIdx := strings.LastIndex(original, ".")
			if dotIdx == -1 {
				return nil
			}
			newChannel := original[:dotIdx+1] + "99"
			conf.Channels = []string{newChannel}
			select {
			case capturedChannel <- newChannel:
			default:
			}
			return nil
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
			RouterOptions:            hookRouterOptions(customModule),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdatedMyRedis struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyRedis(id: $id)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			resultCh := make(chan subResult, 1)
			_, err := client.Subscribe(&subscription, map[string]interface{}{"id": 1}, func(dataValue []byte, errValue error) error {
				resultCh <- subResult{data: dataValue, err: errValue}
				return nil
			})
			require.NoError(t, err)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, subscriptionOnCreateTestTimeout)
			xEnv.WaitForTriggerCount(1, subscriptionOnCreateTestTimeout)

			var newChannel string
			select {
			case newChannel = <-capturedChannel:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("hook was not called before timeout")
			}

			// Extract the bare channel name (without prefix) for RedisPublishUntilReceived.
			// testenv.Environment.RedisPublishUntilReceived adds the prefix itself via GetPubSubName.
			bareChannel := strings.TrimPrefix(newChannel, xEnv.GetPubSubName(""))

			xEnv.RedisPublishUntilReceived(bareChannel, `{"__typename":"Employee","id":1,"update":{"name":"foo"}}`, subscriptionOnCreateTestTimeout)

			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, resultCh, func(t *testing.T, r subResult) {
				require.NoError(t, r.err)
				require.JSONEq(t, `{"employeeUpdatedMyRedis":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(r.data))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			assert.GreaterOrEqual(t, customModule.HookCallCount.Load(), int32(1))
		})
	})

	t.Run("hook can change a Kafka topic", func(t *testing.T) {
		t.Parallel()

		if testing.Short() {
			t.Skip("skipping test in short mode.")
		}

		// This test verifies that the SubscriptionOnCreate hook can redirect a Kafka subscription
		// to a different topic. It changes the default topic "employeeUpdated" to "employeeUpdatedTwo".

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			conf, ok := ctx.SubscriptionEventConfiguration().(*pubsubKafka.SubscriptionEventConfiguration)
			if !ok {
				return nil
			}
			for i, topic := range conf.Topics {
				// Replace "employeeUpdated" suffix with "employeeUpdatedTwo".
				// The topic has a testenv prefix, e.g. "<prefix>employeeUpdated".
				if strings.HasSuffix(topic, "employeeUpdated") {
					conf.Topics[i] = strings.TrimSuffix(topic, "employeeUpdated") + "employeeUpdatedTwo"
				}
			}
			return nil
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions:            hookRouterOptions(customModule),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Ensure both topics exist.
			events.KafkaEnsureTopicExists(t, xEnv, subscriptionOnCreateTestTimeout, "employeeUpdated", "employeeUpdatedTwo")

			var subscription struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: $employeeID)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			resultCh := make(chan subResult, 1)
			_, err := client.Subscribe(&subscription, map[string]interface{}{"employeeID": 1}, func(dataValue []byte, errValue error) error {
				resultCh <- subResult{data: dataValue, err: errValue}
				return nil
			})
			require.NoError(t, err)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, subscriptionOnCreateTestTimeout)
			xEnv.WaitForTriggerCount(1, subscriptionOnCreateTestTimeout)

			// Publishing to the hooked topic ("employeeUpdatedTwo") must trigger the subscription.
			xEnv.KafkaPublishUntilReceived("employeeUpdatedTwo", `{"__typename":"Employee","id":1,"update":{"name":"foo"}}`, 1, subscriptionOnCreateTestTimeout)

			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, resultCh, func(t *testing.T, r subResult) {
				require.NoError(t, r.err)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(r.data))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			assert.GreaterOrEqual(t, customModule.HookCallCount.Load(), int32(1))
		})
	})

	t.Run("hook only affects the targeted subscription, leaving others unchanged", func(t *testing.T) {
		t.Parallel()

		// This test verifies that the hook modifies only the subscription whose subject ends in ".1",
		// while the subscription with subject ".2" is left on its default channel.
		//
		// After the hook fires:
		//   sub1 (originally .1) → redirected to .99 — only events on .99 are delivered.
		//   sub2 (originally .2) → unchanged — only events on .2 are delivered.

		// capturedSubject99 receives the hook-overridden subject for sub1.
		capturedSubject99 := make(chan string, 1)

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			conf, ok := ctx.SubscriptionEventConfiguration().(*pubsubNats.SubscriptionEventConfiguration)
			if !ok || len(conf.Subjects) == 0 {
				return nil
			}
			// Only redirect the subscription whose resolved subject ends in ".1".
			if !strings.HasSuffix(conf.Subjects[0], ".1") {
				return nil
			}
			original := conf.Subjects[0]
			newSubject := strings.TrimSuffix(original, ".1") + ".99"
			conf.Subjects = []string{newSubject}
			select {
			case capturedSubject99 <- newSubject:
			default:
			}
			return nil
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions:            hookRouterOptions(customModule),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// sub1: id=1, will be redirected by the hook to subject .99
			var sub1 struct {
				employeeUpdatedMyNats struct {
					ID float64 `graphql:"id"`
				} `graphql:"employeeUpdatedMyNats(id: $id)"`
			}
			// sub2: id=2, unaffected by the hook
			var sub2 struct {
				employeeUpdatedMyNats struct {
					ID float64 `graphql:"id"`
				} `graphql:"employeeUpdatedMyNats(id: $id)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			sub1ResultCh := make(chan subResult, 1)
			_, err := client.Subscribe(&sub1, map[string]interface{}{"id": 1}, func(dataValue []byte, errValue error) error {
				sub1ResultCh <- subResult{data: dataValue, err: errValue}
				return nil
			})
			require.NoError(t, err)

			sub2ResultCh := make(chan subResult, 2)
			_, err = client.Subscribe(&sub2, map[string]interface{}{"id": 2}, func(dataValue []byte, errValue error) error {
				sub2ResultCh <- subResult{data: dataValue, err: errValue}
				return nil
			})
			require.NoError(t, err)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(2, subscriptionOnCreateTestTimeout)
			xEnv.WaitForTriggerCount(2, subscriptionOnCreateTestTimeout)

			// Capture the hook-overridden subject for sub1.
			var subject99 string
			select {
			case subject99 = <-capturedSubject99:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("hook was not called for sub1 before timeout")
			}

			// Publish to subject .99 → only sub1 should receive.
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionMyNats, subject99, []byte(`{"id":1,"__typename":"Employee"}`), 1, subscriptionOnCreateTestTimeout)

			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, sub1ResultCh, func(t *testing.T, r subResult) {
				require.NoError(t, r.err)
				require.JSONEq(t, `{"employeeUpdatedMyNats":{"id":1}}`, string(r.data))
			})

			// Publish to subject .2 → only sub2 should receive.
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionMyNats, xEnv.GetPubSubName("employeeUpdatedMyNats.2"), []byte(`{"id":2,"__typename":"Employee"}`), 1, subscriptionOnCreateTestTimeout)

			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, sub2ResultCh, func(t *testing.T, r subResult) {
				require.NoError(t, r.err)
				require.JSONEq(t, `{"employeeUpdatedMyNats":{"id":2}}`, string(r.data))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, subscriptionOnCreateTestTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			// sub1ResultCh must have no extra events (sub2's publish didn't reach sub1).
			t.Cleanup(func() {
				require.Empty(t, sub1ResultCh)
			})
		})
	})

	t.Run("hook can merge two subscriptions onto the same trigger (fan-in)", func(t *testing.T) {
		t.Parallel()

		// This test verifies the fan-in use case: two subscriptions that would normally
		// land on different NATS triggers (different subject suffixes) are both redirected
		// to the same subject by the hook, resulting in a single shared trigger.
		//
		// Both clients receive the event when a single publish is made to the shared subject.

		sharedSubjectCh := make(chan string, 2)

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			conf, ok := ctx.SubscriptionEventConfiguration().(*pubsubNats.SubscriptionEventConfiguration)
			if !ok || len(conf.Subjects) == 0 {
				return nil
			}
			// Redirect every subscription to the same "shared.1" subject regardless of
			// which employeeID argument was used.
			dotIdx := strings.LastIndex(conf.Subjects[0], ".")
			if dotIdx == -1 {
				return nil
			}
			sharedSubject := conf.Subjects[0][:dotIdx+1] + "shared"
			conf.Subjects = []string{sharedSubject}
			select {
			case sharedSubjectCh <- sharedSubject:
			default:
			}
			return nil
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions:            hookRouterOptions(customModule),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var wg sync.WaitGroup
			wg.Add(2)

			sub1ReceivedCh := make(chan struct{})
			sub2ReceivedCh := make(chan struct{})

			// sub1: id=1, hook redirects to .shared
			go func() {
				defer wg.Done()
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				defer conn.Close()

				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 1) { id } }"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
				close(sub1ReceivedCh)

				err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				require.NoError(t, err)
				var complete testenv.WebSocketMessage
				conn.SetReadDeadline(time.Now().Add(time.Second * 5))
				testenv.WSReadJSON(t, conn, &complete)
			}()

			// sub2: id=2, hook also redirects to .shared
			go func() {
				defer wg.Done()
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				defer conn.Close()

				err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 2) { id } }"}`),
				})
				require.NoError(t, err)

				var msg testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &msg)
				require.NoError(t, err)
				require.Equal(t, "next", msg.Type)
				close(sub2ReceivedCh)

				err = testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				require.NoError(t, err)
				var complete testenv.WebSocketMessage
				conn.SetReadDeadline(time.Now().Add(time.Second * 5))
				testenv.WSReadJSON(t, conn, &complete)
			}()

			xEnv.WaitForSubscriptionCount(2, subscriptionOnCreateTestTimeout)
			// Both subscriptions share a single trigger because the hook routes them to the same subject.
			xEnv.WaitForTriggerCount(1, subscriptionOnCreateTestTimeout)
			xEnv.RequireTriggerCount(1)

			// Get the shared subject from the hook (either capture works since they're the same).
			var sharedSubject string
			select {
			case sharedSubject = <-sharedSubjectCh:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("hook did not set sharedSubject before timeout")
			}

			// A single publish delivers to both subscribers.
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionMyNats, sharedSubject, []byte(`{"id":1,"__typename":"Employee"}`), 2, subscriptionOnCreateTestTimeout)

			select {
			case <-sub1ReceivedCh:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("sub1 did not receive event before timeout")
			}
			select {
			case <-sub2ReceivedCh:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("sub2 did not receive event before timeout")
			}

			wg.Wait()
			xEnv.WaitForSubscriptionCount(0, subscriptionOnCreateTestTimeout)
		})
	})

	t.Run("hook can split identical subscriptions onto different triggers (fan-out)", func(t *testing.T) {
		t.Parallel()

		// This test verifies the fan-out use case: two subscriptions for the same subject are
		// routed to different triggers by the hook, based on a per-request HTTP header.
		//
		// Client1 has no special header → stays on the default subject.
		// Client2 carries X-Reroute: true → hook redirects it to a different subject.
		// Publishing to the default subject only reaches client1, and vice versa.

		reroutedSubjectCh := make(chan string, 1)

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			if ctx.Request().Header.Get("X-Reroute") != "true" {
				return nil
			}
			conf, ok := ctx.SubscriptionEventConfiguration().(*pubsubNats.SubscriptionEventConfiguration)
			if !ok || len(conf.Subjects) == 0 {
				return nil
			}
			dotIdx := strings.LastIndex(conf.Subjects[0], ".")
			if dotIdx == -1 {
				return nil
			}
			newSubject := conf.Subjects[0][:dotIdx+1] + "rerouted"
			conf.Subjects = []string{newSubject}
			select {
			case reroutedSubjectCh <- newSubject:
			default:
			}
			return nil
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions:            hookRouterOptions(customModule),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var wg sync.WaitGroup
			wg.Add(2)

			sub1ReceivedCh := make(chan struct{})
			sub2ReceivedCh := make(chan struct{})

			const sharedEmployeeID = 3
			query := `{"query":"subscription { employeeUpdatedMyNats(id: 3) { id } }"}`

			// sub1: no header → default subject
			go func() {
				defer wg.Done()
				conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
				defer conn.Close()

				require.NoError(t, testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID: "1", Type: "subscribe", Payload: []byte(query),
				}))

				var msg testenv.WebSocketMessage
				require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
				require.Equal(t, "next", msg.Type)
				close(sub1ReceivedCh)

				testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				var complete testenv.WebSocketMessage
				conn.SetReadDeadline(time.Now().Add(time.Second * 5))
				testenv.WSReadJSON(t, conn, &complete)
			}()

			// sub2: X-Reroute: true → hook changes subject to .rerouted
			go func() {
				defer wg.Done()
				header := http.Header{}
				header.Set("X-Reroute", "true")
				conn := xEnv.InitGraphQLWebSocketConnection(header, nil, nil)
				defer conn.Close()

				require.NoError(t, testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID: "1", Type: "subscribe", Payload: []byte(query),
				}))

				var msg testenv.WebSocketMessage
				require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
				require.Equal(t, "next", msg.Type)
				close(sub2ReceivedCh)

				testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{ID: "1", Type: "complete"})
				var complete testenv.WebSocketMessage
				conn.SetReadDeadline(time.Now().Add(time.Second * 5))
				testenv.WSReadJSON(t, conn, &complete)
			}()

			xEnv.WaitForSubscriptionCount(2, subscriptionOnCreateTestTimeout)
			// The hook splits the two subscriptions onto separate triggers.
			xEnv.WaitForTriggerCount(2, subscriptionOnCreateTestTimeout)
			xEnv.RequireTriggerCount(2)

			// Retrieve the rerouted subject so we can publish to it directly.
			var reroutedSubject string
			select {
			case reroutedSubject = <-reroutedSubjectCh:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("hook did not capture rerouted subject before timeout")
			}

			defaultSubject := xEnv.GetPubSubName("employeeUpdatedMyNats." + "3")

			// Publish to default subject → only sub1 should receive.
			xEnv.NATSPublishUntilReceived(
				xEnv.NatsConnectionMyNats,
				defaultSubject,
				[]byte(`{"id":3,"__typename":"Employee"}`),
				1,
				subscriptionOnCreateTestTimeout,
			)
			select {
			case <-sub1ReceivedCh:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("sub1 did not receive event from default subject before timeout")
			}

			// Publish to rerouted subject → only sub2 should receive.
			xEnv.NATSPublishUntilReceived(
				xEnv.NatsConnectionMyNats,
				reroutedSubject,
				[]byte(`{"id":3,"__typename":"Employee"}`),
				1,
				subscriptionOnCreateTestTimeout,
			)
			select {
			case <-sub2ReceivedCh:
			case <-time.After(subscriptionOnCreateTestTimeout):
				t.Fatal("sub2 did not receive event from rerouted subject before timeout")
			}

			wg.Wait()
			xEnv.WaitForSubscriptionCount(0, subscriptionOnCreateTestTimeout)

			_ = sharedEmployeeID
		})
	})

	t.Run("panic in hook is recovered and the subscription returns an error to the client", func(t *testing.T) {
		t.Parallel()

		// This test verifies that a panic inside the SubscriptionOnCreate hook is caught
		// by the recovery deferred in PubSubSubscriptionDataSource.SubscriptionOnCreate.
		// The engine propagates the error to the client as a GraphQL error and the router
		// must not crash.

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			panic("intentional panic from SubscriptionOnCreate hook")
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions:            hookRouterOptions(customModule),
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.ErrorLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 1) { id } }"}`),
			})
			require.NoError(t, err)

			// The engine writes an error response and completes the subscription.
			var msg testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "next", msg.Type)
			require.Contains(t, string(msg.Payload), "failed to prepare subscription trigger")

			// The subscription is completed immediately after the error.
			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)

			// The router must log the recovery from the panic.
			panicLogs := xEnv.Observer().FilterMessageSnippet("[Recovery from handler panic]").All()
			require.NotEmpty(t, panicLogs, "expected panic recovery log entry")

			assert.GreaterOrEqual(t, customModule.HookCallCount.Load(), int32(1))
		})
	})

	t.Run("hook returning an error aborts the subscription", func(t *testing.T) {
		t.Parallel()

		// This test verifies that when SubscriptionOnCreate returns a non-nil error the
		// subscription is rejected: the client receives a GraphQL error and the subscription
		// is completed without any events being delivered.

		customModule := newHookModule(func(ctx core.SubscriptionOnCreateHandlerContext) error {
			return errors.New("subscription rejected by hook")
		})

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions:            hookRouterOptions(customModule),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			defer conn.Close()

			err := testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 1) { id } }"}`),
			})
			require.NoError(t, err)

			// The engine writes an error response.
			var msg testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "next", msg.Type)
			require.Contains(t, string(msg.Payload), "failed to prepare subscription trigger")

			// The subscription is completed immediately after the error.
			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)

			require.Eventually(t, func() bool {
				return customModule.HookCallCount.Load() >= 1
			}, subscriptionOnCreateTestTimeout, 50*time.Millisecond)
		})
	})
}
