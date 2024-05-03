package integration_test

import (
	"context"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
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

			topicName := "employeeUpdated.3"
			_, err := xEnv.KafkaAdminClient.CreateTopic(ctx, -1, -1, nil, topicName)
			require.NoError(t, err)

			t.Cleanup(func() {
				deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()

				_, err := xEnv.KafkaAdminClient.DeleteTopics(deleteCtx, "employeeUpdated.3")
				require.NoError(t, err)
			})
		})
	})
}
