package integration_test

import (
	"context"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"sync"
	"testing"
	"time"
)

func TestKafkaEvents(t *testing.T) {
	t.Parallel()

	t.Run("subscribe async", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			// Create topic

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			topicName := "employeeUpdated"
			_, err := xEnv.KafkaAdminClient.CreateTopic(ctx, -1, -1, nil, topicName)
			require.NoError(t, err)

			//t.Cleanup(func() {
			//	deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			//	defer cancel()
			//
			//	_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, "employeeUpdated.3")
			//	require.NoError(t, err)
			//})
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
				Value: []byte(`{"__typename":"Employee","id":3,"update":{"name":"foo"}}`),
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
