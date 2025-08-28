package integration

import (
	"bufio"
	"bytes"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

func readMultipartPrefix(reader *bufio.Reader) error {
	blankHeader, _, err := reader.ReadLine()
	if err != nil {
		return err
	}

	if len(blankHeader) != 0 {
		return fmt.Errorf("expected blank header, got %q", blankHeader)
	}

	graphQLHeader, _, err := reader.ReadLine()
	if err != nil {
		return err
	}

	if string(graphQLHeader) != "--graphql" {
		return fmt.Errorf("expected graphql header, got %q", graphQLHeader)
	}

	contentTypeHeader, _, err := reader.ReadLine()
	if err != nil {
		return err
	}

	if string(contentTypeHeader) != "Content-Type: application/json" {
		return fmt.Errorf("expected content type header, got %q", contentTypeHeader)
	}

	blankFooter, _, err := reader.ReadLine()
	if err != nil {
		return err
	}

	if len(blankFooter) != 0 {
		return fmt.Errorf("expected blank footer, got %q", blankFooter)
	}

	return nil
}

func TestHeartbeats(t *testing.T) {
	subscriptionHeartbeatInterval := time.Millisecond * 300

	t.Run("should work correctly for multipart", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithSubscriptionHeartbeatInterval(subscriptionHeartbeatInterval),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			client := http.Client{
				Timeout: time.Second * 100,
			}

			subscribePayload := []byte(`{"query":"subscription { countEmp(max: 5, intervalMilliseconds: 550) }"}`)

			req := xEnv.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(subscribePayload))
			resp, gErr := client.Do(req)
			require.NoError(t, gErr)
			require.Equal(t, http.StatusOK, resp.StatusCode)

			defer resp.Body.Close()
			reader := bufio.NewReader(resp.Body)

			messages := make(chan string, 1)

			go func() {
				defer close(messages)
				for {
					err := readMultipartPrefix(reader)
					if err != nil {
						return
					}

					line, _, err := reader.ReadLine()
					if err != nil {
						return
					}

					fmt.Println(string(line))
					messages <- string(line)
				}
			}()

			for i := 0; i <= 5; i++ {
				testenv.AwaitChannelWithT(t, 5*time.Second, messages, func(t *testing.T, msg string) {
					assert.Equal(t, fmt.Sprintf(`{"payload":{"data":{"countEmp":%d}}}`, i), msg)
				})

				testenv.AwaitChannelWithT(t, 5*time.Second, messages, func(t *testing.T, msg string) {
					assert.Equal(t, `{}`, msg)
				})
			}

			// Channel should be closed after all heartbeats are received
			testenv.AwaitChannelWithCloseWithT(t, 5*time.Second, messages, func(t *testing.T, _ string, ok bool) {
				require.False(t, ok, "channel should be closed")
			})
		})
	})

	t.Run("should work correctly for sse", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithSubscriptionHeartbeatInterval(subscriptionHeartbeatInterval),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			client := http.Client{
				Timeout: time.Second * 100,
			}

			subscribePayload := []byte(`{"query":"subscription { countEmp(max: 5, intervalMilliseconds: 550) }"}`)

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

			lines := make(chan string, 50)

			go func() {
				defer close(lines)
				for {
					line, _, err := reader.ReadLine()
					if err != nil {
						return
					}
					lines <- string(line)
				}
			}()

			// Assert the expected SSE sequence
			for i := 0; i <= 5; i++ {
				// Expect "event: next"
				testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
					assert.Equal(t, "event: next", line)
				})

				// Expect data line with count
				testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
					assert.Equal(t, fmt.Sprintf(`data: {"data":{"countEmp":%d}}`, i), line)
				})

				// Expect blank line
				testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
					assert.Equal(t, "", line)
				})

				// Expect heartbeat
				testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
					assert.Equal(t, ":heartbeat", line)
				})

				// Expect blank line after heartbeat
				testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
					assert.Equal(t, "", line)
				})
			}

			// Expect completion event
			testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
				assert.Equal(t, "event: complete", line)
			})

			// Expect empty data line event
			testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
				assert.Equal(t, "data: ", line)
			})

			// Expect blank line after complete
			testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
				assert.Equal(t, "", line)
			})
		})
	})
}
