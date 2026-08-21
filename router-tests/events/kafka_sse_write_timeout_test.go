package events_test

import (
	"bufio"
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/events"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const blockSSEWriteHeader = "X-Test-Block-SSE-Write"

var (
	_ core.Module                 = (*blockingSSEWriterModule)(nil)
	_ core.RouterOnRequestHandler = (*blockingSSEWriterModule)(nil)
)

// blockingSSEWriterModule simulates a client that stops draining its SSE
// connection without closing it. The wrapped writer only returns when the
// router sets a write deadline or the test releases it during cleanup.
type blockingSSEWriterModule struct {
	armed         *atomic.Bool
	writeStarted  chan struct{}
	startedOnce   *sync.Once
	writeReturned *atomic.Bool
	returned      chan struct{}
	returnedOnce  *sync.Once
	release       chan struct{}
}

func (m *blockingSSEWriterModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "blockingSSEWriterModule",
		Priority: 1,
		New: func() core.Module {
			return &blockingSSEWriterModule{
				armed:         m.armed,
				writeStarted:  m.writeStarted,
				startedOnce:   m.startedOnce,
				writeReturned: m.writeReturned,
				returned:      m.returned,
				returnedOnce:  m.returnedOnce,
				release:       m.release,
			}
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
		armed:          m.armed,
		writeStarted:   m.writeStarted,
		startedOnce:    m.startedOnce,
		writeReturned:  m.writeReturned,
		returned:       m.returned,
		returnedOnce:   m.returnedOnce,
		release:        m.release,
	}, ctx.Request())
}

type deadlineBlockingResponseWriter struct {
	http.ResponseWriter
	armed         *atomic.Bool
	writeStarted  chan struct{}
	startedOnce   *sync.Once
	writeReturned *atomic.Bool
	returned      chan struct{}
	returnedOnce  *sync.Once
	release       chan struct{}
	deadlineNanos atomic.Int64
}

func (w *deadlineBlockingResponseWriter) Write(data []byte) (int, error) {
	if !w.armed.CompareAndSwap(true, false) {
		return w.ResponseWriter.Write(data)
	}

	w.startedOnce.Do(func() { close(w.writeStarted) })
	defer func() {
		w.writeReturned.Store(true)
		w.returnedOnce.Do(func() { close(w.returned) })
	}()
	deadlineNanos := w.deadlineNanos.Load()
	if deadlineNanos == 0 {
		<-w.release
		return 0, os.ErrDeadlineExceeded
	}

	wait := time.Until(time.Unix(0, deadlineNanos))
	if wait <= 0 {
		return 0, os.ErrDeadlineExceeded
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-w.release:
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
	w.deadlineNanos.Store(deadline.UnixNano())
	return nil
}

func (w *deadlineBlockingResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func TestKafkaSubscriptionRecoversAfterSSEWriteTimeout(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping Kafka integration test in short mode")
	}

	const (
		topic           = "employeeUpdated-sse-write-timeout"
		sseWriteTimeout = 3 * time.Second
		healthyClients  = 2
	)
	armed := &atomic.Bool{}
	writeStarted := make(chan struct{})
	writeReturned := &atomic.Bool{}
	returned := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })

	module := &blockingSSEWriterModule{
		armed:         armed,
		writeStarted:  writeStarted,
		startedOnce:   &sync.Once{},
		writeReturned: writeReturned,
		returned:      returned,
		returnedOnce:  &sync.Once{},
		release:       release,
	}

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithEdfsKafkaJSONTemplate,
		EnableKafka:              true,
		RouterOptions:            []core.Option{core.WithCustomModules(module)},
		ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
			overrideKafkaTopicsForField(t, routerConfig, "employeeUpdatedMyKafka",
				[]string{"employeeUpdated", "employeeUpdatedTwo"}, topic)
		},
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.SSEServerWriteTimeout = sseWriteTimeout
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		events.KafkaEnsureTopicExists(t, xEnv, EventWaitTimeout, topic)

		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		client := &http.Client{}
		blockedResp := openSSESubscription(t, ctx, client, xEnv.GraphQLRequestURL(), true)
		defer blockedResp.Body.Close()
		healthyReaders := make([]*bufio.Reader, 0, healthyClients)
		for range healthyClients {
			healthyResp := openSSESubscription(t, ctx, client, xEnv.GraphQLRequestURL(), false)
			defer healthyResp.Body.Close()
			healthyReaders = append(healthyReaders, bufio.NewReader(healthyResp.Body))
		}

		xEnv.WaitForSubscriptionCount(healthyClients+1, EventWaitTimeout)
		xEnv.WaitForTriggerCount(1, EventWaitTimeout)

		armed.Store(true)
		xEnv.KafkaPublishUntilReceived(topic,
			`{"__typename":"Employee","id":1,"update":{"name":"blocked"}}`, 1, EventWaitTimeout)

		select {
		case <-writeStarted:
		case <-time.After(EventWaitTimeout):
			t.Fatal("timed out waiting for the SSE write to block")
		}

		for _, reader := range healthyReaders {
			require.Contains(t, readSSEData(t, reader), `"id":1`)
		}

		type readResult struct {
			data                    string
			err                     error
			blockedWriteHadReturned bool
		}
		recovery := make(chan readResult, healthyClients)
		for _, reader := range healthyReaders {
			go func() {
				data, err := readSSEDataLine(reader)
				recovery <- readResult{
					data:                    data,
					err:                     err,
					blockedWriteHadReturned: writeReturned.Load(),
				}
			}()
		}

		// Queue the next provider event while the first event's shared-trigger
		// dispatch is still blocked on one subscriber's SSE write.
		events.ProduceKafkaMessage(t, xEnv, EventWaitTimeout, topic,
			`{"__typename":"Employee","id":2,"update":{"name":"recovery"}}`)
		require.False(t, writeReturned.Load(), "blocked SSE write returned before the second event was queued")

		select {
		case <-returned:
		case <-time.After(sseWriteTimeout + time.Second):
			t.Fatal("blocked SSE write did not return after its deadline")
		}

		xEnv.WaitForSubscriptionCount(healthyClients, EventWaitTimeout)
		for range healthyClients {
			select {
			case result := <-recovery:
				require.NoError(t, result.err)
				require.True(t, result.blockedWriteHadReturned,
					"healthy subscription received the queued event while shared-trigger dispatch was blocked")
				require.Contains(t, result.data, `"id":2`)
			case <-time.After(EventWaitTimeout):
				t.Fatal("healthy subscription did not receive the queued event after the SSE write deadline")
			}
		}
	})
}

func openSSESubscription(t *testing.T, ctx context.Context, client *http.Client, url string, blocked bool) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url,
		strings.NewReader(`{"query":"subscription { employeeUpdatedMyKafka(employeeID: 3) { id } }"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if blocked {
		req.Header.Set(blockSSEWriteHeader, "true")
	}

	resp, err := client.Do(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
	return resp
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
