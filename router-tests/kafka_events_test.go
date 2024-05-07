package integration_test

import (
	"context"
	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"sync"
	"testing"
	"time"
)

func TestKafkaEvents(t *testing.T) {

	t.Run("subscribe async", func(t *testing.T) {

		topicName := "employeeUpdated"

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			// Delete topic for idempotency

			deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, topicName)
			require.NoError(t, err)

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			// Create topic

			_, err = xEnv.KafkaAdminClient.CreateTopic(ctx, -1, -1, nil, topicName)
			require.NoError(t, err)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(1)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			go func() {
				wg.Wait()
				unsubscribeErr := client.Unsubscribe(subscriptionOneID)
				require.NoError(t, unsubscribeErr)
				clientCloseErr := client.Close()
				require.NoError(t, clientCloseErr)
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			wg2 := &sync.WaitGroup{}
			wg2.Add(1)

			var pErr error

			xEnv.KafkaClient.Produce(ctx, &kgo.Record{
				Topic: topicName,
				Value: []byte(`{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`),
			}, func(record *kgo.Record, err error) {
				defer wg2.Done()
				if err != nil {
					pErr = err
				}
			})

			wg2.Wait()

			require.NoError(t, pErr)

			xEnv.WaitForMessagesSent(1, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe async epoll/kqueue disabled", func(t *testing.T) {

		topicName := "employeeUpdated"

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableWebSocketEpollKqueue = false
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 100
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			// Delete topic for idempotency

			deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, topicName)
			require.NoError(t, err)

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			// Create topic

			_, err = xEnv.KafkaAdminClient.CreateTopic(ctx, -1, -1, nil, topicName)
			require.NoError(t, err)

			var subscriptionOne struct {
				employeeUpdatedMyKafka struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyKafka(employeeID: 3)"`
			}

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(1)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEmpty(t, subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			go func() {
				wg.Wait()
				unsubscribeErr := client.Unsubscribe(subscriptionOneID)
				require.NoError(t, unsubscribeErr)
				clientCloseErr := client.Close()
				require.NoError(t, clientCloseErr)
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			wg2 := &sync.WaitGroup{}
			wg2.Add(1)

			var pErr error

			xEnv.KafkaClient.Produce(ctx, &kgo.Record{
				Topic: topicName,
				Value: []byte(`{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`),
			}, func(record *kgo.Record, err error) {
				defer wg2.Done()
				if err != nil {
					pErr = err
				}
			})

			wg2.Wait()

			require.NoError(t, pErr)

			xEnv.WaitForMessagesSent(1, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("publish async", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			// Create topic

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			topicName := "employeeUpdated"

			var wg sync.WaitGroup
			wg.Add(1)

			var pErr error

			xEnv.KafkaClient.Produce(ctx, &kgo.Record{
				Topic: topicName,
				Value: []byte(`{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`),
			}, func(record *kgo.Record, err error) {
				defer wg.Done()
				if err != nil {
					pErr = err
				}
			})

			wg.Wait()

			require.NoError(t, pErr)
		})
	})
}
