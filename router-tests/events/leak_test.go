package events_test

import (
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.uber.org/goleak"
)

func TestAdapterLeaksGoroutines(t *testing.T) {
	// Subscribe and unsubscribe 10 times sequentially, then verify no goroutines have leaked.
	// A goroutine snapshot is taken after starting the testenv but before the first subscribe.
	// After the last unsubscribe this snapshot is used to diff the goroutines,
	// ensuring we only fail if new, still active goroutines have been created meantime.

	t.Run("Kafka", func(t *testing.T) {
		cfg := testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
		}

		var query struct {
			EmployeeUpdatedMyKafka struct {
				ID      float64 `graphql:"id"`
				Details struct {
					Forename string `graphql:"forename"`
					Surname  string `graphql:"surname"`
				} `graphql:"details"`
			} `graphql:"employeeUpdatedMyKafka(employeeID: 1)"`
		}

		testenv.Run(t, &cfg, leakTestHandler(query))
	})

	t.Run("Redis", func(t *testing.T) {
		cfg := testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			EnableRedis:              true,
		}

		var query struct {
			EmployeeUpdatedMyRedis struct {
				ID      float64 `graphql:"id"`
				Details struct {
					Forename string `graphql:"forename"`
					Surname  string `graphql:"surname"`
				} `graphql:"details"`
			} `graphql:"employeeUpdatedMyRedis(id: 1)"`
		}

		testenv.Run(t, &cfg, leakTestHandler(query))
	})

	t.Run("NATS", func(t *testing.T) {
		cfg := testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}

		var query struct {
			EmployeeUpdatedMyNats struct {
				ID      float64 `graphql:"id"`
				Details struct {
					Forename string `graphql:"forename"`
					Surname  string `graphql:"surname"`
				} `graphql:"details"`
			} `graphql:"employeeUpdatedMyNats(id: 1)"`
		}

		testenv.Run(t, &cfg, leakTestHandler(query))
	})
}

func leakTestHandler(query any) testenv.Handler {
	noopHandler := func(_ []byte, _ error) error {
		return nil
	}

	return func(t *testing.T, xEnv *testenv.Environment) {
		ignore := []goleak.Option{
			goleak.IgnoreCurrent(),
			// The hasura test client itself leaks sometimes, we have to ignore it.
			goleak.IgnoreAnyFunction("github.com/hasura/go-graphql-client.(*SubscriptionContext).run"),
		}

		for range 10 {
			client := graphql.NewSubscriptionClient(xEnv.GraphQLWebSocketSubscriptionURL())

			subID, err := client.Subscribe(query, nil, noopHandler)
			require.NoError(t, err)

			clientRunCh := make(chan error, 1)
			go func() {
				clientRunCh <- client.Run()
			}()
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

			err = client.Unsubscribe(subID)
			require.NoError(t, err)
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

			err = client.Close()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			})
		}

		require.EventuallyWithT(t, func(t *assert.CollectT) {
			assert.NoError(t, goleak.Find(ignore...))
		}, EventWaitTimeout, time.Millisecond*100, "adapter leaked goroutines")
	}
}
