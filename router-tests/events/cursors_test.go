package events_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
)

func TestCursors(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	kafkaTopics := []string{"employeeUpdated", "employeeUpdatedTwo"}
	kafkaRouterConfig := &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
		EnableKafka:              true,
	}

	availableTransports := []subscriptionTransport{subscriptionTransportWS, subscriptionTransportSSE}

	t.Run("happy path", func(t *testing.T) {
		t.Run("resuming from a cursor delivers the messages missed while disconnected", func(t *testing.T) {
			t.Run("kafka", func(t *testing.T) {
				for _, transport := range availableTransports {
					t.Run(string(transport), func(t *testing.T) {
						testenv.Run(t, kafkaRouterConfig, func(t *testing.T, xEnv *testenv.Environment) {
							events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)
							client := createAndSubscribe(t, xEnv, transport).WithClient("1", nil).Client(0)

							xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)
							firstCursor := readCursorNext(t, client, "1", 1)

							events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(2))
							secondCursor := readCursorNext(t, client, "1", 2)
							require.NotEqual(t, firstCursor, secondCursor)

							client.complete(t, "1")
							client.close(t)
							xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

							events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(3))
							events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(4))

							// recreate client but with secondCursor to resume from there
							resumingClient := newCursorClient(t, xEnv, transport, nil)
							t.Cleanup(func() { resumingClient.close(t) })
							subscribeWithCursors(t, resumingClient, "2", secondCursor)
							xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

							// read next messages + cursors and check they are the correct ones
							thirdCursor := readCursorNext(t, resumingClient, "2", 3)
							fourthCursor := readCursorNext(t, resumingClient, "2", 4)
							require.NotEqual(t, thirdCursor, fourthCursor)
							require.NotEqual(t, secondCursor, thirdCursor)
						})
					})
				}
			})
		})

		t.Run("resuming from a cursor with a different selection set on the same root field", func(t *testing.T) {
			for _, transport := range availableTransports {
				t.Run(string(transport), func(t *testing.T) {
					testenv.Run(t, kafkaRouterConfig, func(t *testing.T, xEnv *testenv.Environment) {
						events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)
						client := createAndSubscribe(t, xEnv, transport).WithClient("1", nil).Client(0)

						xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)
						cursor := readCursorNext(t, client, "1", 1)

						client.complete(t, "1")
						client.close(t)
						xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

						events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(2))

						// resume with the cursor, but select one more field
						resumingClient := newCursorClient(t, xEnv, transport, nil)
						t.Cleanup(func() { resumingClient.close(t) })
						subscribeQueryWithCursors(t, resumingClient, "2", cursorSubscriptionWithDetails, cursor)
						xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

						gotID, payload := resumingClient.readNext(t)
						require.Equal(t, "2", gotID)
						require.NotEmpty(t, payload.Extensions.StreamsCursor)

						var data struct {
							Employee struct {
								ID      int `json:"id"`
								Details struct {
									Forename string `json:"forename"`
								} `json:"details"`
							} `json:"employeeUpdatedMyKafkaCursors"`
						}
						require.NoError(t, json.Unmarshal(payload.Data, &data))
						require.Equal(t, 2, data.Employee.ID)
						require.NotEmpty(t, data.Employee.Details.Forename)
					})
				})
			}
		})

		t.Run("only the subscription that asked for cursors receives them", func(t *testing.T) {
			// Start two subscriptions on one conn on the router. One wants cursors, the other one not.
			// Assert that only the first subscription gets the cursor.
			testenv.Run(t, kafkaRouterConfig, func(t *testing.T, xEnv *testenv.Environment) {
				events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)

				client := newCursorClient(t, xEnv, subscriptionTransportWS, nil)
				t.Cleanup(func() { client.close(t) })

				// sub-1 asks for cursors, sub-2 does not
				subscribeWithCursors(t, client, "sub-1", "")
				client.subscribe(t, "sub-2", cursorSubscription, map[string]string{})
				xEnv.WaitForSubscriptionCount(2, EventWaitTimeout)
				xEnv.WaitForTriggerCount(2, EventWaitTimeout)

				xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)

				// both subscriptions receive the message, in no particular order
				cursors := map[string]string{}
				for range 2 {
					id, payload := client.readNext(t)
					require.JSONEq(t, `{"employeeUpdatedMyKafkaCursors":{"id":1}}`, string(payload.Data))
					cursors[id] = payload.Extensions.StreamsCursor
				}

				require.Len(t, cursors, 2)
				require.Contains(t, cursors, "sub-1")
				require.Contains(t, cursors, "sub-2")
				require.NotEmpty(t, cursors["sub-1"], "sub-1 asked for cursors")
				require.Empty(t, cursors["sub-2"], "sub-2 did not ask for cursors")
			})
		})
	})

	t.Run("invalid cursors", func(t *testing.T) {
		t.Run("cursors are bound to their authenticated client", func(t *testing.T) {
			for _, transport := range availableTransports {
				t.Run(string(transport), func(t *testing.T) {
					authenticators, authServer := testutils.ConfigureAuth(t)
					accessController, err := core.NewAccessController(core.AccessControllerOptions{
						Authenticators:         authenticators,
						AuthenticationRequired: true,
					})
					require.NoError(t, err)

					jwtRouterConfig := &testenv.Config{
						RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
						EnableKafka:              true,
						RouterOptions:            []core.Option{core.WithAccessController(accessController)},
					}

					testenv.Run(t, jwtRouterConfig, func(t *testing.T, xEnv *testenv.Environment) {
						headerFor := func(subject string) http.Header {
							token, err := authServer.Token(map[string]any{"sub": subject})
							require.NoError(t, err)
							return http.Header{"Authorization": []string{"Bearer " + token}}
						}

						events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)

						clients := createAndSubscribe(t, xEnv, transport).
							WithClient("1", headerFor("user-1"))

						xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)
						cursor := readCursorNext(t, clients.Client(0), "1", 1)

						// the cursor of the user-1 must not resume a subscription of user-2
						thief := newCursorClient(t, xEnv, transport, headerFor("user-2"))
						t.Cleanup(func() { thief.close(t) })
						subscribeWithCursors(t, thief, "2", cursor)
						require.Equal(t, "CURSOR_CLIENT_MISMATCH", thief.readErrorCode(t, "2"))
					})
				})
			}
		})

		t.Run("resuming from a cursor on a different subscription root field is rejected", func(t *testing.T) {
			for _, transport := range availableTransports {
				t.Run(string(transport), func(t *testing.T) {
					testenv.Run(t, kafkaRouterConfig, func(t *testing.T, xEnv *testenv.Environment) {
						events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)
						client := createAndSubscribe(t, xEnv, transport).WithClient("1", nil).Client(0)

						xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)
						cursor := readCursorNext(t, client, "1", 1)

						client.complete(t, "1")
						client.close(t)
						xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

						// resume with the cursor, but on another root field
						resumingClient := newCursorClient(t, xEnv, transport, nil)
						t.Cleanup(func() { resumingClient.close(t) })
						subscribeQueryWithCursors(t, resumingClient, "2", otherRootFieldSubscription, cursor)
						require.Equal(t, "CURSOR_INVALID", resumingClient.readErrorCode(t, "2"))
					})
				})
			}
		})
	})
}

// cursorNextPayload is the payload of a graphql-transport-ws next message
// of a subscription that negotiated the cursor delivery guarantee.
type cursorNextPayload struct {
	Data       json.RawMessage `json:"data"`
	Extensions struct {
		StreamsCursor string `json:"streamsCursor"`
	} `json:"extensions"`
}

const cursorSubscription = `subscription { employeeUpdatedMyKafkaCursors(employeeID: 1) { id } }`

// otherRootFieldSubscription subscribes to a different root field than cursorSubscription.
const otherRootFieldSubscription = `subscription { employeeUpdatedMyKafkaCursorsTwo(employeeID: 1) { id details { forename } } }`

// cursorSubscriptionWithDetails has the same root field as cursorSubscription but selects one more field.
const cursorSubscriptionWithDetails = `subscription { employeeUpdatedMyKafkaCursors(employeeID: 1) { id details { forename } } }`

// cursorClient is a client of the cursor-enabled Kafka field, independent of the transport.
type cursorClient interface {
	// subscribe subscribes under id with the given query and request extensions. An SSE connection carries
	// a single subscription, so it only remembers id for the messages it reads.
	subscribe(t *testing.T, id string, query string, extensions map[string]string)
	// readNext reads the next message, asserts it is a next message and returns the id of its
	// subscription and its payload.
	readNext(t *testing.T) (string, cursorNextPayload)
	// readErrorCode reads the next message, asserts it is a terminal error of subscription id
	// and returns the code of its first error.
	readErrorCode(t *testing.T, id string) string
	// complete stops subscription id.
	complete(t *testing.T, id string)
	// close closes the connection.
	close(t *testing.T)
}

// newCursorClient opens a connection of the given transport, "ws" or "sse".
func newCursorClient(t *testing.T, xEnv *testenv.Environment, transport subscriptionTransport, header http.Header) cursorClient {
	t.Helper()

	switch transport {
	case subscriptionTransportWS:
		return &wsCursorClient{conn: xEnv.InitGraphQLWebSocketConnection(header, nil, nil)}
	case subscriptionTransportSSE:
		ctx, cancel := context.WithTimeout(xEnv.Context, EventWaitTimeout)
		return &sseCursorClient{xEnv: xEnv, header: header, ctx: ctx, cancel: cancel}
	default:
		t.Fatalf("unknown transport %q", transport)
		return nil
	}
}

type wsCursorClient struct {
	conn *websocket.Conn
}

func (c *wsCursorClient) subscribe(t *testing.T, id string, query string, extensions map[string]string) {
	t.Helper()

	payload, err := json.Marshal(map[string]any{"query": query, "extensions": extensions})
	require.NoError(t, err)
	require.NoError(t, testenv.WSWriteJSON(t, c.conn, testenv.WebSocketMessage{ID: id, Type: "subscribe", Payload: payload}))
}

func (c *wsCursorClient) readNext(t *testing.T) (string, cursorNextPayload) {
	t.Helper()

	var msg testenv.WebSocketMessage
	require.NoError(t, testenv.WSReadJSON(t, c.conn, &msg))
	require.Equal(t, "next", msg.Type, "unexpected message: %s", msg.Payload)

	var payload cursorNextPayload
	require.NoError(t, json.Unmarshal(msg.Payload, &payload))
	return msg.ID, payload
}

func (c *wsCursorClient) readErrorCode(t *testing.T, id string) string {
	t.Helper()

	var msg testenv.WebSocketMessage
	require.NoError(t, testenv.WSReadJSON(t, c.conn, &msg))
	require.Equal(t, "error", msg.Type, "unexpected message: %s", msg.Payload)
	require.Equal(t, id, msg.ID)
	return firstErrorCode(t, msg.Payload)
}

func (c *wsCursorClient) complete(t *testing.T, id string) {
	t.Helper()

	require.NoError(t, testenv.WSWriteJSON(t, c.conn, testenv.WebSocketMessage{ID: id, Type: "complete"}))
}

func (c *wsCursorClient) close(t *testing.T) {
	t.Helper()

	// The connection may already be closed, as close is also registered as a cleanup.
	_ = c.conn.Close()
}

// sseCursorClient carries a single subscription: the GET request that opens the event stream.
type sseCursorClient struct {
	xEnv   *testenv.Environment
	header http.Header
	ctx    context.Context
	cancel context.CancelFunc

	id     string
	respCh chan *http.Response
	body   *bufio.Reader
	resp   *http.Response
}

func (c *sseCursorClient) subscribe(t *testing.T, id string, query string, extensions map[string]string) {
	t.Helper()
	require.Nil(t, c.respCh, "an SSE connection carries a single subscription")

	rawExtensions, err := json.Marshal(extensions)
	require.NoError(t, err)

	q := url.Values{}
	q.Set("query", query)
	q.Set("extensions", string(rawExtensions))

	req, err := http.NewRequestWithContext(c.ctx, http.MethodGet, c.xEnv.GraphQLRequestURL()+"?"+q.Encode(), nil)
	require.NoError(t, err)
	for k, v := range c.header {
		req.Header[k] = v
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Accept-Encoding", "identity")

	// The router may only send the response headers together with the first event,
	// so the request must not block the caller.
	c.id = id
	c.respCh = make(chan *http.Response, 1)
	go func() {
		resp, err := c.xEnv.RouterClient.Do(req)
		if err != nil {
			close(c.respCh)
			return
		}
		c.respCh <- resp
	}()
}

// openBody waits for the response headers of the event stream.
func (c *sseCursorClient) openBody(t *testing.T) {
	t.Helper()
	require.NotNil(t, c.respCh, "subscribe first")

	if c.body == nil {
		resp, ok := <-c.respCh
		require.True(t, ok, "could not open the event stream")
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
		c.resp = resp
		c.body = bufio.NewReader(resp.Body)
	}
}

func (c *sseCursorClient) readNext(t *testing.T) (string, cursorNextPayload) {
	t.Helper()
	c.openBody(t)

	require.Equal(t, "event: next", testenv.ReadSSEField(t, c.body))
	data, ok := strings.CutPrefix(testenv.ReadSSEField(t, c.body), "data: ")
	require.True(t, ok, "expected a data field")

	var payload cursorNextPayload
	require.NoError(t, json.Unmarshal([]byte(data), &payload))
	return c.id, payload
}

func (c *sseCursorClient) readErrorCode(t *testing.T, id string) string {
	t.Helper()
	require.Equal(t, id, c.id)
	c.openBody(t)

	require.Equal(t, "event: next", testenv.ReadSSEField(t, c.body))
	data, ok := strings.CutPrefix(testenv.ReadSSEField(t, c.body), "data: ")
	require.True(t, ok, "expected a data field")
	return firstErrorCode(t, []byte(data))
}

// firstErrorCode returns the extensions code of the first error of a GraphQL response or error list.
func firstErrorCode(t *testing.T, raw []byte) string {
	t.Helper()

	type gqlError struct {
		Extensions struct {
			Code string `json:"code"`
		} `json:"extensions"`
	}
	var list []gqlError
	if err := json.Unmarshal(raw, &list); err != nil {
		var resp struct {
			Errors []gqlError `json:"errors"`
		}
		require.NoError(t, json.Unmarshal(raw, &resp), "unexpected payload: %s", raw)
		list = resp.Errors
	}
	require.NotEmpty(t, list, "unexpected payload: %s", raw)
	return list[0].Extensions.Code
}

// complete ends the stream, as the client closing the request is how an SSE subscription stops.
func (c *sseCursorClient) complete(t *testing.T, _ string) {
	t.Helper()

	c.close(t)
}

func (c *sseCursorClient) close(t *testing.T) {
	t.Helper()

	c.cancel()
	if c.resp != nil {
		_ = c.resp.Body.Close()
	}
}

// subscribeWithCursors subscribes under id, asking for the cursor delivery guarantee.
// A non-empty resumeCursor resumes the subscription from it.
func subscribeWithCursors(t *testing.T, c cursorClient, id string, resumeCursor string) {
	t.Helper()

	subscribeQueryWithCursors(t, c, id, cursorSubscription, resumeCursor)
}

// subscribeQueryWithCursors is subscribeWithCursors with a custom subscription query.
func subscribeQueryWithCursors(t *testing.T, c cursorClient, id string, query string, resumeCursor string) {
	t.Helper()

	extensions := map[string]string{"cosmoDeliveryGuarantee": "cursor"}
	if resumeCursor != "" {
		extensions["streamsCursor"] = resumeCursor
	}
	c.subscribe(t, id, query, extensions)
}

// readCursorNext reads the next message of subscription id, asserts it carries the employee
// with employeeID and a cursor, and returns the cursor.
func readCursorNext(t *testing.T, c cursorClient, id string, employeeID int) string {
	t.Helper()

	gotID, payload := c.readNext(t)
	require.Equal(t, id, gotID)
	require.JSONEq(t, `{"employeeUpdatedMyKafkaCursors":{"id":`+strconv.Itoa(employeeID)+`}}`, string(payload.Data))
	require.NotEmpty(t, payload.Extensions.StreamsCursor)
	return payload.Extensions.StreamsCursor
}

// employeeMessage is a Kafka message that resolves to the employee with id.
func employeeMessage(id int) string {
	return `{"__typename":"Employee","id":` + strconv.Itoa(id) + `}`
}

type subscriptionTransport string

const (
	subscriptionTransportWS  subscriptionTransport = "ws"
	subscriptionTransportSSE subscriptionTransport = "sse"
)

// subscribedClients are the clients created by createAndSubscribe.
type subscribedClients struct {
	t         *testing.T
	xEnv      *testenv.Environment
	transport subscriptionTransport
	clients   []cursorClient
}

// createAndSubscribe starts building a set of ws/sse clients subscribed to the router.
// Add clients with WithClient and access them with Client.
func createAndSubscribe(t *testing.T, xEnv *testenv.Environment, transport subscriptionTransport) *subscribedClients {
	t.Helper()

	return &subscribedClients{t: t, xEnv: xEnv, transport: transport}
}

// WithClient creates a client that sends header with its connection (nil for an unauthenticated client)
// and subscribes it under subscriptionID. It returns once the client is fully registered on the router.
func (s *subscribedClients) WithClient(subscriptionID string, header http.Header) *subscribedClients {
	s.t.Helper()

	client := newCursorClient(s.t, s.xEnv, s.transport, header)
	s.t.Cleanup(func() { client.close(s.t) })
	subscribeWithCursors(s.t, client, subscriptionID, "")
	s.clients = append(s.clients, client)

	s.xEnv.WaitForSubscriptionCount(uint64(len(s.clients)), EventWaitTimeout)
	s.xEnv.WaitForTriggerCount(1, EventWaitTimeout)

	return s
}

// Client returns the i-th client in the order of the WithClient calls.
func (s *subscribedClients) Client(i int) cursorClient {
	s.t.Helper()
	require.Less(s.t, i, len(s.clients), "no client at index %d", i)

	return s.clients[i]
}
