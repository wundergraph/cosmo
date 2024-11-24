package integration_test

import (
	"context"
	"github.com/stretchr/testify/assert"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/kafka"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestEventsConfig(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	var (
		kafkaContainer *kafka.KafkaContainer
		err            error
	)

	ctx := context.Background()
	require.Eventually(t, func() bool {
		// when using Docker Desktop on Mac, it's possible that it takes 2 attempts to get the network port of the container
		// I've debugged this extensively and the issue is not with the testcontainers-go library, but with the Docker Desktop
		// Error message: container logs (port not found)
		// This is an internal issue coming from the Docker pkg
		// It seems like Docker Desktop on Mac is not always capable of providing a port mapping
		// The solution is to retry the container creation until we get the network port
		// Please don't try to improve this code as this workaround allows running the tests without any issues
		kafkaContainer, err = kafka.RunContainer(ctx,
			testcontainers.WithImage("confluentinc/confluent-local:7.6.1"),
			testcontainers.WithWaitStrategyAndDeadline(time.Second*30, wait.ForListeningPort("9093/tcp")),
		)
		return err == nil && kafkaContainer != nil
	}, time.Second*30, time.Second)

	require.NoError(t, kafkaContainer.Start(ctx))

	seeds, err := kafkaContainer.Brokers(ctx)
	require.NoError(t, err)

	t.Cleanup(func() {
		require.NoError(t, kafkaContainer.Terminate(ctx))
	})

	t.Run("kafka provider not specified in the router configuration", func(t *testing.T) {
		err := testenv.RunWithError(t, &testenv.Config{
			ModifyEventsConfiguration: func(eventsConfiguration *config.EventsConfiguration) {
				eventsConfiguration.Providers.Kafka = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.ErrorContains(t, err, "failed to find Kafka provider with ID")
	})

	t.Run("nats provider not specified in the router configuration", func(t *testing.T) {
		err := testenv.RunWithError(t, &testenv.Config{
			KafkaSeeds: seeds,
			ModifyEventsConfiguration: func(eventsConfiguration *config.EventsConfiguration) {
				eventsConfiguration.Providers.Nats = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.ErrorContains(t, err, "failed to find Nats provider with ID")
	})
}
