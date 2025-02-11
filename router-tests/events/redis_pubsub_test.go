package events

import (
	"context"
	"encoding/json"
	"math/rand"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasura/go-graphql-client"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	pubsubRedis "github.com/wundergraph/cosmo/router/pkg/pubsub/redis"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"go.uber.org/zap"
)

type testSubscriptionUpdater struct {
	updates []string
	done    bool
	mux     sync.Mutex
}

func (t *testSubscriptionUpdater) Update(data []byte) {
	t.mux.Lock()
	defer t.mux.Unlock()
	t.updates = append(t.updates, string(data))
}

func (t *testSubscriptionUpdater) Done() {
	t.mux.Lock()
	defer t.mux.Unlock()
	t.done = true
}

const redisLocalUrl = "localhost:6379"

func TestRedisConnector(t *testing.T) {
	t.Parallel()
	var (
		client = redis.NewClient(&redis.Options{Addr: redisLocalUrl})
	)

	logger := zap.NewNop()
	connector := pubsubRedis.NewConnector(logger, client)
	redisPubSub := connector.New(context.Background())
	assert.NotNil(t, redisPubSub)

	const Msg = `{"test": "test"}`

	t.Run("Publish", func(t *testing.T) {
		t.Parallel()

		prefix := strconv.FormatUint(rand.Uint64(), 16)
		channel := prefix + "test"

		sub := client.PSubscribe(context.Background(), channel)
		ch := sub.Channel()

		logger := zap.NewNop()
		connector := pubsubRedis.NewConnector(logger, client)
		redisPubSub := connector.New(context.Background())
		publishErr := redisPubSub.Publish(context.Background(), pubsub_datasource.RedisPublishEventConfiguration{
			ProviderID: "default",
			Channel:    channel,
			Data:       json.RawMessage(Msg),
		})
		assert.NoError(t, publishErr)
		receivedMsg := <-ch
		assert.Equal(t, Msg, receivedMsg.Payload)
	})

	t.Run("Subscribe", func(t *testing.T) {
		t.Parallel()

		updater := &testSubscriptionUpdater{}
		prefix := strconv.FormatUint(rand.Uint64(), 16)
		channel := prefix + "test"
		msg := `{"test": "test"}`

		logger := zap.NewNop()
		connector := pubsubRedis.NewConnector(logger, client)
		redisPubSub := connector.New(context.Background())

		subscribeErr := redisPubSub.Subscribe(context.Background(), pubsub_datasource.RedisSubscriptionEventConfiguration{
			ProviderID: "default",
			Channels:   []string{channel},
		}, updater)
		assert.NoError(t, subscribeErr)

		sub := client.Publish(context.Background(), channel, msg)
		require.NoError(t, sub.Err())

		require.Eventually(t, func() bool {
			updater.mux.Lock()
			defer updater.mux.Unlock()
			return len(updater.updates) > 0
		}, 5*time.Second, 100*time.Millisecond)
		require.Len(t, updater.updates, 1)
		assert.Equal(t, msg, updater.updates[0])
	})

	t.Run("Publish and Subscribe", func(t *testing.T) {
		t.Parallel()

		updater := &testSubscriptionUpdater{}
		prefix := strconv.FormatUint(rand.Uint64(), 16)
		channel := prefix + "test"
		msg := `{"test": "test"}`

		logger := zap.NewNop()
		connector := pubsubRedis.NewConnector(logger, client)
		redisPubSub := connector.New(context.Background())

		subscribeErr := redisPubSub.Subscribe(context.Background(), pubsub_datasource.RedisSubscriptionEventConfiguration{
			ProviderID: "default",
			Channels:   []string{channel},
		}, updater)
		assert.NoError(t, subscribeErr)

		publishErr := redisPubSub.Publish(context.Background(), pubsub_datasource.RedisPublishEventConfiguration{
			ProviderID: "default",
			Channel:    channel,
			Data:       json.RawMessage(msg),
		})
		require.NoError(t, publishErr)

		require.Eventually(t, func() bool {
			updater.mux.Lock()
			defer updater.mux.Unlock()
			return len(updater.updates) > 0
		}, 5*time.Second, 100*time.Millisecond)
		require.Len(t, updater.updates, 1)
		assert.Equal(t, msg, updater.updates[0])
	})
}

func TestRedis(t *testing.T) {
	t.Run("Redis single instance", func(t *testing.T) {
		t.Run("Subscribe", func(t *testing.T) {
			t.Parallel()

			var redisClient = redis.NewClient(&redis.Options{Addr: redisLocalUrl})

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				var subscriptionOne struct {
					employeeUpdatedRedis struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdatedRedis(id: 3)"`
				}

				surl := xEnv.GraphQLWebSocketSubscriptionURL()
				client := graphql.NewSubscriptionClient(surl)
				t.Cleanup(func() {
					_ = client.Close()
				})

				var counter atomic.Uint32

				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					defer counter.Add(1)
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdatedRedis":{"id":3,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				go func() {
					clientErr := client.Run()
					require.NoError(t, clientErr)
				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*10)

				pubSubName := xEnv.GetPubSubName("employeeUpdatedRedis.3")
				redisClient.Publish(context.Background(), pubSubName, `{"id":3,"details":{"forename":"Jens","surname":"Neuse"}}`)

				require.Eventually(t, func() bool {
					return counter.Load() == 1
				}, time.Second*10, time.Millisecond*100)

				var clientClose atomic.Bool
				go func() {
					defer clientClose.Store(true)
					_ = client.Close()
				}()
				require.Eventually(t, clientClose.Load, time.Second*10, time.Millisecond*100)
			})
		})

		t.Run("Subscribe and mutate", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				var subscriptionOne struct {
					employeeUpdatedRedis struct {
						ID float64 `graphql:"id"`
					} `graphql:"employeeUpdatedRedis(id: 3)"`
				}

				surl := xEnv.GraphQLWebSocketSubscriptionURL()
				client := graphql.NewSubscriptionClient(surl)
				t.Cleanup(func() {
					_ = client.Close()
				})

				var counter atomic.Uint32

				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					defer counter.Add(1)
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdatedRedis":{"id":3}}`, string(dataValue))
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				go func() {
					clientErr := client.Run()
					require.NoError(t, clientErr)
				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*10)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation UpdateEmployeeRedis($update: UpdateEmployeeInput!) {
							updateEmployeeRedis(id: 3, update: $update) { success }
						}`,
					Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
				})
				require.JSONEq(t, `{"data":{"updateEmployeeRedis":{"success":true}}}`, res.Body)

				require.Eventually(t, func() bool {
					return counter.Load() == 1
				}, time.Second*10, time.Millisecond*100)

				var clientClose atomic.Bool
				go func() {
					defer clientClose.Store(true)
					_ = client.Close()
				}()
				require.Eventually(t, clientClose.Load, time.Second*10, time.Millisecond*100)
			})
		})
	})

	t.Run("Redis cluster", func(t *testing.T) {
		redisClusterLocalUrls := []string{
			"redis://cosmo:test@localhost:7003",
			"redis://cosmo:test@localhost:7002",
			"redis://cosmo:test@localhost:7001",
		}
		t.Run("Subscribe", func(t *testing.T) {
			t.Parallel()

			var redisClient = redis.NewClient(&redis.Options{Addr: redisClusterLocalUrls[0]})

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
					cfg.Providers.Redis = []config.RedisEventSource{
						{
							ID:             "default",
							ClusterEnabled: true,
							URLs:           redisClusterLocalUrls,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				var subscriptionOne struct {
					employeeUpdatedRedis struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"employeeUpdatedRedis(id: 3)"`
				}

				surl := xEnv.GraphQLWebSocketSubscriptionURL()
				client := graphql.NewSubscriptionClient(surl)
				t.Cleanup(func() {
					_ = client.Close()
				})

				var counter atomic.Uint32

				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					defer counter.Add(1)
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdatedRedis":{"id":3,"details":{"forename":"Jens","surname":"Neuse"}}}`, string(dataValue))
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				go func() {
					clientErr := client.Run()
					require.NoError(t, clientErr)
				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*10)

				pubSubName := xEnv.GetPubSubName("employeeUpdatedRedis.3")
				redisClient.Publish(context.Background(), pubSubName, `{"id":3,"details":{"forename":"Jens","surname":"Neuse"}}`)

				require.Eventually(t, func() bool {
					return counter.Load() == 1
				}, time.Second*10, time.Millisecond*100)

				var clientClose atomic.Bool
				go func() {
					defer clientClose.Store(true)
					_ = client.Close()
				}()
				require.Eventually(t, clientClose.Load, time.Second*10, time.Millisecond*100)
			})
		})

		t.Run("Subscribe and mutate", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsRedisJSONTemplate,
				ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
					cfg.Providers.Redis = []config.RedisEventSource{
						{
							ID:             "default",
							ClusterEnabled: true,
							URLs:           redisClusterLocalUrls,
						},
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				var subscriptionOne struct {
					employeeUpdatedRedis struct {
						ID float64 `graphql:"id"`
					} `graphql:"employeeUpdatedRedis(id: 3)"`
				}

				surl := xEnv.GraphQLWebSocketSubscriptionURL()
				client := graphql.NewSubscriptionClient(surl)
				t.Cleanup(func() {
					_ = client.Close()
				})

				var counter atomic.Uint32

				subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
					defer counter.Add(1)
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdatedRedis":{"id":3}}`, string(dataValue))
					return nil
				})
				require.NoError(t, err)
				require.NotEmpty(t, subscriptionOneID)

				go func() {
					clientErr := client.Run()
					require.NoError(t, clientErr)
				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*10)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation UpdateEmployeeRedis($update: UpdateEmployeeInput!) {
							updateEmployeeRedis(id: 3, update: $update) { success }
						}`,
					Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
				})
				require.JSONEq(t, `{"data":{"updateEmployeeRedis":{"success":true}}}`, res.Body)

				require.Eventually(t, func() bool {
					return counter.Load() == 1
				}, time.Second*10, time.Millisecond*100)

				var clientClose atomic.Bool
				go func() {
					defer clientClose.Store(true)
					_ = client.Close()
				}()
				require.Eventually(t, clientClose.Load, time.Second*10, time.Millisecond*100)
			})
		})
	})
}
