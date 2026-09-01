package integration

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
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

func TestHTTPMultipartSubscriptions(t *testing.T) {
	subscriptionHeartbeatInterval := time.Millisecond * 300

	t.Run("send heartbeats while waiting for data", func(t *testing.T) {
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
}

func TestSSESubscriptions(t *testing.T) {
	subscriptionHeartbeatInterval := time.Millisecond * 300

	t.Run("send heartbeats while waiting for data", func(t *testing.T) {
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

	t.Run("write upstream subscription errors", func(t *testing.T) {
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

	testSSEWriteTimeout(t)
	testSSENonFlusherWriter(t)
}

const blockSSEWriteHeader = "X-Test-Block-SSE-Write"

var (
	_ core.Module                 = (*blockingSSEWriterModule)(nil)
	_ core.RouterOnRequestHandler = (*blockingSSEWriterModule)(nil)
)

type blockingSSEWriteState struct {
	armed        atomic.Bool
	writeStarted chan struct{}
	writeDone    chan struct{}
	release      chan struct{}
}

type blockingSSEWriterModule struct {
	state *blockingSSEWriteState
}

func (m *blockingSSEWriterModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "blockingSSEWriterModule",
		Priority: 1,
		New: func() core.Module {
			return &blockingSSEWriterModule{state: m.state}
		},
	}
}

func (m *blockingSSEWriterModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	if ctx.Request().Header.Get(blockSSEWriteHeader) != "true" {
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}

	next.ServeHTTP(&deadlineBlockingResponseWriter{
		ResponseWriter: ctx.ResponseWriter(),
		state:          m.state,
	}, ctx.Request())
}

type deadlineBlockingResponseWriter struct {
	http.ResponseWriter
	state         *blockingSSEWriteState
	deadlineNanos atomic.Int64
}

func (w *deadlineBlockingResponseWriter) Write(data []byte) (int, error) {
	if !w.state.armed.CompareAndSwap(true, false) {
		return w.ResponseWriter.Write(data)
	}

	close(w.state.writeStarted)
	defer close(w.state.writeDone)

	deadlineNanos := w.deadlineNanos.Load()
	if deadlineNanos == 0 {
		<-w.state.release
		return 0, os.ErrDeadlineExceeded
	}

	wait := time.Until(time.Unix(0, deadlineNanos))
	if wait <= 0 {
		return 0, os.ErrDeadlineExceeded
	}

	timer := time.NewTimer(wait)
	defer timer.Stop()

	select {
	case <-w.state.release:
		return 0, os.ErrDeadlineExceeded
	case <-timer.C:
		return 0, os.ErrDeadlineExceeded
	}
}

func (w *deadlineBlockingResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *deadlineBlockingResponseWriter) FlushError() error {
	if flusher, ok := w.ResponseWriter.(interface{ FlushError() error }); ok {
		return flusher.FlushError()
	}
	w.Flush()
	return nil
}

func (w *deadlineBlockingResponseWriter) SetWriteDeadline(deadline time.Time) error {
	if deadline.IsZero() {
		w.deadlineNanos.Store(0)
		return nil
	}
	w.deadlineNanos.Store(deadline.UnixNano())
	return nil
}

func (w *deadlineBlockingResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func testSSEWriteTimeout(t *testing.T) {
	t.Run("remain writable after being idle longer than the write timeout", func(t *testing.T) {
		const (
			sseWriteTimeout           = 100 * time.Millisecond
			eventIntervalMilliseconds = 500
			eventWaitTimeout          = 5 * time.Second
		)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithSubscriptionHeartbeatInterval(time.Minute),
			},
			// TLS enables HTTP/2, where an expired SSE write deadline fails the stream.
			TLSConfig: config.TLSConfiguration{
				Server: config.TLSServerConfiguration{
					Enabled:  true,
					CertFile: "../testdata/tls/cert.pem",
					KeyFile:  "../testdata/tls/key.pem",
				},
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.SSEServerWriteTimeout = sseWriteTimeout
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(t.Context(), eventWaitTimeout)
			defer cancel()

			response := openCountEmpSSESubscription(
				t,
				ctx,
				xEnv.RouterClient,
				xEnv.GraphQLRequestURL(),
				false,
				eventIntervalMilliseconds,
			)
			defer response.Body.Close()
			require.Equal(t, 2, response.ProtoMajor)
			reader := bufio.NewReader(response.Body)

			require.JSONEq(t, `{"data":{"countEmp":0}}`, readSSEData(t, reader))
			require.JSONEq(t, `{"data":{"countEmp":1}}`, readSSEData(t, reader))
		})
	})

	t.Run("remove a blocked subscriber after write timeout while a healthy subscriber continues", func(t *testing.T) {
		const (
			sseWriteTimeout  = time.Second
			eventWaitTimeout = 5 * time.Second
		)

		state := &blockingSSEWriteState{
			writeStarted: make(chan struct{}),
			writeDone:    make(chan struct{}),
			release:      make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(&blockingSSEWriterModule{state: state}),
				core.WithSubscriptionHeartbeatInterval(time.Minute),
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.SSEServerWriteTimeout = sseWriteTimeout
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			defer close(state.release)

			ctx, cancel := context.WithTimeout(t.Context(), eventWaitTimeout)
			defer cancel()

			client := &http.Client{}
			blockedResponse := openCountEmpSSESubscription(t, ctx, client, xEnv.GraphQLRequestURL(), true, 250)
			defer blockedResponse.Body.Close()
			healthyResponse := openCountEmpSSESubscription(t, ctx, client, xEnv.GraphQLRequestURL(), false, 250)
			defer healthyResponse.Body.Close()
			healthyReader := bufio.NewReader(healthyResponse.Body)

			xEnv.WaitForSubscriptionCount(2, eventWaitTimeout)
			xEnv.WaitForTriggerCount(1, eventWaitTimeout)
			xEnv.RequireTriggerCount(1)

			readSSEData(t, healthyReader)
			state.armed.Store(true)

			select {
			case <-state.writeStarted:
			case <-time.After(eventWaitTimeout):
				t.Fatal("timed out waiting for the SSE write to block")
			}

			beforeTimeout := readSSEData(t, healthyReader)

			select {
			case <-state.writeDone:
			case <-time.After(sseWriteTimeout + time.Second):
				t.Fatal("blocked SSE write did not return after its deadline")
			}

			xEnv.WaitForSubscriptionCount(1, eventWaitTimeout)
			afterTimeout := readSSEData(t, healthyReader)
			require.NotEqual(t, beforeTimeout, afterTimeout)
		})
	})
}

func openCountEmpSSESubscription(
	t *testing.T,
	ctx context.Context,
	client *http.Client,
	url string,
	blocked bool,
	intervalMilliseconds int,
) *http.Response {
	t.Helper()

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		url,
		strings.NewReader(fmt.Sprintf(
			`{"query":"subscription { countEmp(max: 20, intervalMilliseconds: %d) }"}`,
			intervalMilliseconds,
		)),
	)
	require.NoError(t, err)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	if blocked {
		request.Header.Set(blockSSEWriteHeader, "true")
	}

	response, err := client.Do(request)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.Equal(t, "text/event-stream", response.Header.Get("Content-Type"))
	return response
}

func readSSEData(t *testing.T, reader *bufio.Reader) string {
	t.Helper()

	data, err := readSSEDataLine(reader)
	require.NoError(t, err)
	return data
}

func readSSEDataLine(reader *bufio.Reader) (string, error) {
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data: ") {
			return strings.TrimPrefix(line, "data: "), nil
		}
		if strings.HasPrefix(line, "event: complete") {
			return "", errors.New("subscription completed before receiving data")
		}
	}
}

func testSSENonFlusherWriter(t *testing.T) {
	t.Run("return an error when the response writer cannot flush", func(t *testing.T) {
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

			require.Equal(
				t,
				`event: next
data: {"errors":[{"message":"subscription response writer does not support flushing"}]}`,
				string(body),
			)
		})
	})
}
