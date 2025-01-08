package integration_test

import (
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"testing"
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
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsJSONTemplate,
			EnableNats:               false,
			EnableKafka:              true,
			ModifyEventsConfiguration: func(eventsConfiguration *config.EventsConfiguration) {
				eventsConfiguration.Providers.Nats = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "should not be called")
		})
		assert.ErrorContains(t, err, "failed to find Nats provider with ID")
	})
}
