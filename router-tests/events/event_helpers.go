package events

import (
	"context"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"net/url"
	"testing"
	"time"
)

const waitTimeout = time.Second * 30

func ProduceKafkaMessage(t *testing.T, xEnv *testenv.Environment, topicName string, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pErrCh := make(chan error)

	xEnv.KafkaClient.Produce(ctx, &kgo.Record{
		Topic: xEnv.GetPubSubName(topicName),
		Value: []byte(message),
	}, func(_ *kgo.Record, err error) {
		pErrCh <- err
	})

	testenv.AwaitChannelWithT(t, waitTimeout, pErrCh, func(t *testing.T, pErr error) {
		require.NoError(t, pErr)
	})

	fErr := xEnv.KafkaClient.Flush(ctx)
	require.NoError(t, fErr)
}

func EnsureTopicExists(t *testing.T, xEnv *testenv.Environment, topics ...string) {
	// Delete topic for idempotency
	deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	prefixedTopics := make([]string, 0, len(topics))
	for _, topic := range topics {
		prefixedTopics = append(prefixedTopics, xEnv.GetPubSubName(topic))
	}

	_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, prefixedTopics...)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = xEnv.KafkaAdminClient.CreateTopics(ctx, 1, 1, nil, prefixedTopics...)
	require.NoError(t, err)
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

	defer func() {
		_ = redisConn.Close()
	}()

	intCmd := redisConn.Publish(ctx, xEnv.GetPubSubName(topicName), message)
	require.NoError(t, intCmd.Err())
}
