package module_test

import (
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
)

func TestStartSubscriptionHook(t *testing.T) {
	t.Parallel()

	t.Run("Test StartSubscription hook is called", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"startSubscriptionModule": start_subscription.StartSubscriptionModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&start_subscription.StartSubscriptionModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
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

			vars := map[string]interface{}{
				"employeeID": 3,
			}
			type kafkaSubscriptionArgs struct {
				dataValue []byte
				errValue  error
			}
			subscriptionArgsCh := make(chan kafkaSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, vars, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- kafkaSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			testenv.AwaitChannelWithT(t, time.Second*10, subscriptionArgsCh, func(t *testing.T, args kafkaSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, time.Second*10, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)

			}, "unable to close client before timeout")

			requestLog := xEnv.Observer().FilterMessage("SubscriptionOnStart Hook has been run")
			assert.Len(t, requestLog.All(), 1)
		})
	})
}
