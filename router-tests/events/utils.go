package events

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func EnsureTopicExists(t *testing.T, xEnv *testenv.Environment, timeout time.Duration, topics ...string) {
	// Delete topic for idempotency
	deleteCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	prefixedTopics := make([]string, len(topics))
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

	fetchs := client.PollRecords(ctx, msgs)

	return fetchs.Records(), nil
}
