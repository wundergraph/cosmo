package cursors

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"maps"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

type subscriptionTransport string

const (
	subscriptionTransportWS  subscriptionTransport = "ws"
	subscriptionTransportSSE subscriptionTransport = "sse"
	EventWaitTimeout                               = time.Second * 30
)

var (
	kafkaTopics         = []string{"employeeUpdated", "employeeUpdatedTwo"}
	availableTransports = []subscriptionTransport{subscriptionTransportWS, subscriptionTransportSSE}
)

// newKafkaRouterConfig returns a fresh config per testenv.Run, because the test environment
// writes to the config it is given and the tests run in parallel.
func newKafkaRouterConfig() *testenv.Config {
	return &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
		EnableKafka:              true,
	}
}

func TestCursors_HappyPath(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("resuming from a cursor delivers the messages missed while disconnected", func(t *testing.T) {
		t.Parallel()

		t.Run("kafka", func(t *testing.T) {
			t.Parallel()

			for _, transport := range availableTransports {
				t.Run(string(transport), func(t *testing.T) {
					t.Parallel()

					testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
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

	t.Run("only the resuming client receives the missed messages", func(t *testing.T) {
		t.Parallel()

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
					events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)
					client := createAndSubscribe(t, xEnv, transport).WithClient("1", nil).Client(0)

					xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)
					cursor := readCursorNext(t, client, "1", 1)

					client.complete(t, "1")
					client.close(t)
					xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

					// messages missed while no client was connected
					events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(2))
					events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(3))

					// two new clients that do not resume
					fresh := createAndSubscribe(t, xEnv, transport).
						WithClient("a", nil).
						WithClient("b", nil)

					// one client that resumes from the cursor of the first message
					resumingClient := newCursorClient(t, xEnv, transport, nil)
					t.Cleanup(func() { resumingClient.close(t) })
					subscribeWithCursors(t, resumingClient, "resuming", cursor)
					xEnv.WaitForSubscriptionCount(3, EventWaitTimeout)

					// the resuming client first receives the missed messages, in order
					readCursorNext(t, resumingClient, "resuming", 2)
					readCursorNext(t, resumingClient, "resuming", 3)

					// a new message reaches all three clients
					xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(4), 1, EventWaitTimeout)

					// the non-resuming clients get only the new message, not the missed ones
					readCursorNext(t, fresh.Client(0), "a", 4)
					readCursorNext(t, fresh.Client(1), "b", 4)

					// the resuming client gets the new message after the missed ones
					readCursorNext(t, resumingClient, "resuming", 4)
				})
			})
		}
	})

	t.Run("resuming from a cursor with a different selection set on the same root field", func(t *testing.T) {
		t.Parallel()

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
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
		t.Parallel()

		// Start two subscriptions on one conn on the router. One wants cursors, the other one not.
		// Assert that only the first subscription gets the cursor.
		testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
			events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)

			client := newCursorClient(t, xEnv, subscriptionTransportWS, nil)
			t.Cleanup(func() { client.close(t) })

			// sub-1 asks for cursors, sub-2 does not
			subscribeWithCursors(t, client, "sub-1", "")
			client.subscribe(t, "sub-2", cursorSubscription, map[string]string{})
			xEnv.WaitForSubscriptionCount(2, EventWaitTimeout)
			xEnv.WaitForTriggerCount(2, EventWaitTimeout)

			// The two subscriptions have different extensions, so they are separate triggers with
			// separate Kafka consumers. KafkaPublishUntilReceived returns once one of them delivered,
			// the other consumer may not have been assigned its partition yet and miss the message.
			// So collect messages in the background and publish again until both have received one.
			type received struct {
				id      string
				payload cursorNextPayload
			}
			messages := make(chan received, 16)
			conn := client.(*wsCursorClient).conn
			go func() {
				for {
					var msg testenv.WebSocketMessage
					if err := conn.ReadJSON(&msg); err != nil {
						return // the connection was closed by the cleanup
					}
					var payload cursorNextPayload
					if msg.Type == "next" && json.Unmarshal(msg.Payload, &payload) == nil {
						messages <- received{id: msg.ID, payload: payload}
					}
				}
			}()

			xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)

			// both subscriptions receive the message, in no particular order
			cursors := map[string]string{}
			deadline := time.After(EventWaitTimeout)
			for len(cursors) < 2 {
				select {
				case msg := <-messages:
					require.JSONEq(t, `{"employeeUpdatedMyKafkaCursors":{"id":1}}`, string(msg.payload.Data))
					// a republished message can be delivered again to a subscription that already got one
					if _, seen := cursors[msg.id]; !seen {
						cursors[msg.id] = msg.payload.Extensions.StreamsCursor
					}
				case <-time.After(2 * time.Second):
					events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(1))
				case <-deadline:
					t.Fatalf("timed out waiting for both subscriptions to receive a message, got %v", cursors)
				}
			}

			require.Len(t, cursors, 2)
			require.Contains(t, cursors, "sub-1")
			require.Contains(t, cursors, "sub-2")
			require.NotEmpty(t, cursors["sub-1"], "sub-1 asked for cursors")
			require.Empty(t, cursors["sub-2"], "sub-2 did not ask for cursors")
		})
	})

	// An expired key is only a signing cutoff: it stops signing new cursors,
	// but cursors it signed before stay valid as long as the key is configured.
	t.Run("cursors signed by an expired key stay valid, new cursors are signed by the next key", func(t *testing.T) {
		t.Parallel()

		secret := func(s string) string { return "router-tests-cursor-secret-" + s }

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				// The key expires at an absolute time that is fixed when the router starts, so the
				// first cursor is only signed by key 2 if startup and subscribing were faster than
				// the key lifetime. How long that takes depends on the load of the machine, so a
				// run that was too slow is thrown away and repeated with a doubled lifetime.
				keyLifetime := 3 * time.Second
				for attempt := 1; ; attempt++ {
					if tooSlow := runExpiredKeyAttempt(t, transport, secret, keyLifetime); !tooSlow {
						return
					}
					require.Less(t, attempt, 6, "router was too slow to issue a cursor before the key expired")
					keyLifetime *= 2
				}
			})
		}
	})
}

func TestCursors_InvalidCursors(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("router rejects garbage cursors", func(t *testing.T) {
		t.Parallel()

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
					events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)

					client := newCursorClient(t, xEnv, transport, nil)
					t.Cleanup(func() { client.close(t) })
					subscribeWithCursors(t, client, "1", "!!!@@@###")
					require.Equal(t, "CURSOR_INVALID", client.readErrorCode(t, "1"))
				})
			})
		}
	})

	t.Run("cursors are bound to their authenticated client", func(t *testing.T) {
		t.Parallel()

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

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
		t.Parallel()

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
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

	t.Run("router rejects cursors older than max_resume_window", func(t *testing.T) {
		t.Parallel()

		const maxResumeWindow = time.Second

		newWindowRouterConfig := func() *testenv.Config {
			return &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
				EnableKafka:              true,
				ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
					cfg.DeliveryGuarantees.CursorResume.MaxResumeWindow = maxResumeWindow
				},
			}
		}

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, newWindowRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
					events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)
					client := createAndSubscribe(t, xEnv, transport).WithClient("1", nil).Client(0)

					xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)
					cursor := readCursorNext(t, client, "1", 1)

					client.complete(t, "1")
					client.close(t)
					xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

					// let the cursor age out of the resume window
					time.Sleep(maxResumeWindow + 500*time.Millisecond)

					resumingClient := newCursorClient(t, xEnv, transport, nil)
					t.Cleanup(func() { resumingClient.close(t) })
					subscribeWithCursors(t, resumingClient, "2", cursor)
					require.Equal(t, "CURSOR_EXPIRED", resumingClient.readErrorCode(t, "2"))
				})
			})
		}
	})

	// The cursors are well-formed and signed, but with a keyring the router does not have.
	t.Run("made-up cursors are rejected", func(t *testing.T) {
		t.Parallel()

		// the router is configured with key 1 and a different secret
		fakeKeys := map[string]datasource.CursorKey{
			"known key id, wrong secret": {ID: 1, Secret: bytes.Repeat([]byte("x"), 32)},
			"unknown key id":             {ID: 9, Secret: bytes.Repeat([]byte("y"), 32)},
		}

		for name, fakeKey := range fakeKeys {
			t.Run(name, func(t *testing.T) {
				t.Parallel()

				for _, transport := range availableTransports {
					t.Run(string(transport), func(t *testing.T) {
						t.Parallel()

						testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
							events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)

							codec, err := datasource.NewCursorCodec([]datasource.CursorKey{fakeKey}, 0)
							require.NoError(t, err)
							// the request data is part of the signature, which is wrong in any case
							madeUpCursor, err := codec.Issue(&streamsv1.Cursor{
								ProviderId: "my-kafka",
								Position: &streamsv1.Cursor_Kafka{Kafka: &streamsv1.KafkaCursorPosition{
									Topics: map[string]*streamsv1.KafkaPartitionPositions{
										kafkaTopics[0]: {},
									},
								}},
							}, []byte("made-up"), datasource.ClientIdentity{})
							require.NoError(t, err)

							client := newCursorClient(t, xEnv, transport, nil)
							t.Cleanup(func() { client.close(t) })
							subscribeWithCursors(t, client, "1", madeUpCursor)
							require.Equal(t, "CURSOR_INVALID", client.readErrorCode(t, "1"))
						})
					})
				}
			})
		}
	})
}

func TestCursors_Negotiation(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Run("router rejects clients who want cursors on non-cursor EDFS subscriptions", func(t *testing.T) {
		t.Parallel()

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
					events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)

					client := newCursorClient(t, xEnv, transport, nil)
					t.Cleanup(func() { client.close(t) })
					subscribeQueryWithCursors(t, client, "1", nonCursorSubscription, "")
					require.Equal(t, "DELIVERY_GUARANTEE_UNSUPPORTED", client.readErrorCode(t, "1"))
				})
			})
		}
	})

	t.Run("router ignores clients wish fors cursors on non-EDFS subscriptions", func(t *testing.T) {
		t.Parallel()

		for _, transport := range availableTransports {
			t.Run(string(transport), func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, newKafkaRouterConfig(), func(t *testing.T, xEnv *testenv.Environment) {
					client := newCursorClient(t, xEnv, transport, nil)
					t.Cleanup(func() { client.close(t) })
					subscribeQueryWithCursors(t, client, "1", nonEdfsSubscription, "")

					// the subscription works as usual, but no cursor is issued
					gotID, payload := client.readNext(t)
					require.Equal(t, "1", gotID)
					require.JSONEq(t, `{"countEmp":0}`, string(payload.Data))
					require.Empty(t, payload.Extensions.StreamsCursor)
				})
			})
		}
	})
}

// runExpiredKeyAttempt runs the expired key scenario with a key that expires keyLifetime after the router
// config is built. It returns true without asserting anything if key 2 expired before it signed the first
// cursor, which only says that the attempt was too slow, not that the router is wrong.
func runExpiredKeyAttempt(t *testing.T, transport subscriptionTransport, secret func(string) string, keyLifetime time.Duration) (tooSlow bool) {
	// key 2 has the highest id, so it signs until it expires, then key 1 takes over
	var expiresAt time.Time
	expiringRouterConfig := &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
		EnableKafka:              true,
		ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
			expiresAt = time.Now().Add(keyLifetime)
			cfg.DeliveryGuarantees.CursorResume.Keys = []config.CursorKeyConfiguration{
				{ID: 1, Secret: secret("0123456789-one")},
				{ID: 2, Secret: secret("0123456789-two"), ExpiresAt: expiresAt},
			}
		},
	}

	testenv.Run(t, expiringRouterConfig, func(t *testing.T, xEnv *testenv.Environment) {
		keyID := func(cursor string) byte {
			raw, err := base64.RawURLEncoding.DecodeString(cursor)
			require.NoError(t, err)
			return raw[1] // wire format: version | keyID | payload | tag
		}

		events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, kafkaTopics...)
		client := createAndSubscribe(t, xEnv, transport).WithClient("1", nil).Client(0)

		xEnv.KafkaPublishUntilReceived(kafkaTopics[0], employeeMessage(1), 1, EventWaitTimeout)
		cursor := readCursorNext(t, client, "1", 1)

		// Compare against the clock after the cursor was read: it was issued before this point,
		// so if the key is still valid now it was valid when the cursor was signed.
		if !time.Now().Before(expiresAt) {
			client.complete(t, "1")
			client.close(t)
			tooSlow = true
			return
		}
		require.Equal(t, byte(2), keyID(cursor))

		client.complete(t, "1")
		client.close(t)
		xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

		events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, kafkaTopics[0], employeeMessage(2))

		time.Sleep(time.Until(expiresAt) + 500*time.Millisecond)

		// the cursor of the expired key still resumes, and the new cursor is signed by key 1
		resumingClient := newCursorClient(t, xEnv, transport, nil)
		t.Cleanup(func() { resumingClient.close(t) })
		subscribeWithCursors(t, resumingClient, "2", cursor)
		xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

		newCursor := readCursorNext(t, resumingClient, "2", 2)
		require.Equal(t, byte(1), keyID(newCursor))
	})
	return tooSlow
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

// nonCursorSubscription is an EDFS Kafka subscription whose field does not enable the cursor delivery guarantee.
const nonCursorSubscription = `subscription { employeeUpdatedMyKafka(employeeID: 1) { id } }`

// nonEdfsSubscription is a subscription served by a regular subgraph.
const nonEdfsSubscription = `subscription { countEmp(max: 1, intervalMilliseconds: 100) }`

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
	maps.Copy(req.Header, c.header)
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
