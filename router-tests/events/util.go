package events

import (
	"context"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"testing"
	"time"
)

func EnsureTopicExists(t *testing.T, xEnv *testenv.Environment, topics ...string) {
	// Delete topic for idempotency
	deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	prefixedTopics := make([]string, len(topics))
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
