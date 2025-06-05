package events_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

const NatsWaitTimeout = time.Second * 30

func assertNatsLineEquals(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	line, _, err := reader.ReadLine()
	assert.NoError(t, err)
	assert.Equal(t, expected, string(line))
}

func assertNatsMultipartPrefix(t *testing.T, reader *bufio.Reader) {
	t.Helper()
	assertNatsLineEquals(t, reader, "")
	assertNatsLineEquals(t, reader, "--graphql")
	assertNatsLineEquals(t, reader, "Content-Type: application/json")
	assertNatsLineEquals(t, reader, "")
}

func assertNatsMultipartValueEventually(t *testing.T, reader *bufio.Reader, expected string) {
	t.Helper()
	assert.Eventually(t, func() bool {
		assertNatsMultipartPrefix(t, reader)
		line, _, err := reader.ReadLine()
		assert.NoError(t, err)
		if string(line) == "{}" {
			return false
		}
		assert.Equal(t, expected, string(line))
		return true
	}, NatsWaitTimeout, time.Millisecond*100)
}

func TestNatsEvents(t *testing.T) {
	t.Parallel()

	t.Run("subscribe async", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			var subscriptionCalled atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionCalled.Add(1)
				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, resOne.Body)

			assert.Eventually(t, func() bool {
				return subscriptionCalled.Load() == 1
			}, NatsWaitTimeout, time.Millisecond*100)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			var closed atomic.Bool
			go func() {
				defer closed.Store(true)
				assert.Eventually(t, func() bool {
					return subscriptionCalled.Load() == 2
				}, NatsWaitTimeout, time.Millisecond*100)
				assert.NoError(t, client.Close())
			}()

			assert.Eventually(t, closed.Load, NatsWaitTimeout, time.Millisecond*100)

			xEnv.WaitForSubscriptionCount(0, NatsWaitTimeout)
			xEnv.WaitForConnectionCount(0, NatsWaitTimeout)

			natsLogs := xEnv.Observer().FilterMessageSnippet("Nats").All()
			require.Len(t, natsLogs, 4)
			providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "my-nats")).All()
			require.Len(t, providerIDFields, 2)
		})
	})

	t.Run("message and resolve errors should not abort the subscription", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				oldCount := counter.Load()
				defer counter.Add(1)

				if oldCount == 0 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Invalid message received", gqlErr[0].Message)
				} else if oldCount == 1 || oldCount == 3 {
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				} else if oldCount == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdated.id'.", gqlErr[0].Message)
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(``)) // Empty message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, NatsWaitTimeout, time.Millisecond*100)

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, NatsWaitTimeout, time.Millisecond*100)

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","update":{"name":"foo"}}`)) // Missing id
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			require.Eventually(t, func() bool {
				return counter.Load() == 3
			}, NatsWaitTimeout, time.Millisecond*100)

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			require.Eventually(t, func() bool {
				return counter.Load() == 4
			}, NatsWaitTimeout, time.Millisecond*100)

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, NatsWaitTimeout)
			xEnv.WaitForConnectionCount(0, NatsWaitTimeout)
		})
	})

	t.Run("subscribe async netPoll disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableNetPoll = false
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			var subscription struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)

				require.NoError(t, errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Wait longer than the read timeout to ensure that read timeouts are handled correctly
			time.Sleep(time.Millisecond * 200)

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			require.Eventually(t, func() bool {
				return counter.Load() == 2
			}, NatsWaitTimeout, time.Millisecond*100)

			require.NoError(t, client.Close())

			xEnv.WaitForMessagesSent(2, NatsWaitTimeout)
			xEnv.WaitForSubscriptionCount(0, NatsWaitTimeout)
			xEnv.WaitForConnectionCount(0, NatsWaitTimeout)
		})
	})

	t.Run("multipart", func(t *testing.T) {
		t.Parallel()

		heartbeatInterval := 150 * time.Millisecond

		t.Run("subscribe with multipart responses", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				RouterOptions: []core.Option{
					core.WithMultipartHeartbeatInterval(heartbeatInterval),
				},
				EnableNats: true,
				TLSConfig: &core.TlsConfig{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

				var produced atomic.Uint32
				var consumed atomic.Uint32

				go func() {
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := xEnv.RouterClient.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					require.Equal(t, "multipart/mixed; subscriptionSpec=1.0; boundary=graphql", resp.Header.Get("Content-Type"))
					require.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
					require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"))

					require.Equal(t, []string(nil), resp.TransferEncoding)

					reader := bufio.NewReader(resp.Body)

					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}}")
					consumed.Add(1)

					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}}")
					consumed.Add(1)
				}()

				xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

				// Send a mutation to trigger the subscription

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
				})
				require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

				require.Eventually(t, func() bool {
					return consumed.Load() == 1
				}, NatsWaitTimeout, time.Millisecond*100)

				// Trigger the subscription via NATS
				err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
				produced.Add(1)

				require.Eventually(t, func() bool {
					return consumed.Load() == 2
				}, NatsWaitTimeout, time.Millisecond*100)
			})
		})

		t.Run("subscribe with multipart responses http and consume healthcheck only", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				TLSConfig:                nil, // Force Http/1
				RouterOptions: []core.Option{
					core.WithMultipartHeartbeatInterval(heartbeatInterval),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

				var counter atomic.Uint32

				client := &http.Client{}

				go func() {
					defer counter.Add(1)

					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					require.Equal(t, []string{"chunked"}, resp.TransferEncoding)

					reader := bufio.NewReader(resp.Body)

					// Read the first part
					assertNatsMultipartPrefix(t, reader)
					assertNatsLineEquals(t, reader, "{}")
				}()

				xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

				require.Eventually(t, func() bool {
					return counter.Load() == 1
				}, NatsWaitTimeout, time.Millisecond*100)
			})
		})

		t.Run("subscribe with closing channel", func(t *testing.T) {

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 3) }"}`)

				var done atomic.Bool

				go func() {
					defer done.Store(true)

					client := http.Client{}
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					reader := bufio.NewReader(resp.Body)

					// Read the first part
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":0}}}")
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":1}}}")
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":2}}}")
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":3}}}")
					assertNatsLineEquals(t, reader, "--graphql--")
				}()

				xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)
				require.Eventually(t, done.Load, NatsWaitTimeout, time.Millisecond*100)
			})
		})

		t.Run("should block subscribe sync multipart operation", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
						Enabled: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				queries := [][]byte{
					[]byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`),
					[]byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id details { forename surname } }}"}`),
				}

				for _, subscribePayload := range queries {
					client := http.Client{}

					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					req.Header.Set("Cache-Control", "no-cache")

					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()
					reader := bufio.NewReader(resp.Body)

					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}}")
				}
			})
		})
		t.Run("subscribe after message don't a boundary", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				RouterOptions: []core.Option{
					core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
						SubscriptionMultipartPrintBoundary: config.ApolloCompatibilitySubscriptionMultipartPrintBoundary{
							Enabled: false,
						},
					}),
				},
				EnableNats: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 0) }"}`)

				var done atomic.Bool

				go func() {
					defer done.Store(true)

					client := http.Client{}
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					reader := bufio.NewReader(resp.Body)

					// Read the first part

					expected := "\r\n--graphql\r\nContent-Type: application/json\r\n\r\n{\"payload\":{\"data\":{\"countFor\":0}}}\r\n"
					read := make([]byte, len(expected))
					_, err = reader.Read(read)
					assert.NoError(t, err)
					assert.Equal(t, expected, string(read))
				}()

				xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)
				require.Eventually(t, done.Load, NatsWaitTimeout, time.Millisecond*100)
			})
		})

		t.Run("multipart format related new line returns should have a preceding carriage return", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 3) }"}`)

				var done atomic.Bool

				go func() {
					defer done.Store(true)

					client := http.Client{}
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					reader := bufio.NewReader(resp.Body)

					assert.Eventually(t, func() bool {
						allData, err := io.ReadAll(reader)
						if err != nil {
							assert.Fail(t, fmt.Sprintf("failed to read all data: %v", err))
						}
						runes := []rune(string(allData))

						for i := 0; i < len(runes); i++ {
							if runes[i] == '\r' {
								// Validate that this is not a stray \r entry
								if i+1 >= len(runes) || runes[i+1] != '\n' {
									assert.Fail(t, "Invalid newline detected: '\\r' not followed by '\\n'")
								}
								i++
							} else if runes[i] == '\n' {
								// Validate that this is not a stray \n entry
								if i == 0 || runes[i-1] != '\r' {
									assert.Fail(t, "Invalid newline detected: '\\n' not preceded by '\\r'")
								}
							}
						}
						return true
					}, NatsWaitTimeout, time.Millisecond*100)
				}()

				xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)
				require.Eventually(t, done.Load, NatsWaitTimeout, time.Millisecond*100)
			})
		})
	})

	t.Run("multipart with apollo compatibility", func(t *testing.T) {
		t.Parallel()

		t.Run("subscribe after message add a boundary", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				RouterOptions: []core.Option{
					core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
						SubscriptionMultipartPrintBoundary: config.ApolloCompatibilitySubscriptionMultipartPrintBoundary{
							Enabled: true,
						},
					}),
				},
				EnableNats: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 0) }"}`)

				var done atomic.Bool

				go func() {
					defer done.Store(true)

					client := http.Client{}
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					reader := bufio.NewReader(resp.Body)

					// Read the first part

					expected := "\r\n--graphql\r\nContent-Type: application/json\r\n\r\n{\"payload\":{\"data\":{\"countFor\":0}}}\r\n\r\n--graphql"
					read := make([]byte, len(expected))
					_, err = reader.Read(read)
					assert.NoError(t, err)
					assert.Equal(t, expected, string(read))
				}()

				xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)
				require.Eventually(t, done.Load, NatsWaitTimeout, time.Millisecond*100)
			})
		})

		t.Run("subscribe with closing channel", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				RouterOptions: []core.Option{
					core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
						SubscriptionMultipartPrintBoundary: config.ApolloCompatibilitySubscriptionMultipartPrintBoundary{
							Enabled: true,
						},
					}),
				},
				EnableNats: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 3) }"}`)

				var done atomic.Bool

				go func() {
					defer done.Store(true)

					client := http.Client{}
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					reader := bufio.NewReader(resp.Body)

					// Read the first part
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":0}}}")
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":1}}}")
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":2}}}")
					assertNatsMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":3}}}")
					assertNatsLineEquals(t, reader, "")
					assertNatsLineEquals(t, reader, "--graphql--")
				}()

				xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)
				require.Eventually(t, done.Load, NatsWaitTimeout, time.Millisecond*100)
			})
		})
	})

	t.Run("subscribe once", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

			var counter atomic.Uint32

			go func() {
				defer counter.Add(1)

				client := http.Client{}
				xUrl, err := url.Parse(xEnv.GraphQLRequestURL())
				require.NoError(t, err)
				xUrl.RawQuery = core.WgSubscribeOnceParam

				req, err := http.NewRequest(http.MethodPost, xUrl.String(), bytes.NewReader(subscribePayload))
				require.NoError(t, err)

				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Connection", "keep-alive")
				req.Header.Set("Cache-Control", "no-cache")

				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

				require.Equal(t, "text/plain; charset=utf-8", resp.Header.Get("Content-Type"))
				emptyHeaders := []string{"Cache-Control", "Connection", "X-Accel-Buffering"}
				for _, header := range emptyHeaders {
					_, exists := resp.Header[header]
					require.False(t, exists)
				}
				data, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				_, _, err = reader.ReadLine()
				require.Error(t, err, io.EOF) // Subscription closed after one time
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, NatsWaitTimeout, time.Millisecond*100)
		})
	})

	t.Run("subscribe sync sse works without query param", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

			var done atomic.Bool
			var producerDone atomic.Bool

			waitForProducer := func() {
				assert.Eventually(t, producerDone.Load, NatsWaitTimeout, time.Millisecond*100)
				producerDone.Store(false)
			}

			go func() {
				defer done.Store(true)
				client := http.Client{}
				req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
				require.NoError(t, err)

				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept", "text/event-stream")
				req.Header.Set("Connection", "keep-alive")
				req.Header.Set("Cache-Control", "no-cache")

				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

				waitForProducer()
				eventNext, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "event: next", string(eventNext))
				data, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))

				waitForProducer()
				eventNext, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "event: next", string(eventNext))
				data, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)
			err := xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			producerDone.Store(true)

			assert.Eventually(t, func() bool {
				return !producerDone.Load()
			}, NatsWaitTimeout, time.Millisecond*100)

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			producerDone.Store(true)

			require.Eventually(t, done.Load, NatsWaitTimeout, time.Millisecond*100)
		})
	})

	t.Run("should block subscribe sync sse operation", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockSubscriptions = config.BlockOperationConfiguration{
					Enabled: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePayloadOne := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)
			subscribePayloadTwo := []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id details { forename surname } }}"}`)

			client := http.Client{}
			reqOne, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayloadOne))
			require.NoError(t, err)

			reqOne.Header.Set("Content-Type", "application/json")
			reqOne.Header.Set("Accept", "text/event-stream")
			reqOne.Header.Set("Connection", "keep-alive")
			reqOne.Header.Set("Cache-Control", "no-cache")

			respOne, err := client.Do(reqOne)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, respOne.StatusCode)
			defer respOne.Body.Close()

			require.Equal(t, "text/event-stream", respOne.Header.Get("Content-Type"))
			require.Equal(t, "no-cache", respOne.Header.Get("Cache-Control"))
			require.Equal(t, "keep-alive", respOne.Header.Get("Connection"))
			require.Equal(t, "no", respOne.Header.Get("X-Accel-Buffering"))

			readerOne := bufio.NewReader(respOne.Body)

			eventNextOne, _, err := readerOne.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "event: next", string(eventNextOne))
			dataOne, _, err := readerOne.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}", string(dataOne))

			reqTwo, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayloadTwo))
			require.NoError(t, err)

			reqTwo.Header.Set("Content-Type", "application/json")
			reqTwo.Header.Set("Accept", "text/event-stream")
			reqTwo.Header.Set("Connection", "keep-alive")
			reqTwo.Header.Set("Cache-Control", "no-cache")

			respTwo, err := client.Do(reqTwo)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, respTwo.StatusCode)
			defer respTwo.Body.Close()
			readerTwo := bufio.NewReader(respTwo.Body)

			eventNextTwo, _, err := readerTwo.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "event: next", string(eventNextTwo))
			dataTwo, _, err := readerTwo.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}", string(dataTwo))
		})
	})

	t.Run("subscribe sync sse client close", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			firstSubscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)

			var counter atomic.Uint32

			go func() {
				defer counter.Add(1)

				client := http.Client{}
				req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(firstSubscribePayload))
				require.NoError(t, err)

				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept", "text/event-stream")
				req.Header.Set("Connection", "keep-alive")
				req.Header.Set("Cache-Control", "no-cache")

				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
				require.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
				require.Equal(t, "keep-alive", resp.Header.Get("Connection"))
				require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"))

				reader := bufio.NewReader(resp.Body)

				eventNext, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "event: next", string(eventNext))
				data, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Send a mutation to trigger the subscription
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, NatsWaitTimeout, time.Millisecond*100)

			xEnv.WaitForSubscriptionCount(0, NatsWaitTimeout)
			xEnv.WaitForConnectionCount(0, NatsWaitTimeout)
		})
	})

	t.Run("request", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			firstSub, err := xEnv.NatsConnectionDefault.Subscribe(xEnv.GetPubSubName("getEmployee.3"), func(msg *nats.Msg) {
				err := msg.Respond([]byte(`{"id": 3, "__typename": "Employee"}`))
				require.NoError(t, err)
			})
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			secondSub, err := xEnv.NatsConnectionMyNats.Subscribe(xEnv.GetPubSubName("getEmployeeMyNats.12"), func(msg *nats.Msg) {
				err = msg.Respond([]byte(`{"id": 12, "__typename": "Employee"}`))
				require.NoError(t, err)
			})
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionMyNats.Flush())

			t.Cleanup(func() {
				err = firstSub.Unsubscribe()
				require.NoError(t, err)
				err = secondSub.Unsubscribe()
				require.NoError(t, err)
			})

			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employeeFromEvent(id: 3) { id details { forename } }}`,
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"employeeFromEvent": {"id": 3, "details": {"forename": "Stefan"}}}}`, resOne.Body)

			resTwo := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employeeFromEventMyNats(employeeID: 12) { id details { forename } }}`,
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"employeeFromEventMyNats": {"id": 12, "details": {"forename": "David"}}}}`, resTwo.Body)
		})
	})

	t.Run("publish", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			firstSub, err := xEnv.NatsConnectionDefault.SubscribeSync(xEnv.GetPubSubName("employeeUpdatedMyNats.3"))
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			secondSub, err := xEnv.NatsConnectionMyNats.SubscribeSync(xEnv.GetPubSubName("employeeUpdatedMyNatsTwo.12"))
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionMyNats.Flush())

			t.Cleanup(func() {
				err = firstSub.Unsubscribe()
				require.NoError(t, err)
				err = secondSub.Unsubscribe()
				require.NoError(t, err)
			})

			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
							updateEmployeeMyNats(id: 3, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.Equal(t, `{"data":{"updateEmployeeMyNats":{"success":true}}}`, resOne.Body)

			msgOne, err := firstSub.NextMsg(5 * time.Second)
			require.NoError(t, err)
			require.Equal(t, xEnv.GetPubSubName("employeeUpdatedMyNats.3"), msgOne.Subject)
			require.Equal(t, `{"id":3,"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`, string(msgOne.Data))

			resTwo := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation updateEmployeeMyNats($update: UpdateEmployeeInput!) {
							updateEmployeeMyNats(id: 12, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"David Stutt","email":"stutt@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.Equal(t, `{"data":{"updateEmployeeMyNats":{"success":true}}}`, resTwo.Body)
		})
	})

	t.Run("subscribe with stream and consumer", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			type subscriptionPayload struct {
				Data struct {
					EmployeeUpdatedNatsStream struct {
						ID float64 `graphql:"id"`
					} `graphql:"employeeUpdatedNatsStream(id: 12)"`
				} `json:"data"`
			}

			js, err := jetstream.New(xEnv.NatsConnectionDefault)
			require.NoError(t, err)

			_, err = js.CreateOrUpdateStream(xEnv.Context, jetstream.StreamConfig{
				Name:     xEnv.GetPubSubName("streamName"),
				Subjects: []string{xEnv.GetPubSubName("employeeUpdated.>")},
				Storage:  jetstream.MemoryStorage,
			})
			require.NoError(t, err)

			// conn.Close() is called in a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedNatsStream(id: 12) { id }}"}`),
			})

			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.12"), []byte(`{"id":13,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(13), payload.Data.EmployeeUpdatedNatsStream.ID)

			// Stop the subscription
			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:   "1",
				Type: "complete",
			})
			require.NoError(t, err)
			xEnv.WaitForSubscriptionCount(0, NatsWaitTimeout)

			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "1", complete.ID)
			require.Equal(t, "complete", complete.Type)

			// Publish the second event while the subscription is unsubscribed
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.12"), []byte(`{"id":14,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "2",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedNatsStream(id: 12) { id }}"}`),
			})
			require.NoError(t, err)
			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "2", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(14), payload.Data.EmployeeUpdatedNatsStream.ID)

			// Publish the third event while the subscription is subscribed
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.12"), []byte(`{"id":15,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "2", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(15), payload.Data.EmployeeUpdatedNatsStream.ID)
		})
	})

	t.Run("subscribing to a non-existent stream returns an error", func(t *testing.T) {
		t.Skip("Skipping this test for now, while fixing it")
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdatedNatsStream struct {
					ID float64 `graphql:"id"`
				} `graphql:"employeeUpdatedNatsStream(id: 12)"`
			}

			js, err := jetstream.New(xEnv.NatsConnectionDefault)
			require.NoError(t, err)

			stream, err := js.Stream(xEnv.Context, xEnv.GetPubSubName("streamName"))
			require.Error(t, err)
			require.Equal(t, "nats: API error: code=404 err_code=10059 description=stream not found", err.Error())
			require.Equal(t, nil, stream)

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			var counter atomic.Uint32

			_, err = client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				defer counter.Add(1)

				require.Contains(t,
					errValue.Error(),
					fmt.Sprintf(
						"EDFS error: failed to create or update consumer for stream \"%s\"",
						xEnv.GetPubSubName("streamName"),
					),
				)
				return nil
			})
			require.NoError(t, err)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			require.Eventually(t, func() bool {
				return counter.Load() == 1
			}, NatsWaitTimeout, time.Millisecond*100)
		})
	})

	t.Run("subscribe ws with filter", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			type subscriptionPayload struct {
				Data struct {
					FilteredEmployeeUpdated struct {
						ID      float64 `graphql:"id"`
						Details struct {
							Forename string `graphql:"forename"`
							Surname  string `graphql:"surname"`
						} `graphql:"details"`
					} `graphql:"filteredEmployeeUpdated(id: 1)"`
				} `json:"data"`
			}

			// conn.Close() is called in a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { filteredEmployeeUpdated(id: 1) { id details { forename, surname } } }"}`),
			})

			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			var produced atomic.Uint32
			var consumed atomic.Uint32

			go func() {
				require.Eventually(t, func() bool {
					return produced.Load() == 1
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 2
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(2) // skipping one message

				require.Eventually(t, func() bool {
					return produced.Load() == 4
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(3), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Stefan", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Avram", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 5
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(4), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Björn", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Schwenzer", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 6
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(5), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Sergiy", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Petrunin", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(2) // skipping one message

				require.Eventually(t, func() bool {
					return produced.Load() == 8
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(7), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Suvij", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Surya", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(1)

				require.Eventually(t, func() bool {
					return produced.Load() == 9
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(8), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Nithin", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Kumar", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(3) // should skip two messages

				require.Eventually(t, func() bool {
					return produced.Load() == 12
				}, NatsWaitTimeout, time.Millisecond*100)
				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdated.Details.Surname)
				consumed.Add(1)
			}()

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.1"), []byte(`{"id":1,"__typename":"Employee"}`))
			require.NoError(t, err)
			produced.Add(1)

			// Events 1, 3, 4, 5, 7, 8, and 11 should be included
			for i := uint32(1); i < 13; i++ {
				require.Eventually(t, func() bool {
					return consumed.Load() >= i
				}, NatsWaitTimeout, time.Millisecond*100)
				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.1"), []byte(fmt.Sprintf(`{"id":%d,"__typename":"Employee"}`, i)))
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
				produced.Add(1)
			}

			require.Eventually(t, func() bool {
				return consumed.Load() == 12 && produced.Load() == 13
			}, NatsWaitTimeout, time.Millisecond*100)
		})
	})

	t.Run("subscribe sse with filter", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { filteredEmployeeUpdated(id: 1) { id details { forename surname } } }"}`)

			var done atomic.Bool
			var producerDone atomic.Bool

			waitForProducer := func() {
				assert.Eventually(t, producerDone.Load, NatsWaitTimeout, time.Millisecond*100)
				producerDone.Store(false)
			}

			tick := make(chan struct{}, 1)
			timeout := time.After(NatsWaitTimeout)

			go func() {
				defer done.Store(true)

				client := http.Client{}
				req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
				require.NoError(t, gErr)

				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept", "text/event-stream")
				req.Header.Set("Connection", "keep-alive")
				req.Header.Set("Cache-Control", "no-cache")

				resp, gErr := client.Do(req)
				require.NoError(t, gErr)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
				require.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
				require.Equal(t, "keep-alive", resp.Header.Get("Connection"))
				require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"))

				reader := bufio.NewReader(resp.Body)

				waitForProducer()
				eventNext, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr := reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))

				select {
				case tick <- struct{}{}:
				case <-timeout:
					require.Fail(t, "timeout")
				}

				waitForProducer()
				eventNext, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":1,\"details\":{\"forename\":\"Jens\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))

				select {
				case tick <- struct{}{}:
				case <-timeout:
					require.Fail(t, "timeout")
				}

				waitForProducer()
				eventNext, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))

				select {
				case tick <- struct{}{}:
				case <-timeout:
					require.Fail(t, "timeout")
				}

				waitForProducer()
				eventNext, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":4,\"details\":{\"forename\":\"Björn\",\"surname\":\"Schwenzer\"}}}}", string(data))
				line, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))

				select {
				case tick <- struct{}{}:
				case <-timeout:
					require.Fail(t, "timeout")
				}

				waitForProducer()
				eventNext, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":5,\"details\":{\"forename\":\"Sergiy\",\"surname\":\"Petrunin\"}}}}", string(data))
				line, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))

				select {
				case tick <- struct{}{}:
				case <-timeout:
					require.Fail(t, "timeout")
				}

				waitForProducer()
				eventNext, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":7,\"details\":{\"forename\":\"Suvij\",\"surname\":\"Surya\"}}}}", string(data))
				line, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))

				select {
				case tick <- struct{}{}:
				case <-timeout:
					require.Fail(t, "timeout")
				}

				waitForProducer()
				eventNext, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":8,\"details\":{\"forename\":\"Nithin\",\"surname\":\"Kumar\"}}}}", string(data))
				line, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))

				select {
				case tick <- struct{}{}:
				case <-timeout:
					require.Fail(t, "timeout")
				}

				waitForProducer()
				eventNext, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "event: next", string(eventNext))
				data, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":11,\"details\":{\"forename\":\"Alexandra\",\"surname\":\"Neuse\"}}}}", string(data))
				line, _, gErr = reader.ReadLine()
				require.NoError(t, gErr)
				require.Equal(t, "", string(line))
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.1"), []byte(`{"id":1,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			producerDone.Store(true)

			// Events 1, 3, 4, 5, 7, 8, and 11 should be included
			for i := 1; i < 13; i++ {

				switch i {
				case 1, 3, 4, 5, 7, 8, 11:
					select {
					case <-tick:
						assert.Eventually(t, func() bool {
							return !producerDone.Load()
						}, NatsWaitTimeout, time.Millisecond*100)
					case <-timeout:
						require.Fail(t, "timeout")
					}
				}

				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.1"), []byte(fmt.Sprintf(`{"id":%d,"__typename": "Employee"}`, i)))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				producerDone.Store(true)
			}

			require.Eventually(t, done.Load, NatsWaitTimeout, time.Millisecond*100)
		})
	})

	t.Run("message with invalid JSON should give a specific error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			var produced atomic.Uint32
			var consumed atomic.Uint32

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer consumed.Add(1)
				oldCount := consumed.Load()
				require.Eventually(t, func() bool {
					return oldCount == produced.Load()-1
				}, NatsWaitTimeout, time.Millisecond*100)

				if oldCount == 0 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					assert.Equal(t, "Invalid message received", gqlErr[0].Message)
				} else if oldCount == 1 {
					assert.NoError(t, errValue)
					assert.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				} else if oldCount == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					assert.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdated.id'.", gqlErr[0].Message)
				} else if oldCount == 3 {
					assert.NoError(t, errValue)
					assert.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				}

				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{asas`)) // Invalid message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(1, NatsWaitTimeout)
			produced.Add(1)

			require.Eventually(t, func() bool {
				return consumed.Load() == 1
			}, NatsWaitTimeout, time.Millisecond*100)
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(2, NatsWaitTimeout)
			produced.Add(1)

			require.Eventually(t, func() bool {
				return consumed.Load() == 2
			}, NatsWaitTimeout, time.Millisecond*100)
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","update":{"name":"foo"}}`)) // Missing id
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(3, NatsWaitTimeout)
			produced.Add(1)

			require.Eventually(t, func() bool {
				return consumed.Load() == 3
			}, NatsWaitTimeout, time.Millisecond*100)
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(4, NatsWaitTimeout)
			produced.Add(1)

			require.Eventually(t, func() bool {
				return consumed.Load() == 4
			}, NatsWaitTimeout, time.Millisecond*100)

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, NatsWaitTimeout)
			xEnv.WaitForConnectionCount(0, NatsWaitTimeout)
		})
	})

	t.Run("shutdown doesn't wait indefinitely", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Delay: time.Minute,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			var consumed atomic.Uint32

			subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				defer consumed.Add(1)
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			assert.NoError(t, client.Close())

			var completed atomic.Bool
			go func() {
				defer completed.Store(true)
				xEnv.Shutdown()
				assert.NoError(t, err)
			}()

			assert.Eventually(t, completed.Load, NatsWaitTimeout, time.Millisecond*100)
		})
	})
}

func TestFlakyNatsEvents(t *testing.T) {
	t.Run("subscribe to multiple subjects", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketClientReadTimeout = time.Second
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			type subscriptionPayload struct {
				Data struct {
					EmployeeUpdatedMyNats struct {
						ID float64 `graphql:"id"`
					} `graphql:"employeeUpdatedMyNats(id: 12)"`
				} `json:"data"`
			}

			// conn.Close() is called in  a cleanup defined in the function
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id }}"}`),
			})
			require.NoError(t, err)
			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			xEnv.WaitForSubscriptionCount(1, NatsWaitTimeout)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionMyNats.Publish(xEnv.GetPubSubName("employeeUpdatedMyNats.12"), []byte(`{"id":13,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionMyNats.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(1, NatsWaitTimeout)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(13), payload.Data.EmployeeUpdatedMyNats.ID)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionMyNats.Publish(xEnv.GetPubSubName("employeeUpdatedMyNatsTwo.12"), []byte(`{"id":99,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionMyNats.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, NatsWaitTimeout)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(99), payload.Data.EmployeeUpdatedMyNats.ID)
		})
	})
}
