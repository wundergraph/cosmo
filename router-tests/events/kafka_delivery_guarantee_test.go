package events_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

const deliveryGuaranteeSubscription = `subscription { employeeUpdatedMyKafka(employeeID: 1) { id details { forename surname } }}`

// enableKafkaCursorMode marks a Kafka subscription field as cursor capable, like the
// deliveryGuarantees argument of the EDFS subscribe directive does.
func enableKafkaCursorMode(t *testing.T, routerConfig *nodev1.RouterConfig, fieldName string) {
	t.Helper()

	for _, dataSourceConfig := range routerConfig.EngineConfig.GetDatasourceConfigurations() {
		for _, kafkaEvent := range dataSourceConfig.GetCustomEvents().GetKafka() {
			cfg := kafkaEvent.GetEngineEventConfiguration()
			if cfg != nil && cfg.GetFieldName() == fieldName {
				cfg.DeliveryGuarantees = &nodev1.DeliveryGuarantees{
					Mode: nodev1.DeliveryGuaranteeMode_DELIVERY_GUARANTEE_MODE_CURSOR,
				}
				return
			}
		}
	}
	t.Fatalf("unable to find kafka custom event for field %q", fieldName)
}

func TestKafkaDeliveryGuarantee(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	topics := []string{"employeeUpdated", "employeeUpdatedTwo"}

	wsErrorPayload := func(t *testing.T, xEnv *testenv.Environment, extensions string) testenv.GraphQLResponse {
		t.Helper()

		conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
		require.NoError(t, testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
			ID:      "1",
			Type:    "subscribe",
			Payload: fmt.Appendf(nil, `{"query":%q,"extensions":%s}`, deliveryGuaranteeSubscription, extensions),
		}))

		var msg testenv.WebSocketMessage
		require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
		require.Equal(t, "1", msg.ID)
		require.Equal(t, "error", msg.Type)

		var errs []testenv.GraphQLError
		require.NoError(t, json.Unmarshal(msg.Payload, &errs))
		return testenv.GraphQLResponse{Errors: errs}
	}

	sseData := func(t *testing.T, xEnv *testenv.Environment, extensions string) string {
		t.Helper()

		body := fmt.Appendf(nil, `{"query":%q,"extensions":%s}`, deliveryGuaranteeSubscription, extensions)
		req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")

		client := http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, http.StatusOK, resp.StatusCode)

		reader := bufio.NewReader(resp.Body)
		require.Equal(t, "event: next", testenv.ReadSSEField(t, reader))
		data := testenv.ReadSSEField(t, reader)
		// The router closes the stream after a terminal error.
		rest, err := io.ReadAll(reader)
		require.NoError(t, err)
		require.Empty(t, strings.TrimSpace(string(rest)))
		return data
	}

	run := func(t *testing.T, cursorEnabled bool, fn func(t *testing.T, xEnv *testenv.Environment)) {
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
			EnableKafka:              true,
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				if cursorEnabled {
					enableKafkaCursorMode(t, routerConfig, "employeeUpdatedMyKafka")
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topics...)
			fn(t, xEnv)
		})
	}

	t.Run("websocket invalid value is rejected", func(t *testing.T) {
		t.Parallel()
		run(t, true, func(t *testing.T, xEnv *testenv.Environment) {
			res := wsErrorPayload(t, xEnv, `{"cosmoDeliveryGuarantee":42}`)
			require.Len(t, res.Errors, 1)
			require.Equal(t, "DELIVERY_GUARANTEE_INVALID", res.Errors[0].Extensions.Code)
			require.Equal(t, []string{"cursor", "at-most-once"}, res.Errors[0].Extensions.CosmoCursor.Supported)
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
		})
	})

	t.Run("websocket cursor on a non-cursor field is rejected", func(t *testing.T) {
		t.Parallel()
		run(t, false, func(t *testing.T, xEnv *testenv.Environment) {
			res := wsErrorPayload(t, xEnv, `{"cosmoDeliveryGuarantee":"cursor"}`)
			require.Len(t, res.Errors, 1)
			require.Equal(t, "DELIVERY_GUARANTEE_UNSUPPORTED", res.Errors[0].Extensions.Code)
			require.Equal(t, []string{"at-most-once"}, res.Errors[0].Extensions.CosmoCursor.Supported)
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
		})
	})

	t.Run("sse invalid value is rejected", func(t *testing.T) {
		t.Parallel()
		run(t, true, func(t *testing.T, xEnv *testenv.Environment) {
			data := sseData(t, xEnv, `{"cosmoDeliveryGuarantee":42}`)
			require.Contains(t, data, `"code":"DELIVERY_GUARANTEE_INVALID"`)
			require.Contains(t, data, `"cosmoCursor":{"supported":["cursor","at-most-once"]}`)
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
		})
	})

	t.Run("sse cursor on a non-cursor field is rejected", func(t *testing.T) {
		t.Parallel()
		run(t, false, func(t *testing.T, xEnv *testenv.Environment) {
			data := sseData(t, xEnv, `{"cosmoDeliveryGuarantee":"cursor"}`)
			require.Contains(t, data, `"code":"DELIVERY_GUARANTEE_UNSUPPORTED"`)
			require.Contains(t, data, `"cosmoCursor":{"supported":["at-most-once"]}`)
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
		})
	})

	t.Run("websocket valid cursor request subscribes", func(t *testing.T) {
		t.Parallel()
		run(t, true, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			require.NoError(t, testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: fmt.Appendf(nil, `{"query":%q,"extensions":{"cosmoDeliveryGuarantee":"cursor"}}`, deliveryGuaranteeSubscription),
			}))

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			xEnv.KafkaPublishUntilReceived(topics[0], `{"__typename":"Employee","id": 1,"update":{"name":"foo"}}`, 1, EventWaitTimeout)

			var msg testenv.WebSocketMessage
			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.Equal(t, "next", msg.Type)
			require.JSONEq(t, `{"data":{"employeeUpdatedMyKafka":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, string(msg.Payload))
		})
	})
}
