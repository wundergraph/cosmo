package events

import (
	"context"
	"encoding/json"
	"math/rand"
	"strconv"
	"sync"
	"testing"
	"time"

	redisClient "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/redis"
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

func TestRedisConnector(t *testing.T) {
	t.Parallel()
	var (
		redisLocalUrl = "localhost:6379"
		client        = redisClient.NewClient(&redisClient.Options{Addr: redisLocalUrl})
	)

	logger := zap.NewNop()
	connector := redis.New(logger, client)
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
		connector := redis.New(logger, client)
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
		connector := redis.New(logger, client)
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

	t.Run("PublishAndSubscribe", func(t *testing.T) {
		t.Parallel()

		updater := &testSubscriptionUpdater{}
		prefix := strconv.FormatUint(rand.Uint64(), 16)
		channel := prefix + "test"
		msg := `{"test": "test"}`

		logger := zap.NewNop()
		connector := redis.New(logger, client)
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
