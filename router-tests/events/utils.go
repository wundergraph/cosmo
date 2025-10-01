package events

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func KafkaEnsureTopicExists(t *testing.T, xEnv *testenv.Environment, timeout time.Duration, topics ...string) {
	// Delete topic for idempotency
	deleteCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	prefixedTopics := make([]string, 0, len(topics))
	for _, topic := range topics {
		prefixedTopics = append(prefixedTopics, xEnv.GetPubSubName(topic))
	}

	_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, prefixedTopics...)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	_, err = xEnv.KafkaAdminClient.CreateTopics(ctx, 1, 1, nil, prefixedTopics...)
	require.NoError(t, err)
}

func ProduceKafkaMessage(t *testing.T, xEnv *testenv.Environment, timeout time.Duration, topicName string, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	pErrCh := make(chan error)

	xEnv.KafkaClient.Produce(ctx, &kgo.Record{
		Topic: xEnv.GetPubSubName(topicName),
		Value: []byte(message),
	}, func(record *kgo.Record, err error) {
		pErrCh <- err
	})

	testenv.AwaitChannelWithT(t, timeout, pErrCh, func(t *testing.T, pErr error) {
		require.NoError(t, pErr)
	})

	fErr := xEnv.KafkaClient.Flush(ctx)
	require.NoError(t, fErr)
}

func ReadKafkaMessages(xEnv *testenv.Environment, timeout time.Duration, topicName string, msgs int) ([]*kgo.Record, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	client, err := kgo.NewClient(
		kgo.SeedBrokers(xEnv.GetKafkaSeeds()...),
		kgo.ConsumeTopics(xEnv.GetPubSubName(topicName)),
	)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	fetchs := client.PollRecords(ctx, msgs)

	return fetchs.Records(), nil
}

func ProduceRedisMessage(t *testing.T, xEnv *testenv.Environment, topicName string, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	parsedURL, err := url.Parse(xEnv.RedisHosts[0])
	if err != nil {
		t.Fatalf("Failed to parse Redis URL: %v", err)
	}
	var redisConn redis.UniversalClient
	if !xEnv.RedisWithClusterMode {
		redisConn = redis.NewClient(&redis.Options{
			Addr: parsedURL.Host,
		})
	} else {
		redisConn = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs: []string{parsedURL.Host},
		})
	}

	intCmd := redisConn.Publish(ctx, xEnv.GetPubSubName(topicName), message)
	require.NoError(t, intCmd.Err())
}

func ReadRedisMessages(t *testing.T, xEnv *testenv.Environment, channelName string) (<-chan *redis.Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	parsedURL, err := url.Parse(xEnv.RedisHosts[0])
	if err != nil {
		return nil, err
	}
	var redisConn redis.UniversalClient
	if !xEnv.RedisWithClusterMode {
		redisConn = redis.NewClient(&redis.Options{
			Addr: parsedURL.Host,
		})
	} else {
		redisConn = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs: []string{parsedURL.Host},
		})
	}
	sub := redisConn.Subscribe(ctx, xEnv.GetPubSubName(channelName))
	t.Cleanup(func() {
		sub.Close()
		redisConn.Close()
	})

	return sub.Channel(), nil
}
