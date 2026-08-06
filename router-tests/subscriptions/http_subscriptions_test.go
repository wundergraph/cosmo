package integration

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	non_flusher_writer "github.com/wundergraph/cosmo/router-tests/modules/non-flusher-writer"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
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

			type timestampedMsg struct {
				body string
				at   time.Time
			}
			raw := make(chan timestampedMsg, 50)

			type readerResult struct {
				err      error
				msgCount int
			}
			errCh := make(chan readerResult, 1)

			go func() {
				defer close(raw)
				count := 0
				for {
					err := readMultipartPrefix(reader)
					if err != nil {
						errCh <- readerResult{err: err, msgCount: count}
						return
					}

					line, _, err := reader.ReadLine()
					if err != nil {
						errCh <- readerResult{err: fmt.Errorf("ReadLine after prefix: %w", err), msgCount: count}
						return
					}

					raw <- timestampedMsg{body: string(line), at: time.Now()}
					count++
				}
			}()

			type received struct {
				body         string
				sincePrevMsg time.Duration
			}
			var msgs []received
			var lastReceive time.Time
			for tm := range raw {
				var sincePrev time.Duration
				if !lastReceive.IsZero() {
					sincePrev = tm.at.Sub(lastReceive)
				}
				msgs = append(msgs, received{body: tm.body, sincePrevMsg: sincePrev})
				lastReceive = tm.at
			}

			result := <-errCh
			if errors.Is(result.err, io.EOF) {
				t.Logf("stream ended normally (EOF) after %d messages", result.msgCount)
			} else {
				t.Logf("stream ended: %d messages, final error: %v", result.msgCount, result.err)
			}

			require.NotEmpty(t, msgs,
				"multipart stream closed with 0 messages (reader saw %d frames, error: %v); "+
					"this usually means the SSE connection to the subgraph was reset before any data was sent",
				result.msgCount, result.err)

			// Every message must be either a heartbeat ({}) or the next expected
			// data payload, and gaps between consecutive messages must stay within
			// the allowed threshold.
			maxAllowedGap := subscriptionHeartbeatInterval * 2
			dataIdx := 0
			for _, m := range msgs {
				assert.LessOrEqual(t, m.sincePrevMsg, maxAllowedGap,
					"gap between consecutive messages (%s) exceeded max allowed (%s)", m.sincePrevMsg, maxAllowedGap)
				if m.body == `{}` {
					continue // valid multipart heartbeat
				}
				assert.Equal(t, fmt.Sprintf(`{"payload":{"data":{"countEmp":%d}}}`, dataIdx), m.body)
				dataIdx++
			}
			assert.Equal(t, 6, dataIdx, "expected 6 data messages")
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
			defer resp.Body.Close()
			require.Equal(t, http.StatusOK, resp.StatusCode)

			reader := bufio.NewReader(resp.Body)

			type timestampedLine struct {
				text string
				at   time.Time
			}
			raw := make(chan timestampedLine, 50)

			go func() {
				defer close(raw)
				for {
					line, _, err := reader.ReadLine()
					if err != nil {
						return
					}
					raw <- timestampedLine{text: string(line), at: time.Now()}
				}
			}()

			// For each non-empty line, assert it is one of:
			//   1. ":heartbeat" — valid SSE keep-alive comment
			//   2. "event: next" / "event: complete" — SSE event type framing
			//   3. "data: ..." — the next expected data payload in sequence
			// Additionally, the gap between consecutive data/heartbeat lines must
			// not exceed the allowed threshold.
			maxAllowedGap := subscriptionHeartbeatInterval * 2
			dataIdx := 0
			gotComplete := false
			var lastActivity time.Time
			for tl := range raw {
				switch tl.text {
				case "", "event: next", "data: ":
					continue // SSE framing — not content
				case ":heartbeat":
					// valid SSE heartbeat
				case "event: complete":
					gotComplete = true
				default:
					assert.Equal(t, fmt.Sprintf(`data: {"data":{"countEmp":%d}}`, dataIdx), tl.text)
					dataIdx++
				}

				// Gap check applies to heartbeats, data, and complete events.
				if !lastActivity.IsZero() {
					gap := tl.at.Sub(lastActivity)
					assert.LessOrEqual(t, gap, maxAllowedGap,
						"gap between consecutive activity (%s) exceeded max allowed (%s)", gap, maxAllowedGap)
				}
				lastActivity = tl.at
			}
			assert.Equal(t, 6, dataIdx, "expected 6 data messages")
			assert.True(t, gotComplete, "expected completion event")
		})
	})

	t.Run("should write an error on sse", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithSubscriptionHeartbeatInterval(subscriptionHeartbeatInterval),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(h http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Content-Type", "application/json")
							w.WriteHeader(http.StatusForbidden)
							_, _ = w.Write([]byte(`{"errors":[{"message":"Subgraph forbidden","extensions":{"code":"FORBIDDEN"}}]}`))
						})
					},
				},
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
			defer resp.Body.Close()
			require.Equal(t, http.StatusOK, resp.StatusCode)

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

			testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
				assert.Equal(t, "event: next", line)
			})

			testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
				assert.Equal(t, `data: {"errors":[{"message":"Subscription Upgrade request failed for Subgraph 'employees'.","extensions":{"statusCode":403}}],"data":null}`, line)
			})

			testenv.AwaitChannelWithT(t, 5*time.Second, lines, func(t *testing.T, line string) {
				assert.Equal(t, "", line)
			})
		})
	})
}

func TestNonFlusherWriterSubscriptionError(t *testing.T) {
	t.Parallel()

	t.Run("subscription error when writer cannot flush", func(t *testing.T) {
		t.Parallel()

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]interface{}{
				"nonFlusherWriterModule": non_flusher_writer.NonFlusherWriterModule{},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&non_flusher_writer.NonFlusherWriterModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			req, err := http.NewRequest(http.MethodPost, xEnv.GraphQLRequestURL(), strings.NewReader(`{"query":"subscription { currentTime { unixTime timeStamp } }"}`))
			require.NoError(t, err)

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")

			client := http.Client{}
			resp, err := client.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			require.Equal(t, http.StatusInternalServerError, resp.StatusCode)

			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			require.Contains(t, string(body), "errors")
			require.Contains(t, string(body), "could not flush response")
		})
	})
}
