package module_test

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	start_subscription "github.com/wundergraph/cosmo/router-tests/modules/start-subscription"
	"go.uber.org/zap/zapcore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/redis"
)

type subscriptionArgs struct {
	dataValue []byte
	errValue  error
}

func TestStartSubscriptionChangeHook(t *testing.T) {
	t.Run("Test StartSubscription hook can change channel", func(t *testing.T) {
		t.Parallel()
		logicalChannel := "customRedisChannel"
		newChannel := ""

		customModule := &start_subscription.StartSubscriptionModule{
			HookCallCount: &atomic.Int32{},
			Callback: func(ctx core.SubscriptionOnStartHandlerContext) error {
				redisCfg, ok := ctx.SubscriptionEventConfiguration().(*redis.SubscriptionEventConfiguration)
				if ok {
					redisCfg.Channels = []string{newChannel}
					ctx.SetSubscriptionEventConfiguration(redisCfg)
				}
				return nil
			},
		}

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": customModule,
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			newChannel = xEnv.GetPubSubName(logicalChannel)

			var subscriptionOne struct {
				employeeUpdatedMyRedis struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyRedis(id: 2)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			subscriptionArgsCh := make(chan subscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- subscriptionArgs{dataValue, errValue}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)
			xEnv.WaitForTriggerCount(1, time.Second*10)

			// produce a message (retry until subscription pipeline is confirmed active)
			xEnv.RedisPublishUntilReceived(logicalChannel, `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 10*time.Second)

			// The SubscriptionOnStart hook may be called asynchronously after
			// WaitForSubscriptionCount returns, so poll until it fires.
			require.Eventually(t, func() bool {
				return customModule.HookCallCount.Load() >= 1
			}, time.Second*10, time.Millisecond*50)

			// process the message
			select {
			case subscriptionArgs := <-subscriptionArgsCh:
				require.NoError(t, subscriptionArgs.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyRedis":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(subscriptionArgs.dataValue))
			case <-time.After(10 * time.Second):
				t.Fatal("timeout waiting for first message error")
			}

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			assert.Equal(t, int32(1), customModule.HookCallCount.Load())
		})
	})
}
