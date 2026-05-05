package events_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// buildBypassIfValuesNullConfig returns a router config JSON template derived from
// ConfigWithEdfsNatsJSONTemplate with two adjustments:
//
//   - `filteredEmployeeUpdated` accepts a new optional argument `filterById: Int`.
//   - the field's subscription filter is rewritten to
//     `IN { fieldPath: ["id"], values: ["{{ args.filterById }}"], bypassIfValuesNull: true }`.
//
// The existing argument `id: Int!` remains in place and continues to drive the NATS
// subject template (`employeeUpdated.{{ args.id }}`). The new optional argument is
// only used by the filter, so subscriptions can omit it (or pass null) without
// breaking subject resolution. That isolates the bypass behavior under test.
func buildBypassIfValuesNullConfig(t *testing.T) string {
	t.Helper()

	cfg := testenv.ConfigWithEdfsNatsJSONTemplate

	// Add the new optional argument to every place the field is declared in the
	// embedded GraphQL schemas (federated graph, subgraph SDLs, router schema).
	const oldField = `filteredEmployeeUpdated(id: Int!)`
	const newField = `filteredEmployeeUpdated(id: Int!, filterById: Int)`
	require.Greater(t, strings.Count(cfg, oldField), 0,
		"expected source config to contain %q", oldField)
	cfg = strings.ReplaceAll(cfg, oldField, newField)

	// Update the field configuration on the router so the engine knows about the
	// new argument source. Only one structural occurrence exists in the JSON.
	const oldArgsCfg = `"typeName": "Subscription",
        "fieldName": "filteredEmployeeUpdated",
        "argumentsConfiguration": [
          {
            "name": "id",
            "sourceType": "FIELD_ARGUMENT"
          }
        ],`
	const newArgsCfg = `"typeName": "Subscription",
        "fieldName": "filteredEmployeeUpdated",
        "argumentsConfiguration": [
          {
            "name": "id",
            "sourceType": "FIELD_ARGUMENT"
          },
          {
            "name": "filterById",
            "sourceType": "FIELD_ARGUMENT"
          }
        ],`
	require.Equal(t, 1, strings.Count(cfg, oldArgsCfg),
		"expected exactly one filteredEmployeeUpdated argumentsConfiguration block")
	cfg = strings.ReplaceAll(cfg, oldArgsCfg, newArgsCfg)

	// Replace the existing NOT IN filter with an IN-with-bypass filter targeting the
	// new optional argument. The same JSON snippet appears once in the router
	// engine config and once inside the data source nested config — both must be
	// rewritten.
	const oldFilter = `"subscriptionFilterCondition": {
          "not": {
            "in": {
              "fieldPath": [
                "id"
              ],
              "json": "[2,6,9,10,12]"
            }
          }
        }`
	const newFilter = `"subscriptionFilterCondition": {
          "in": {
            "fieldPath": [
              "id"
            ],
            "json": "[\"{{ args.filterById }}\"]",
            "bypassIfValuesNull": true
          }
        }`
	require.Equal(t, 1, strings.Count(cfg, oldFilter),
		"expected exactly one top-level filteredEmployeeUpdated filter")
	cfg = strings.ReplaceAll(cfg, oldFilter, newFilter)

	// The data-source-level filter has slightly deeper indentation.
	const oldFilterNested = `"subscriptionFilterCondition": {
                "not": {
                  "in": {
                    "fieldPath": [
                      "id"
                    ],
                    "json": "[2,6,9,10,12]"
                  }
                }
              }`
	const newFilterNested = `"subscriptionFilterCondition": {
                "in": {
                  "fieldPath": [
                    "id"
                  ],
                  "json": "[\"{{ args.filterById }}\"]",
                  "bypassIfValuesNull": true
                }
              }`
	require.Equal(t, 1, strings.Count(cfg, oldFilterNested),
		"expected exactly one nested data-source filteredEmployeeUpdated filter")
	cfg = strings.ReplaceAll(cfg, oldFilterNested, newFilterNested)

	return cfg
}

func TestNatsSubscriptionFilterBypassIfValuesNull(t *testing.T) {
	t.Parallel()

	cfg := buildBypassIfValuesNullConfig(t)

	type subscriptionPayload struct {
		Data struct {
			FilteredEmployeeUpdated struct {
				ID float64 `graphql:"id"`
			} `json:"filteredEmployeeUpdated"`
		} `json:"data"`
	}

	t.Run("explicit filterById receives only events whose id equals filterById", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: cfg,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketServerReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "subscribe",
				Payload: []byte(
					`{"query":"subscription { filteredEmployeeUpdated(id: 1, filterById: 1) { id } }"}`,
				),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Warm-up with id=1 so the subscription pipeline is wired before the
			// noise events arrive.
			subject := xEnv.GetPubSubName("employeeUpdated.1")
			xEnv.NATSPublishUntilReceived(
				xEnv.NatsConnectionDefault, subject,
				[]byte(`{"id":1,"__typename":"Employee"}`), 1, EventWaitTimeout,
			)

			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			require.NoError(t, json.Unmarshal(msg.Payload, &payload))
			assert.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)

			// id=2 must be filtered out because filterById=1.
			require.NoError(t, xEnv.NatsConnectionDefault.Publish(subject,
				[]byte(`{"id":2,"__typename":"Employee"}`)))
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			// id=1 must pass the filter again.
			require.NoError(t, xEnv.NatsConnectionDefault.Publish(subject,
				[]byte(`{"id":1,"__typename":"Employee"}`)))
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.NoError(t, json.Unmarshal(msg.Payload, &payload))
			assert.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID,
				"only id=1 should pass when filterById=1")
		})
	})

	t.Run("filterById variable absent from variables map -> bypass passes all events", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: cfg,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketServerReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// `$filterById` is declared on the operation but never supplied through
			// the `variables` map. This is the canonical "customer did not provide
			// the optional argument" case from Linear ENG-9357.
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "subscribe",
				Payload: []byte(
					`{"query":"subscription FilterByIdMaybe($filterById: Int) { filteredEmployeeUpdated(id: 1, filterById: $filterById) { id } }"}`,
				),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			subject := xEnv.GetPubSubName("employeeUpdated.1")
			xEnv.NATSPublishUntilReceived(
				xEnv.NatsConnectionDefault, subject,
				[]byte(`{"id":1,"__typename":"Employee"}`), 1, EventWaitTimeout,
			)

			var msg testenv.WebSocketMessage
			var payload subscriptionPayload
			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.NoError(t, json.Unmarshal(msg.Payload, &payload))
			assert.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)

			received := []float64{1}
			for i := 2; i <= 5; i++ {
				require.NoError(t, xEnv.NatsConnectionDefault.Publish(subject,
					[]byte(fmt.Sprintf(`{"id":%d,"__typename":"Employee"}`, i))))
				require.NoError(t, xEnv.NatsConnectionDefault.Flush())

				require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
				require.NoError(t, json.Unmarshal(msg.Payload, &payload))
				received = append(received, payload.Data.FilteredEmployeeUpdated.ID)
			}
			assert.Equal(t, []float64{1, 2, 3, 4, 5}, received)
		})
	})

	t.Run("explicit null filterById variable -> bypass passes all events", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: cfg,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketServerReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "subscribe",
				Payload: []byte(
					`{"query":"subscription FilterByIdMaybe($filterById: Int) { filteredEmployeeUpdated(id: 1, filterById: $filterById) { id } }",` +
						`"variables":{"filterById":null}}`,
				),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			subject := xEnv.GetPubSubName("employeeUpdated.1")
			xEnv.NATSPublishUntilReceived(
				xEnv.NatsConnectionDefault, subject,
				[]byte(`{"id":1,"__typename":"Employee"}`), 1, EventWaitTimeout,
			)

			var msg testenv.WebSocketMessage
			var payload subscriptionPayload
			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.NoError(t, json.Unmarshal(msg.Payload, &payload))
			assert.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)

			// Even ids that would normally be filtered must arrive when filterById is null.
			require.NoError(t, xEnv.NatsConnectionDefault.Publish(subject,
				[]byte(`{"id":42,"__typename":"Employee"}`)))
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.NoError(t, json.Unmarshal(msg.Payload, &payload))
			assert.Equal(t, float64(42), payload.Data.FilteredEmployeeUpdated.ID,
				"explicit null filterById should bypass the filter")
		})
	})

	t.Run("filterById set to non-matching value drops events", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: cfg,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketServerReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "subscribe",
				Payload: []byte(
					`{"query":"subscription { filteredEmployeeUpdated(id: 1, filterById: 99) { id } }"}`,
				),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			subject := xEnv.GetPubSubName("employeeUpdated.1")

			// Warm up the pipeline with a payload the filter accepts.
			xEnv.NATSPublishUntilReceived(
				xEnv.NatsConnectionDefault, subject,
				[]byte(`{"id":99,"__typename":"Employee"}`), 1, EventWaitTimeout,
			)

			var msg testenv.WebSocketMessage
			var payload subscriptionPayload
			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.NoError(t, json.Unmarshal(msg.Payload, &payload))
			assert.Equal(t, float64(99), payload.Data.FilteredEmployeeUpdated.ID)

			// id=1 must be filtered out.
			require.NoError(t, xEnv.NatsConnectionDefault.Publish(subject,
				[]byte(`{"id":1,"__typename":"Employee"}`)))
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			// Bridge to a second matching event so we can assert ordering: anything
			// that arrives between the two id=99 events should not include id=1.
			require.NoError(t, xEnv.NatsConnectionDefault.Publish(subject,
				[]byte(`{"id":99,"__typename":"Employee"}`)))
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			require.NoError(t, testenv.WSReadJSON(t, conn, &msg))
			require.NoError(t, json.Unmarshal(msg.Payload, &payload))
			assert.Equal(t, float64(99), payload.Data.FilteredEmployeeUpdated.ID,
				"only id=99 events should pass when filterById=99")

			// One last sanity check: no buffered id=1 events leak through later.
			ctx, cancel := context.WithTimeout(xEnv.Context, 500*time.Millisecond)
			defer cancel()
			done := make(chan testenv.WebSocketMessage, 1)
			go func() {
				var unexpected testenv.WebSocketMessage
				if err := conn.ReadJSON(&unexpected); err == nil {
					done <- unexpected
				}
			}()
			select {
			case unexpected := <-done:
				t.Fatalf("unexpected message arrived after filtered events: %+v", unexpected)
			case <-ctx.Done():
				// no further messages — filter held.
			}
		})
	})
}
