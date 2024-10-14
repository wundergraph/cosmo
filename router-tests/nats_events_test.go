package integration_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"io"
	"net/http"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestNatsEvents(t *testing.T) {
	t.Parallel()

	t.Run("subscribe async", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.InfoLevel,
		}}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(2)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
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

			go func() {
				wg.Wait()
				require.NoError(t, client.Close())
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			// Send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, resOne.Body)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)

			natsLogs := xEnv.Observer().FilterMessageSnippet("Nats").All()
			require.Len(t, natsLogs, 4)
			providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "my-nats")).All()
			require.Len(t, providerIDFields, 1)
		})
	})

	t.Run("message and resolve errors should not abort the subscription", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
						Surname  string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 3)"`
			}

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(4)

			count := 0

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {

				defer wg.Done()

				if count == 0 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Internal server error", gqlErr[0].Message)
				} else if count == 1 || count == 3 {
					require.NoError(t, errValue)
					require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(dataValue))
				} else if count == 2 {
					var gqlErr graphql.Errors
					require.ErrorAs(t, errValue, &gqlErr)
					require.Equal(t, "Cannot return null for non-nullable field 'Subscription.employeeUpdated.id'.", gqlErr[0].Message)
				}

				count++

				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(``)) // Empty message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(1, time.Second*10)

			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(2, time.Second*10)

			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"__typename":"Employee","update":{"name":"foo"}}`)) // Missing id
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(3, time.Second*10)

			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			xEnv.WaitForMessagesSent(4, time.Second*10)

			wg.Wait()

			require.NoError(t, client.Close())

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("subscribe async epoll/kqueue disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.EnableWebSocketEpollKqueue = false
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 100
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

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(2)

			subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
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

			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Wait longer than the read timeout to ensure that read timeouts are handled correctly
			time.Sleep(time.Millisecond * 200)

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			wg.Wait()

			require.NoError(t, client.Close())

			xEnv.WaitForMessagesSent(2, time.Second*10)
			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			//xEnv.WaitForConnectionCount(0, time.Second*10) flaky
		})
	})

	t.Run("multipart", func(t *testing.T) {
		assertLineEquals := func(reader *bufio.Reader, expected string) {
			line, _, err := reader.ReadLine()
			require.NoError(t, err)
			require.Equal(t, expected, string(line))
		}

		assertMultipartPrefix := func(reader *bufio.Reader) {
			assertLineEquals(reader, "--graphql")
			assertLineEquals(reader, "Content-Type: application/json")
			assertLineEquals(reader, "")
		}

		heartbeatInterval := 5 * time.Second

		t.Run("subscribe with multipart responses", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				TLSConfig: &core.TlsConfig{
					Enabled:  true,
					CertFile: "testdata/tls/cert.pem",
					KeyFile:  "testdata/tls/key.pem",
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

				wg := &sync.WaitGroup{}
				wg.Add(1)

				go func() {
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := xEnv.RouterClient.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					require.Equal(t, []string(nil), resp.TransferEncoding)

					reader := bufio.NewReader(resp.Body)

					// Read the first part
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}}")
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{}")
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}}")
					wg.Done()

				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*5)

				// Send a mutation to trigger the subscription

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
				})
				require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

				time.Sleep(heartbeatInterval)
				// Trigger the subscription via NATS
				err := xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				xEnv.NatsConnectionDefault.Close()
				wg.Wait()
			})
		})

		t.Run("subscribe with multipart responses http/1", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				TLSConfig: nil, // Force Http/1
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

				wg := &sync.WaitGroup{}
				wg.Add(1)

				var client *http.Client
				go func() {
					client = &http.Client{
						Timeout: time.Second * 10000,
					}

					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					require.Equal(t, []string{"chunked"}, resp.TransferEncoding)

					reader := bufio.NewReader(resp.Body)

					// Read the first part
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{}")
					wg.Done()
				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*5)
				xEnv.NatsConnectionDefault.Close()
				wg.Wait()
			})
		})

		t.Run("subscribe with closing channel", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 3) }"}`)

				wg := &sync.WaitGroup{}
				wg.Add(1)

				var client http.Client
				go func() {
					client = http.Client{
						Timeout: time.Second * 100,
					}
					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()

					reader := bufio.NewReader(resp.Body)

					// Read the first part
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"countFor\":0}}}")
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"countFor\":1}}}")
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"countFor\":2}}}")
					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"data\":{\"countFor\":3}}}")
					assertLineEquals(reader, "--graphql--")
					wg.Done()
				}()

				xEnv.WaitForSubscriptionCount(1, time.Second*5)

				// Sleep to ensure get heartbeat
				time.Sleep(heartbeatInterval)

				xEnv.NatsConnectionDefault.Close()
				wg.Wait()
			})
		})

		t.Run("subscribe sync multipart with block", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
					securityConfiguration.BlockSubscriptions = true
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				queries := [][]byte{
					[]byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`),
					[]byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id details { forename surname } }}"}`),
				}

				for _, subscribePayload := range queries {
					client := http.Client{
						Timeout: time.Second * 1000,
					}

					req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
					req.Header.Set("Cache-Control", "no-cache")

					resp, err := client.Do(req)
					require.NoError(t, err)
					require.Equal(t, http.StatusOK, resp.StatusCode)
					defer resp.Body.Close()
					reader := bufio.NewReader(resp.Body)

					assertMultipartPrefix(reader)
					assertLineEquals(reader, "{\"payload\":{\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}}")
					xEnv.NatsConnectionDefault.Close()
				}
			})
		})
	})

	t.Run("subscribe once", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				client := http.Client{
					Timeout: time.Second * 10,
				}
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
				wg.Done()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			wg.Wait()
		})
	})

	t.Run("subscribe sync sse works without query param", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				client := http.Client{
					Timeout: time.Second * 10,
				}
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

				eventNext, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "event: next", string(eventNext))
				data, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))

				eventNext, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "event: next", string(eventNext))
				data, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err = reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))

				wg.Done()

			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			wg.Wait()
		})
	})

	t.Run("subscribe sync sse with block", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockSubscriptions = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			subscribePayloadOne := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)
			subscribePayloadTwo := []byte(`{"query":"subscription { employeeUpdatedMyNats(id: 12) { id details { forename surname } }}"}`)

			client := http.Client{
				Timeout: time.Second * 10,
			}
			reqOne, err := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(subscribePayloadOne))
			require.NoError(t, err)

			reqOne.Header.Set("Content-Type", "application/json")
			reqOne.Header.Set("Accept", "text/event-stream")
			reqOne.Header.Set("Connection", "keep-alive")
			reqOne.Header.Set("Cache-Control", "no-cache")

			respOne, err := client.Do(reqOne)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, respOne.StatusCode)
			defer respOne.Body.Close()
			readerOne := bufio.NewReader(respOne.Body)

			eventNextOne, _, err := readerOne.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "event: next", string(eventNextOne))
			dataOne, _, err := readerOne.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}", string(dataOne))

			reqTwo, err := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(subscribePayloadTwo))
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

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			firstSubscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				client := http.Client{
					Timeout: time.Second * 10,
				}
				req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(firstSubscribePayload))
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

				eventNext, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "event: next", string(eventNext))
				data, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
				line, _, err := reader.ReadLine()
				require.NoError(t, err)
				require.Equal(t, "", string(line))

				wg.Done()
			}()

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Send a mutation to trigger the subscription
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish("employeeUpdated.3", []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			wg.Wait()

			xEnv.WaitForSubscriptionCount(0, time.Second*10)
			xEnv.WaitForConnectionCount(0, time.Second*10)
		})
	})

	t.Run("request", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			firstSub, err := xEnv.NatsConnectionDefault.Subscribe("getEmployee.3", func(msg *nats.Msg) {
				err := msg.Respond([]byte(`{"id": 3, "__typename": "Employee"}`))
				require.NoError(t, err)
			})
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			secondSub, err := xEnv.NatsConnectionMyNats.Subscribe("getEmployeeMyNats.12", func(msg *nats.Msg) {
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

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			firstSub, err := xEnv.NatsConnectionDefault.SubscribeSync("employeeUpdatedMyNats.3")
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			secondSub, err := xEnv.NatsConnectionMyNats.SubscribeSync("employeeUpdatedMyNatsTwo.12")
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
							updateEmployeeMyNats(employeeID: 3, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"updateEmployeeMyNats": {"success": true}}}`, resOne.Body)

			msgOne, err := firstSub.NextMsg(5 * time.Second)
			require.NoError(t, err)
			require.Equal(t, "employeeUpdatedMyNats.3", msgOne.Subject)
			require.Equal(t, `{"employeeID":3,"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`, string(msgOne.Data))

			resTwo := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation updateEmployeeMyNats($update: UpdateEmployeeInput!) {
							updateEmployeeMyNats(employeeID: 12, update: $update) {success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"David Stutt","email":"stutt@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.JSONEq(t, `{"data":{"updateEmployeeMyNats": {"success": true}}}`, resTwo.Body)
		})
	})

	t.Run("subscribe to multiple subjects", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 10
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

			xEnv.WaitForSubscriptionCount(1, time.Second*20)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionMyNats.Publish("employeeUpdatedMyNats.12", []byte(`{"id":13,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionMyNats.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(1, time.Second*5)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(13), payload.Data.EmployeeUpdatedMyNats.ID)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionMyNats.Publish("employeeUpdatedMyNatsTwo.12", []byte(`{"id":99,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionMyNats.Flush()
			require.NoError(t, err)

			xEnv.WaitForMessagesSent(2, time.Second*5)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(99), payload.Data.EmployeeUpdatedMyNats.ID)
		})
	})

	t.Run("subscribe with stream and consumer", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 10
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
				Name:     "streamName",
				Subjects: []string{"employeeUpdated.>"},
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

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.12", []byte(`{"id":13,"__typename":"Employee"}`))
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
			xEnv.WaitForSubscriptionCount(0, time.Second*10)

			var complete testenv.WebSocketMessage
			err = conn.ReadJSON(&complete)
			require.NoError(t, err)
			require.Equal(t, "1", complete.ID)
			require.Equal(t, "complete", complete.Type)

			// Publish the second event while the subscription is unsubscribed
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.12", []byte(`{"id":14,"__typename":"Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			err = conn.WriteJSON(&testenv.WebSocketMessage{
				ID:      "2",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { employeeUpdatedNatsStream(id: 12) { id }}"}`),
			})
			require.NoError(t, err)
			xEnv.WaitForSubscriptionCount(1, time.Second*10)

			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			require.Equal(t, "2", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(14), payload.Data.EmployeeUpdatedNatsStream.ID)

			// Publish the third event while the subscription is subscribed
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.12", []byte(`{"id":15,"__typename":"Employee"}`))
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
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscription struct {
				employeeUpdatedNatsStream struct {
					ID float64 `graphql:"id"`
				} `graphql:"employeeUpdatedNatsStream(id: 12)"`
			}

			js, err := jetstream.New(xEnv.NatsConnectionDefault)
			require.NoError(t, err)

			stream, err := js.Stream(xEnv.Context, "streamName")
			require.Equal(t, "nats: API error: code=404 err_code=10059 description=stream not found", err.Error())
			require.Equal(t, nil, stream)

			surl := xEnv.GraphQLSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)
			t.Cleanup(func() {
				_ = client.Close()
			})

			wg := &sync.WaitGroup{}
			wg.Add(1)

			_, err = client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				defer wg.Done()
				require.Contains(t, errValue.Error(), `EDFS error: failed to create or update consumer for stream "streamName"`)
				return nil
			})
			require.NoError(t, err)

			go func() {
				clientErr := client.Run()
				require.NoError(t, clientErr)
			}()

			wg.Wait()
		})
	})

	t.Run("subscribe ws with filter", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(engineExecutionConfiguration *config.EngineExecutionConfiguration) {
				engineExecutionConfiguration.WebSocketReadTimeout = time.Millisecond * 100
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

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			go func() {
				defer wg.Done()

				gErr := conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdated.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Jens", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdated.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(3), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Stefan", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Avram", payload.Data.FilteredEmployeeUpdated.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(4), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Björn", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Schwenzer", payload.Data.FilteredEmployeeUpdated.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(5), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Sergiy", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Petrunin", payload.Data.FilteredEmployeeUpdated.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(7), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Suvij", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Surya", payload.Data.FilteredEmployeeUpdated.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(8), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Nithin", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Kumar", payload.Data.FilteredEmployeeUpdated.Details.Surname)

				gErr = conn.ReadJSON(&msg)
				require.NoError(t, gErr)
				require.Equal(t, "1", msg.ID)
				require.Equal(t, "next", msg.Type)
				gErr = json.Unmarshal(msg.Payload, &payload)
				require.NoError(t, gErr)
				require.Equal(t, float64(11), payload.Data.FilteredEmployeeUpdated.ID)
				require.Equal(t, "Alexandra", payload.Data.FilteredEmployeeUpdated.Details.Forename)
				require.Equal(t, "Neuse", payload.Data.FilteredEmployeeUpdated.Details.Surname)
			}()

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.1", []byte(`{"id":1,"__typename":"Employee"}`))
			require.NoError(t, err)

			// Events 1, 3, 4, 5, 7, 8, and 11 should be included
			for i := 1; i < 13; i++ {
				// Ensure the NATS consumer can keep up with the provider
				time.Sleep(time.Millisecond * 100)

				err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.1", []byte(fmt.Sprintf(`{"id":%d,"__typename":"Employee"}`, i)))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
			}

			wg.Wait()
		})
	})

	t.Run("subscribe sse with filter", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { filteredEmployeeUpdated(id: 1) { id details { forename surname } } }"}`)

			wg := &sync.WaitGroup{}
			wg.Add(1)

			tick := make(chan struct{}, 1)
			timeout := time.After(time.Second * 10)

			go func() {
				defer wg.Done()

				client := http.Client{
					Timeout: time.Second * 10,
				}
				req, gErr := http.NewRequest(http.MethodPost, xEnv.GraphQLServeSentEventsURL(), bytes.NewReader(subscribePayload))
				require.NoError(t, gErr)

				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept", "text/event-stream")
				req.Header.Set("Connection", "keep-alive")
				req.Header.Set("Cache-Control", "no-cache")

				resp, gErr := client.Do(req)
				require.NoError(t, gErr)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()
				reader := bufio.NewReader(resp.Body)

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

			xEnv.WaitForSubscriptionCount(1, time.Second*5)

			// Trigger the subscription via NATS
			err := xEnv.NatsConnectionDefault.Publish("employeeUpdated.1", []byte(`{"id":1,"__typename": "Employee"}`))
			require.NoError(t, err)

			// Events 1, 3, 4, 5, 7, 8, and 11 should be included
			for i := 1; i < 13; i++ {

				switch i {
				case 1, 3, 4, 5, 7, 8, 11:
					select {
					case <-tick:
					case <-timeout:
						require.Fail(t, "timeout")
					}
				}

				err = xEnv.NatsConnectionDefault.Publish("employeeUpdated.1", []byte(fmt.Sprintf(`{"id":%d,"__typename": "Employee"}`, i)))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

			}

			wg.Wait()
		})
	})
}
