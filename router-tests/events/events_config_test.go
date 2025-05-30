package events_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestEventsConfig(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("kafka provider not specified in the router configuration", func(t *testing.T) {
		err := testenv.RunWithError(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsJSONTemplate,
			EnableNats:               true,
			EnableKafka:              false,
			EnableRedis:              true,
			ModifyEventsConfiguration: func(eventsConfiguration *config.EventsConfiguration) {
				eventsConfiguration.Providers.Kafka = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.ErrorContains(t, err, "kafka provider with ID my-kafka is not defined")
	})

	t.Run("nats provider not specified in the router configuration", func(t *testing.T) {
		err := testenv.RunWithError(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsJSONTemplate,
			EnableNats:               false,
			EnableKafka:              true,
			EnableRedis:              true,
			ModifyEventsConfiguration: func(eventsConfiguration *config.EventsConfiguration) {
				eventsConfiguration.Providers.Nats = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.ErrorContains(t, err, "nats provider with ID default is not defined")
	})

	t.Run("redis provider not specified in the router configuration", func(t *testing.T) {
		err := testenv.RunWithError(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsJSONTemplate,
			EnableNats:               true,
			EnableKafka:              true,
			EnableRedis:              false,
			ModifyEventsConfiguration: func(eventsConfiguration *config.EventsConfiguration) {
				eventsConfiguration.Providers.Redis = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.ErrorContains(t, err, "redis provider with ID my-redis is not defined")
	})
}
