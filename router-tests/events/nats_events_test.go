package events_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"

	"github.com/hasura/go-graphql-client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

var (
	_ configpoller.ConfigPoller = (*ConfigPollerMock)(nil)
)

type ConfigPollerMock struct {
	initConfig   *nodev1.RouterConfig
	updateConfig func(newConfig *nodev1.RouterConfig, oldVersion string) error
	ready        chan struct{}
}

func (c *ConfigPollerMock) Subscribe(_ context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersion string) error) {
	c.updateConfig = handler
	close(c.ready)
}

func (c *ConfigPollerMock) GetRouterConfig(_ context.Context) (*routerconfig.Response, error) {
	result := &routerconfig.Response{
		Config: c.initConfig,
	}
	return result, nil
}

func (c *ConfigPollerMock) Stop(_ context.Context) error {
	return nil
}

type natsSubscriptionArgs struct {
	dataValue []byte
	errValue  error
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

			subscriptionArgsCh := make(chan natsSubscriptionArgs)
			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- natsSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			clientRunErrCh := make(chan error)
			go func() {
				clientErr := client.Run()
				clientRunErrCh <- clientErr
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Send a mutation to trigger the first subscription
			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, resOne.Body)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			// Trigger the first subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunErrCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
			xEnv.WaitForConnectionCount(0, EventWaitTimeout)

			natsLogs := xEnv.Observer().FilterMessageSnippet("Nats").All()
			require.Len(t, natsLogs, 2)
			providerIDFields := xEnv.Observer().FilterField(zap.String("provider_id", "my-nats")).All()
			require.Len(t, providerIDFields, 3)
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

			subscriptionArgsCh := make(chan natsSubscriptionArgs)
			subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- natsSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)

			clientRunErrCh := make(chan error)
			go func() {
				clientRunErrCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

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

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunErrCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
			xEnv.WaitForConnectionCount(0, EventWaitTimeout)
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
					core.WithSubscriptionHeartbeatInterval(heartbeatInterval),
				},
				EnableNats: true,
				TLSConfig: &core.TlsConfig{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

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

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

				// Send a mutation to trigger the subscription

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
				})
				require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}}")

				// Trigger the subscription via NATS
				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}}")
			})
		})

		t.Run("subscribe with multipart responses http and consume healthcheck only", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
				TLSConfig:                nil, // Force Http/1
				RouterOptions: []core.Option{
					core.WithSubscriptionHeartbeatInterval(heartbeatInterval),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

				client := &http.Client{}

				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				require.Equal(t, []string{"chunked"}, resp.TransferEncoding)

				reader := bufio.NewReader(resp.Body)

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

				// Read the first part
				assertMultipartPrefix(t, reader)
				assertLineEquals(t, reader, "{}")
			})
		})

		t.Run("subscribe with closing channel", func(t *testing.T) {

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
			}, func(t *testing.T, xEnv *testenv.Environment) {
				subscribePayload := []byte(`{"query":"subscription { countFor(count: 3) }"}`)

				client := http.Client{}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				reader := bufio.NewReader(resp.Body)

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

				// Read the first part
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":0}}}")
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":1}}}")
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":2}}}")
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":3}}}")
				assertLineEquals(t, reader, "--graphql--")
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

					assertMultipartValueEventually(t, reader, "{\"payload\":{\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}}")
				}
			})
		})

		t.Run("subscribe after message don't a boundary", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				RouterOptions: []core.Option{
					core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
						SubscriptionMultipartPrintBoundary: config.ApolloCompatibilityFlag{
							Enabled: false,
						},
					}),
				},
				EnableNats: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 0) }"}`)

				client := http.Client{}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				reader := bufio.NewReader(resp.Body)

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

				// Read the first part

				expected := "\r\n--graphql\r\nContent-Type: application/json\r\n\r\n{\"payload\":{\"data\":{\"countFor\":0}}}\r\n"
				read := make([]byte, len(expected))
				_, err = reader.Read(read)
				assert.NoError(t, err)
				assert.Equal(t, expected, string(read))
			})
		})

		t.Run("multipart format related new line returns should have a preceding carriage return", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				EnableNats:               true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 3) }"}`)
				client := http.Client{}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				reader := bufio.NewReader(resp.Body)

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

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
				}, EventWaitTimeout, time.Millisecond*100)
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
						SubscriptionMultipartPrintBoundary: config.ApolloCompatibilityFlag{
							Enabled: true,
						},
					}),
				},
				EnableNats: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 0) }"}`)

				client := http.Client{}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				reader := bufio.NewReader(resp.Body)

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

				// Read the first part

				expected := "\r\n--graphql\r\nContent-Type: application/json\r\n\r\n{\"payload\":{\"data\":{\"countFor\":0}}}\r\n\r\n--graphql"
				read := make([]byte, len(expected))
				_, err = reader.Read(read)
				assert.NoError(t, err)
				assert.Equal(t, expected, string(read))
			})
		})

		t.Run("subscribe with closing channel", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
				RouterOptions: []core.Option{
					core.WithApolloCompatibilityFlagsConfig(config.ApolloCompatibilityFlags{
						SubscriptionMultipartPrintBoundary: config.ApolloCompatibilityFlag{
							Enabled: true,
						},
					}),
				},
				EnableNats: true,
			}, func(t *testing.T, xEnv *testenv.Environment) {

				subscribePayload := []byte(`{"query":"subscription { countFor(count: 3) }"}`)

				client := http.Client{}
				req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
				resp, err := client.Do(req)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, resp.StatusCode)
				defer resp.Body.Close()

				reader := bufio.NewReader(resp.Body)

				xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
				xEnv.WaitForTriggerCount(1, EventWaitTimeout)

				// Read the first part
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":0}}}")
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":1}}}")
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":2}}}")
				assertMultipartValueEventually(t, reader, "{\"payload\":{\"data\":{\"countFor\":3}}}")
				assertLineEquals(t, reader, "")
				assertLineEquals(t, reader, "--graphql--")
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

			client := http.Client{}
			xUrl, err := url.Parse(xEnv.GraphQLRequestURL())
			require.NoError(t, err)
			xUrl.RawQuery = core.WgSubscribeOnceParam

			req, err := http.NewRequest(http.MethodPost, xUrl.String(), bytes.NewReader(subscribePayload))
			require.NoError(t, err)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			var clientDoCh = make(chan struct {
				resp *http.Response
				err  error
			})

			go func() {
				resp, err := client.Do(req)
				clientDoCh <- struct {
					resp *http.Response
					err  error
				}{resp: resp, err: err}
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Send a mutation to trigger the subscription
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			// Wait for the client to get the response
			var resp *http.Response
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientDoCh, func(t *testing.T, clientDo struct {
				resp *http.Response
				err  error
			}) {
				require.NoError(t, clientDo.err)
				require.Equal(t, http.StatusOK, clientDo.resp.StatusCode)
				resp = clientDo.resp

			})
			defer resp.Body.Close()
			reader := bufio.NewReader(resp.Body)

			require.Equal(t, "text/plain; charset=utf-8", resp.Header.Get("Content-Type"))
			emptyHeaders := []string{"Cache-Control", "Connection", "X-Accel-Buffering"}
			for _, header := range emptyHeaders {
				_, exists := resp.Header[header]
				require.False(t, exists)
			}

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			data, _, err := reader.ReadLine()
			require.NoError(t, err)
			require.Equal(t, "{\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", string(data))
			_, _, err = reader.ReadLine()
			require.Error(t, err, io.EOF) // Subscription closed after one time
		})
	})

	t.Run("subscribe sync sse works without query param", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } } }"}`)

			client := http.Client{}
			req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
			require.NoError(t, err)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			var clientDoCh = make(chan struct {
				resp *http.Response
				err  error
			})

			go func() {
				resp, err := client.Do(req)
				clientDoCh <- struct {
					resp *http.Response
					err  error
				}{resp: resp, err: err}
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Send a mutation to trigger the subscription
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			// Wait for the client to get the response
			var resp *http.Response
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientDoCh, func(t *testing.T, clientDo struct {
				resp *http.Response
				err  error
			}) {
				require.NoError(t, clientDo.err)
				require.Equal(t, http.StatusOK, clientDo.resp.StatusCode)
				resp = clientDo.resp
			})

			defer resp.Body.Close()
			reader := bufio.NewReader(resp.Body)

			eventNext := testenv.ReadSSEField(t, reader)
			require.Equal(t, "event: next", eventNext)
			data := testenv.ReadSSEField(t, reader)
			require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", data)

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			eventNext = testenv.ReadSSEField(t, reader)
			require.Equal(t, "event: next", eventNext)
			data = testenv.ReadSSEField(t, reader)
			require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", data)
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

			eventNextOne := testenv.ReadSSELine(t, readerOne)
			require.Equal(t, "event: next", eventNextOne)
			dataOne := testenv.ReadSSELine(t, readerOne)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}", dataOne)

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

			eventNextTwo := testenv.ReadSSELine(t, readerTwo)
			require.Equal(t, "event: next", eventNextTwo)
			dataTwo := testenv.ReadSSELine(t, readerTwo)
			require.Equal(t, "data: {\"errors\":[{\"message\":\"operation type 'subscription' is blocked\"}]}", dataTwo)
		})
	})

	t.Run("subscribe sync sse client close", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			firstSubscribePayload := []byte(`{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`)

			client := http.Client{}
			req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(firstSubscribePayload))
			require.NoError(t, err)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			var clientDoCh = make(chan struct {
				resp *http.Response
				err  error
			})

			go func() {
				resp, err := client.Do(req)
				clientDoCh <- struct {
					resp *http.Response
					err  error
				}{resp: resp, err: err}
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Send a mutation to trigger the subscription
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateAvailability(employeeID: 3, isAvailable: true) { id } }`,
			})
			require.JSONEq(t, `{"data":{"updateAvailability":{"id":3}}}`, res.Body)

			var resp *http.Response
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientDoCh, func(t *testing.T, clientDo struct {
				resp *http.Response
				err  error
			}) {
				require.NoError(t, clientDo.err)
				require.Equal(t, http.StatusOK, clientDo.resp.StatusCode)
				resp = clientDo.resp
			})
			defer resp.Body.Close()
			require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
			require.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
			require.Equal(t, "keep-alive", resp.Header.Get("Connection"))
			require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"))

			reader := bufio.NewReader(resp.Body)

			eventNext := testenv.ReadSSEField(t, reader)
			require.Equal(t, "event: next", eventNext)

			// Trigger the subscription via NATS
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"id":3,"__typename": "Employee"}`))
			require.NoError(t, err)

			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			data := testenv.ReadSSEField(t, reader)
			require.Equal(t, "data: {\"data\":{\"employeeUpdated\":{\"id\":3,\"details\":{\"forename\":\"Stefan\",\"surname\":\"Avram\"}}}}", data)
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
				// Unsubscribe from the NATS subscriptions
				// We don't check for errors here as we don't want to fail the test
				// if the unsubscription fails
				_ = firstSub.Unsubscribe()
				_ = secondSub.Unsubscribe()
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

	t.Run("mutate", func(t *testing.T) {
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
				// Unsubscribe from the NATS subscriptions
				// We don't check for errors here as we don't want to fail the test
				// if the unsubscription fails
				_ = firstSub.Unsubscribe()
				_ = secondSub.Unsubscribe()
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

	t.Run("mutate returns correct typename", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			sub, err := xEnv.NatsConnectionDefault.SubscribeSync(xEnv.GetPubSubName("employeeUpdatedMyNats.3"))
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			t.Cleanup(func() { _ = sub.Unsubscribe() })

			resOne := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation UpdateEmployeeNats($update: UpdateEmployeeInput!) {
							updateEmployeeMyNats(id: 3, update: $update) {__typename success}
						}`,
				Variables: json.RawMessage(`{"update":{"name":"Stefan Avramovic","email":"avramovic@wundergraph.com"}}`),
			})

			// Send a query to receive the response from the NATS message
			require.Equal(t, `{"data":{"updateEmployeeMyNats":{"__typename":"edfs__PublishResult","success":true}}}`, resOne.Body)
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

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Trigger the first subscription via NATS
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.12"), []byte(`{"id":13,"__typename":"Employee"}`), 1, EventWaitTimeout)

			err = testenv.WSReadJSON(t, conn, &msg)
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
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
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
			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "2", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(14), payload.Data.EmployeeUpdatedNatsStream.ID)

			// Publish the third event while the subscription is subscribed
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.12"), []byte(`{"id":15,"__typename":"Employee"}`), 1, EventWaitTimeout)

			err = testenv.WSReadJSON(t, conn, &msg)
			require.NoError(t, err)
			require.Equal(t, "2", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(15), payload.Data.EmployeeUpdatedNatsStream.ID)
		})
	})

	t.Run("durable consumer is deleted from nats server on router shutdown", func(t *testing.T) {
		t.Parallel()

		env, err := testenv.CreateTestEnv(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				// Remove feature flag configs to work around a bug where buildGraphMux
				// overwrites s.pubSubProviders on each call, orphaning the base providers.
				routerConfig.FeatureFlagConfigs = nil
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				for i := range cfg.Providers.Nats {
					cfg.Providers.Nats[i].DeleteDurableConsumersOnShutdown = true
				}
			},
		})
		require.NoError(t, err)
		t.Cleanup(env.Shutdown)

		js, err := jetstream.New(env.NatsConnectionDefault)
		require.NoError(t, err)

		streamName := env.GetPubSubName("streamName")
		_, err = js.CreateOrUpdateStream(env.Context, jetstream.StreamConfig{
			Name:     streamName,
			Subjects: []string{env.GetPubSubName("employeeUpdated.>")},
			Storage:  jetstream.MemoryStorage,
		})
		require.NoError(t, err)

		conn := env.InitGraphQLWebSocketConnection(nil, nil, nil)
		err = conn.WriteJSON(&testenv.WebSocketMessage{
			ID:      "1",
			Type:    "subscribe",
			Payload: []byte(`{"query":"subscription { employeeUpdatedNatsStream(id: 12) { id }}"}`),
		})
		require.NoError(t, err)
		env.WaitForSubscriptionCount(1, EventWaitTimeout)

		// Verify the durable consumer was created on the stream
		stream, err := js.Stream(env.Context, streamName)
		require.NoError(t, err)
		streamInfo, err := stream.Info(env.Context)
		require.NoError(t, err)
		require.Equal(t, 1, streamInfo.State.Consumers, "expected one consumer before shutdown")

		// Shut down the router; this should trigger deletion of durable consumers
		env.Shutdown()

		// env.Context is cancelled by Shutdown, so use a fresh context for JetStream queries
		ctx := context.Background()
		streamInfo, err = stream.Info(ctx)
		require.NoError(t, err)
		require.Equal(t, 0, streamInfo.State.Consumers, "expected no consumers after shutdown with delete_on_shutdown enabled")
	})

	t.Run("durable consumer is not deleted from nats server on router shutdown", func(t *testing.T) {
		t.Parallel()

		env, err := testenv.CreateTestEnv(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				// Remove feature flag configs to work around a bug where buildGraphMux
				// overwrites s.pubSubProviders on each call, orphaning the base providers.
				routerConfig.FeatureFlagConfigs = nil
			},
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				for i := range cfg.Providers.Nats {
					cfg.Providers.Nats[i].DeleteDurableConsumersOnShutdown = false
				}
			},
		})
		require.NoError(t, err)
		t.Cleanup(env.Shutdown)

		js, err := jetstream.New(env.NatsConnectionDefault)
		require.NoError(t, err)

		streamName := env.GetPubSubName("streamName")
		_, err = js.CreateOrUpdateStream(env.Context, jetstream.StreamConfig{
			Name:     streamName,
			Subjects: []string{env.GetPubSubName("employeeUpdated.>")},
			Storage:  jetstream.MemoryStorage,
		})
		require.NoError(t, err)

		conn := env.InitGraphQLWebSocketConnection(nil, nil, nil)
		err = conn.WriteJSON(&testenv.WebSocketMessage{
			ID:      "1",
			Type:    "subscribe",
			Payload: []byte(`{"query":"subscription { employeeUpdatedNatsStream(id: 12) { id }}"}`),
		})
		require.NoError(t, err)
		env.WaitForSubscriptionCount(1, EventWaitTimeout)

		// Verify the durable consumer was created on the stream
		stream, err := js.Stream(env.Context, streamName)
		require.NoError(t, err)
		streamInfo, err := stream.Info(env.Context)
		require.NoError(t, err)
		require.Equal(t, 1, streamInfo.State.Consumers, "expected one consumer before shutdown")

		// Shut down the router; this should trigger deletion of durable consumers
		env.Shutdown()

		// env.Context is cancelled by Shutdown, so use a fresh context for JetStream queries
		ctx := context.Background()
		streamInfo, err = stream.Info(ctx)
		require.NoError(t, err)
		require.Equal(t, 1, streamInfo.State.Consumers, "expected one consumer after shutdown with delete_on_shutdown disabled")
	})

	t.Run("subscribing to a non-existent stream returns an error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			js, err := jetstream.New(xEnv.NatsConnectionDefault)
			require.NoError(t, err)

			stream, err := js.Stream(xEnv.Context, xEnv.GetPubSubName("streamName"))
			require.Error(t, err)
			require.Equal(t, "nats: API error: code=404 err_code=10059 description=stream not found", err.Error())
			require.Equal(t, nil, stream)

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client := graphql.NewSubscriptionClient(surl)

			var subscription struct {
				employeeUpdatedNatsStream struct {
					ID float64 `graphql:"id"`
				} `graphql:"employeeUpdatedNatsStream(id: 12)"`
			}

			gotError := make(chan error)

			_, err = client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				gotError <- errValue

				return nil
			})
			require.NoError(t, err)

			var clientRunCh = make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			testenv.AwaitChannelWithT(t, EventWaitTimeout, gotError, func(t *testing.T, clientErr error) {
				require.ErrorContains(t, clientErr, fmt.Sprintf(
					"EDFS error: failed to create or update consumer for stream \"%s\"",
					xEnv.GetPubSubName("streamName"),
				))
			})

			// Any further errors should be treated as a failure
			// as it likely indicates the server telling the client to retry
			select {
			case err := <-gotError:
				t.Fatalf("received >1 error on channel: %v", err)
			case <-time.After(5 * time.Second):
				break
			}

			err = client.Close()
			require.NoError(t, err)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, clientErr error) {
				require.NoError(t, clientErr, "unexpected client run error, this used to be flaky")
			}, "unable to close client before timeout")
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

			subscriptionArgsCh := make(chan natsSubscriptionArgs)
			subscriptionID, err := client.Subscribe(&subscription, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- natsSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Direct publish is correct here: the subgraph has a 1-minute delay,
			// so SubscriptionUpdateSent will never fire. We only need to trigger
			// the slow fetch, then verify shutdown doesn't hang.
			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`))
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			assert.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, clientRunErr error) {
				require.NoError(t, clientRunErr)
			})

			// Check that the environment is shutdown
			completedCh := make(chan bool)
			go func() {
				xEnv.Shutdown()
				completedCh <- true
			}()

			testenv.AwaitChannelWithT(t, EventWaitTimeout, completedCh, func(t *testing.T, completed bool) {
				require.True(t, completed)
			}, "unable to shutdown environment before timeout")
		})
	})

	t.Run("NATS startup and shutdown with wrong URLs should not stop router from starting indefinitely", func(t *testing.T) {
		t.Parallel()

		listener := testenv.NewWaitingListener(t, time.Second*10)
		listener.Start()
		defer listener.Close()

		errRouter := testenv.RunWithError(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               false,
			ModifyEventsConfiguration: func(cfg *config.EventsConfiguration) {
				url := "nats://127.0.0.1:" + strconv.Itoa(listener.Port())
				natsEventSources := make([]config.NatsEventSource, len(testenv.DemoNatsProviders))
				for _, sourceName := range testenv.DemoNatsProviders {
					natsEventSources = append(natsEventSources, config.NatsEventSource{
						ID:  sourceName,
						URL: url,
					})
				}
				cfg.Providers.Nats = natsEventSources
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			assert.Fail(t, "Should not be called")
		})

		assert.Error(t, errRouter)
	})

	t.Run("multiple subscribe async with variables", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			NoRetryClient: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			var subscriptionOne struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Surname string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyNats(id: 1)"`
			}

			var subscriptionTwo struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Forename string `graphql:"forename"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyNats(id: 1)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client1 := graphql.NewSubscriptionClient(surl)
			client2 := graphql.NewSubscriptionClient(surl)
			subscriptionOneID, err := client1.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				// Do nothing, it will be never be called
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			client1RunCh := make(chan error)
			go func() {
				client1RunCh <- client1.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

			errUnsubscribeOne := client1.Unsubscribe(subscriptionOneID)
			require.NoError(t, errUnsubscribeOne)
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

			subscriptionTwoID, err := client2.Subscribe(&subscriptionTwo, nil, func(dataValue []byte, errValue error) error {
				// Do nothing, it will be never be called
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionTwoID)

			client2RunCh := make(chan error)
			go func() {
				client2RunCh <- client2.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

			// Unsubscribe from the second subscription
			errUnsubscribeTwo := client2.Unsubscribe(subscriptionTwoID)
			require.NoError(t, errUnsubscribeTwo)
			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)

			// close the first client
			errClose1 := client1.Close()
			require.NoError(t, errClose1)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, client1RunCh, func(t *testing.T, client1RunErr error) {
				require.NoError(t, client1RunErr)
			})

			// close the second client
			errClose2 := client2.Close()
			require.NoError(t, errClose2)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, client2RunCh, func(t *testing.T, client2RunErr error) {
				require.NoError(t, client2RunErr)
			})
		})
	})

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

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Warm-up: confirm the subscription pipeline is fully active
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionMyNats, xEnv.GetPubSubName("employeeUpdatedMyNats.12"), []byte(`{"id":13,"__typename":"Employee"}`), 1, EventWaitTimeout)

			err = conn.SetReadDeadline(time.Now().Add(EventWaitTimeout))
			require.NoError(t, err)
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			err = conn.SetReadDeadline(time.Time{})
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(13), payload.Data.EmployeeUpdatedMyNats.ID)

			// Trigger second subscription via NATS on different subject
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionMyNats, xEnv.GetPubSubName("employeeUpdatedMyNatsTwo.12"), []byte(`{"id":99,"__typename":"Employee"}`), 2, EventWaitTimeout)

			err = conn.SetReadDeadline(time.Now().Add(EventWaitTimeout))
			require.NoError(t, err)
			err = conn.ReadJSON(&msg)
			require.NoError(t, err)
			err = conn.SetReadDeadline(time.Time{})
			require.NoError(t, err)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			err = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, err)
			require.Equal(t, float64(99), payload.Data.EmployeeUpdatedMyNats.ID)
		})
	})

	t.Run("start multiple subscriptions and hot reload should stop all the subscriptions and after restart they should work", func(t *testing.T) {
		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			NoRetryClient: true,
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Wait for the config poller to be ready
			<-pm.ready

			var subscriptionMyNats struct {
				employeeUpdatedMyNats struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Surname string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdatedMyNats(id: 1)"`
			}

			var subscriptionNats struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Surname string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 1)"`
			}

			var subscriptionNats2 struct {
				employeeUpdated struct {
					ID      float64 `graphql:"id"`
					Details struct {
						Surname string `graphql:"surname"`
					} `graphql:"details"`
				} `graphql:"employeeUpdated(employeeID: 2)"`
			}

			surl := xEnv.GraphQLWebSocketSubscriptionURL()
			client1 := graphql.NewSubscriptionClient(surl)
			client2 := graphql.NewSubscriptionClient(surl)
			client3 := graphql.NewSubscriptionClient(surl)
			sub1DataCh := make(chan natsSubscriptionArgs)
			subscription1ID, err := client1.Subscribe(&subscriptionMyNats, nil, func(dataValue []byte, errValue error) error {
				sub1DataCh <- natsSubscriptionArgs{
					dataValue,
					errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscription1ID)

			client1Done := testenv.Go(client1.Run)

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)

			sub2DataCh := make(chan natsSubscriptionArgs)
			subscription2ID, err := client2.Subscribe(&subscriptionNats, nil, func(dataValue []byte, errValue error) error {
				sub2DataCh <- natsSubscriptionArgs{
					dataValue,
					errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscription2ID)

			client2Done := testenv.Go(client2.Run)

			xEnv.WaitForSubscriptionCount(2, EventWaitTimeout)

			sub3DataCh := make(chan natsSubscriptionArgs)
			subscription3ID, err := client3.Subscribe(&subscriptionNats2, nil, func(dataValue []byte, errValue error) error {
				sub3DataCh <- natsSubscriptionArgs{
					dataValue,
					errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscription3ID)

			client3Done := testenv.Go(client3.Run)

			xEnv.WaitForSubscriptionCount(3, EventWaitTimeout)

			// Swap config
			require.NoError(t, pm.updateConfig(pm.initConfig, "old-1"))

			// Wait for all providers to shut down and restart
			require.Eventually(t, func() bool {
				defaultLogs := xEnv.Observer().FilterField(zapcore.Field{
					Type:   zapcore.StringType,
					Key:    "provider_id",
					String: "default",
				})
				myNatsLogs := xEnv.Observer().FilterField(zapcore.Field{
					Type:   zapcore.StringType,
					Key:    "provider_id",
					String: "my-nats",
				})
				return myNatsLogs.FilterMessage("NATS connection established").Len() == 4 &&
					myNatsLogs.FilterMessage("NATS disconnected").Len() == 1 &&
					myNatsLogs.FilterMessage("NATS connection closed").Len() == 1 &&
					defaultLogs.FilterMessage("NATS connection established").Len() == 4 &&
					defaultLogs.FilterMessage("NATS disconnected").Len() == 1 &&
					defaultLogs.FilterMessage("NATS connection closed").Len() == 1
			}, EventWaitTimeout, time.Second)

			// Then wait for subscriptions to be started again
			xEnv.WaitForSubscriptionCount(3, EventWaitTimeout)
			xEnv.WaitForTriggerCount(3, EventWaitTimeout)

			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.1"), []byte(`{"id":1,"__typename":"Employee"}`), 1, EventWaitTimeout)
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.2"), []byte(`{"id":2,"__typename":"Employee"}`), 1, EventWaitTimeout)
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionMyNats, xEnv.GetPubSubName("employeeUpdatedMyNats.1"), []byte(`{"id":1,"__typename":"Employee"}`), 1, EventWaitTimeout)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, sub1DataCh, func(t *testing.T, data natsSubscriptionArgs) {
				assert.NoError(t, data.errValue)
				assert.Equal(t, data.dataValue, []byte(`{"employeeUpdatedMyNats":{"id":1,"details":{"surname":"Neuse"}}}`))
			}, "unable to receive data on subscription 1 before timeout")

			testenv.AwaitChannelWithT(t, EventWaitTimeout, sub2DataCh, func(t *testing.T, data natsSubscriptionArgs) {
				assert.NoError(t, data.errValue)
				assert.Equal(t, data.dataValue, []byte(`{"employeeUpdated":{"id":1,"details":{"surname":"Neuse"}}}`))
			}, "unable to receive data on subscription 2 before timeout")

			testenv.AwaitChannelWithT(t, EventWaitTimeout, sub3DataCh, func(t *testing.T, data natsSubscriptionArgs) {
				assert.NoError(t, data.errValue)
				assert.Equal(t, data.dataValue, []byte(`{"employeeUpdated":{"id":2,"details":{"surname":"Deus"}}}`))
			}, "unable to receive data on subscription 3 before timeout")

			// Unsubscribe from all the subscriptions
			errUnsubscribeOne := client1.Unsubscribe(subscription1ID)
			require.NoError(t, errUnsubscribeOne)
			errUnsubscribeTwo := client2.Unsubscribe(subscription2ID)
			require.NoError(t, errUnsubscribeTwo)
			errUnsubscribeThree := client3.Unsubscribe(subscription3ID)
			require.NoError(t, errUnsubscribeThree)

			// close the first client
			errClose1 := client1.Close()
			require.NoError(t, errClose1)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, client1Done, func(t *testing.T, client1RunErr error) {
				require.NoError(t, client1RunErr)
			})

			// close the second client
			errClose2 := client2.Close()
			require.NoError(t, errClose2)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, client2Done, func(t *testing.T, client2RunErr error) {
				require.NoError(t, client2RunErr)
			})

			// close the third client
			errClose3 := client3.Close()
			require.NoError(t, errClose3)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, client3Done, func(t *testing.T, client3RunErr error) {
				require.NoError(t, client3RunErr)
			})
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
			subscriptionArgsCh := make(chan natsSubscriptionArgs)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- natsSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			clientRunErrCh := make(chan error)

			go func() {
				clientErr := client.Run()
				clientRunErrCh <- clientErr
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Warm-up: confirm the subscription pipeline is fully active
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`), 1, EventWaitTimeout)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(``)) // Empty message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				var gqlErr graphql.Errors
				require.ErrorAs(t, args.errValue, &gqlErr)
				require.Equal(t, "Invalid message received", gqlErr[0].Message)
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","update":{"name":"foo"}}`)) // Missing id
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.ErrorContains(t, args.errValue, "Cannot return null for non-nullable field 'Subscription.employeeUpdated.id'.")
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)

			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, args natsSubscriptionArgs) {
				require.NoError(t, args.errValue)
				require.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(args.dataValue))
			})

			require.NoError(t, client.Close())
			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunErrCh, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "unable to close client before timeout")

			xEnv.WaitForSubscriptionCount(0, EventWaitTimeout)
			xEnv.WaitForConnectionCount(0, EventWaitTimeout)
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

			subscriptionArgsCh := make(chan natsSubscriptionArgs)

			subscriptionOneID, err := client.Subscribe(&subscriptionOne, nil, func(dataValue []byte, errValue error) error {
				subscriptionArgsCh <- natsSubscriptionArgs{
					dataValue: dataValue,
					errValue:  errValue,
				}
				return nil
			})
			require.NoError(t, err)
			require.NotEqual(t, "", subscriptionOneID)

			clientRunCh := make(chan error)
			go func() {
				clientRunCh <- client.Run()
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Warm-up: confirm the subscription pipeline is fully active
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`), 1, EventWaitTimeout)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, subscriptionArgs natsSubscriptionArgs) {
				assert.NoError(t, subscriptionArgs.errValue)
				assert.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(subscriptionArgs.dataValue))
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{asas`)) // Invalid message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, subscriptionArgs natsSubscriptionArgs) {
				assert.ErrorContains(t, subscriptionArgs.errValue, "Invalid message received")
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, subscriptionArgs natsSubscriptionArgs) {
				assert.NoError(t, subscriptionArgs.errValue)
				assert.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(subscriptionArgs.dataValue))
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","update":{"name":"foo"}}`)) // Missing id
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, subscriptionArgs natsSubscriptionArgs) {
				assert.ErrorContains(t, subscriptionArgs.errValue, "Cannot return null for non-nullable field 'Subscription.employeeUpdated.id'.")
			})

			err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.3"), []byte(`{"__typename":"Employee","id": 3,"update":{"name":"foo"}}`)) // Correct message
			require.NoError(t, err)
			err = xEnv.NatsConnectionDefault.Flush()
			require.NoError(t, err)
			testenv.AwaitChannelWithT(t, EventWaitTimeout, subscriptionArgsCh, func(t *testing.T, subscriptionArgs natsSubscriptionArgs) {
				assert.NoError(t, subscriptionArgs.errValue)
				assert.JSONEq(t, `{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}`, string(subscriptionArgs.dataValue))
			})

			require.NoError(t, client.Close())

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientRunCh, func(t *testing.T, clientRunErr error) {
				require.NoError(t, clientRunErr)
			}, "unable to close client before timeout")
		})
	})
}

func TestFlakyNatsEvents(t *testing.T) {
	t.Parallel()

	t.Run("subscribe sse with filter", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
		}, func(t *testing.T, xEnv *testenv.Environment) {

			subscribePayload := []byte(`{"query":"subscription { filteredEmployeeUpdated(id: 1) { id details { forename surname } } }"}`)

			// Use a context with timeout to prevent SSE reads from blocking
			// for the full 8-minute Go test timeout if a message is lost.
			ctx, cancel := context.WithTimeout(xEnv.Context, EventWaitTimeout)
			defer cancel()

			client := http.Client{}
			req, gErr := http.NewRequestWithContext(ctx, http.MethodPost, xEnv.GraphQLRequestURL(), bytes.NewReader(subscribePayload))
			require.NoError(t, gErr)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			req.Header.Set("Connection", "keep-alive")
			req.Header.Set("Cache-Control", "no-cache")

			var clientDoCh = make(chan struct {
				resp *http.Response
				err  error
			})
			go func() {
				resp, gErr := client.Do(req)
				clientDoCh <- struct {
					resp *http.Response
					err  error
				}{resp, gErr}
			}()

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			// Warm-up: confirm subscription pipeline is fully active
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.1"), []byte(`{"id":1,"__typename": "Employee"}`), 1, EventWaitTimeout)

			var resp *http.Response

			testenv.AwaitChannelWithT(t, EventWaitTimeout, clientDoCh, func(t *testing.T, clientDo struct {
				resp *http.Response
				err  error
			}) {
				resp = clientDo.resp
				require.NoError(t, clientDo.err)
			})

			require.Equal(t, http.StatusOK, resp.StatusCode)
			defer resp.Body.Close()

			require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
			require.Equal(t, "no-cache", resp.Header.Get("Cache-Control"))
			require.Equal(t, "keep-alive", resp.Header.Get("Connection"))
			require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"))

			reader := bufio.NewReader(resp.Body)

			testData := map[int]struct{ forename, surname string }{
				1:  {forename: "Jens", surname: "Neuse"},
				3:  {forename: "Stefan", surname: "Avram"},
				4:  {forename: "Björn", surname: "Schwenzer"},
				5:  {forename: "Sergiy", surname: "Petrunin"},
				7:  {forename: "Suvij", surname: "Surya"},
				8:  {forename: "Nithin", surname: "Kumar"},
				11: {forename: "Alexandra", surname: "Neuse"},
			}

			eventNext := testenv.ReadSSEField(t, reader)
			require.Equal(t, "event: next", eventNext)
			data := testenv.ReadSSEField(t, reader)
			require.Equal(t, fmt.Sprintf("data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":%d,\"details\":{\"forename\":\"%s\",\"surname\":\"%s\"}}}}", 1, testData[1].forename, testData[1].surname), data)

			// This loop tests the filter with events 2-12.
			// Of these, 6 should be included: 3, 4, 5, 7, 8, and 11.
			for i := 2; i < 13; i++ {
				err := xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.1"), []byte(fmt.Sprintf(`{"id":%d,"__typename": "Employee"}`, i)))
				require.NoError(t, err)

				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				switch i {
				case 3, 4, 5, 7, 8, 11:
					eventNext = testenv.ReadSSEField(t, reader)
					require.Equal(t, "event: next", eventNext)
					data = testenv.ReadSSEField(t, reader)
					require.Equal(t, fmt.Sprintf("data: {\"data\":{\"filteredEmployeeUpdated\":{\"id\":%d,\"details\":{\"forename\":\"%s\",\"surname\":\"%s\"}}}}", i, testData[i].forename, testData[i].surname), data)
				}
			}
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

			xEnv.WaitForSubscriptionCount(1, EventWaitTimeout)
			xEnv.WaitForTriggerCount(1, EventWaitTimeout)

			testData := map[uint32]struct{ forename, surname string }{
				1:  {forename: "Jens", surname: "Neuse"},
				3:  {forename: "Stefan", surname: "Avram"},
				4:  {forename: "Björn", surname: "Schwenzer"},
				5:  {forename: "Sergiy", surname: "Petrunin"},
				7:  {forename: "Suvij", surname: "Surya"},
				8:  {forename: "Nithin", surname: "Kumar"},
				11: {forename: "Alexandra", surname: "Neuse"},
			}

			var msg testenv.WebSocketMessage
			var payload subscriptionPayload

			// Warm-up: confirm subscription pipeline is fully active
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, xEnv.GetPubSubName("employeeUpdated.1"), []byte(`{"id":1,"__typename":"Employee"}`), 1, EventWaitTimeout)
			conn.SetReadDeadline(time.Now().Add(EventWaitTimeout))
			gErr := conn.ReadJSON(&msg)
			require.NoError(t, gErr)
			require.Equal(t, "1", msg.ID)
			require.Equal(t, "next", msg.Type)
			gErr = json.Unmarshal(msg.Payload, &payload)
			require.NoError(t, gErr)
			require.Equal(t, float64(1), payload.Data.FilteredEmployeeUpdated.ID)
			require.Equal(t, testData[1].forename, payload.Data.FilteredEmployeeUpdated.Details.Forename)
			require.Equal(t, testData[1].surname, payload.Data.FilteredEmployeeUpdated.Details.Surname)

			// This loop tests the filter with events 2-12.
			// Of these, 6 should be included: 3, 4, 5, 7, 8, and 11.
			for i := uint32(2); i < 13; i++ {
				err = xEnv.NatsConnectionDefault.Publish(xEnv.GetPubSubName("employeeUpdated.1"), []byte(fmt.Sprintf(`{"id":%d,"__typename":"Employee"}`, i)))
				require.NoError(t, err)
				err = xEnv.NatsConnectionDefault.Flush()
				require.NoError(t, err)

				switch i {
				case 3, 4, 5, 7, 8, 11:
					conn.SetReadDeadline(time.Now().Add(EventWaitTimeout))
					gErr = conn.ReadJSON(&msg)
					require.NoError(t, gErr)
					require.Equal(t, "1", msg.ID)
					require.Equal(t, "next", msg.Type)
					gErr = json.Unmarshal(msg.Payload, &payload)
					require.NoError(t, gErr)
					require.Equal(t, float64(i), payload.Data.FilteredEmployeeUpdated.ID)
					require.Equal(t, testData[i].forename, payload.Data.FilteredEmployeeUpdated.Details.Forename)
					require.Equal(t, testData[i].surname, payload.Data.FilteredEmployeeUpdated.Details.Surname)
				}
			}
		})
	})
}
