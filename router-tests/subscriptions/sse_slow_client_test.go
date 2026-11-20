package integration

import (
	"bufio"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestSSESlowClientStallsOtherClients pins how a client that stops reading its SSE
// stream affects other clients. A blocked write holds up:
//   - the next event for every client on the same trigger, because the trigger waits
//     for all writes of an event before it handles the next one;
//   - heartbeats for every client on the router, because one goroutine sends them
//     one subscription at a time.
//
// Both stalls last until the SSE write timeout removes the blocked client.
func TestSSESlowClientStallsOtherClients(t *testing.T) {
	t.Parallel()

	const (
		sseWriteTimeout  = 2 * time.Second
		eventWaitTimeout = 5 * time.Second
		// settleTime lets writes that were already in flight when the client blocked
		// reach the healthy client before the stall is measured.
		settleTime = 500 * time.Millisecond
		// minStall is far above the event and heartbeat intervals used below, so a
		// gap this long can only come from waiting on the blocked write.
		minStall = sseWriteTimeout - settleTime
	)

	t.Run("next event on a shared trigger waits for the blocked client", func(t *testing.T) {
		t.Parallel()

		const eventIntervalMilliseconds = 100

		state := newBlockingSSEWriteState()

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

			client := &http.Client{}
			blocked := openCountEmpSSESubscription(t, client, xEnv.GraphQLRequestURL(), true, eventIntervalMilliseconds)
			defer func() { _ = blocked.Body.Close() }()
			healthy := openCountEmpSSESubscription(t, client, xEnv.GraphQLRequestURL(), false, eventIntervalMilliseconds)
			defer func() { _ = healthy.Body.Close() }()

			xEnv.WaitForSubscriptionCount(2, eventWaitTimeout)
			xEnv.WaitForTriggerCount(1, eventWaitTimeout)
			xEnv.RequireTriggerCount(1)

			events := streamSSELines(healthy.Body, "data: ")
			awaitSSELine(t, events, eventWaitTimeout, "first event on the healthy client")

			state.armed.Store(true)
			blockedAt := awaitBlockedSSEWrite(t, state, eventWaitTimeout)

			stall := measureSSEStall(t, state, events, blockedAt, settleTime, sseWriteTimeout+eventWaitTimeout)
			t.Logf("healthy client waited %s for its next event (event interval %dms)", stall, eventIntervalMilliseconds)
			require.GreaterOrEqual(t, stall, minStall)

			xEnv.WaitForSubscriptionCount(1, eventWaitTimeout)
		})
	})

	t.Run("heartbeats on another trigger wait for the blocked client", func(t *testing.T) {
		t.Parallel()

		const heartbeatInterval = 200 * time.Millisecond

		state := newBlockingSSEWriteState()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(&blockingSSEWriterModule{state: state}),
				core.WithSubscriptionHeartbeatInterval(heartbeatInterval),
			},
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.SSEServerWriteTimeout = sseWriteTimeout
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			defer close(state.release)

			// Different arguments give each client its own trigger. The long interval
			// means each stream carries one event and then only heartbeats.
			client := &http.Client{}
			blocked := openCountEmpSSESubscription(t, client, xEnv.GraphQLRequestURL(), true, 60_000)
			defer func() { _ = blocked.Body.Close() }()
			healthy := openCountEmpSSESubscription(t, client, xEnv.GraphQLRequestURL(), false, 60_001)
			defer func() { _ = healthy.Body.Close() }()

			xEnv.WaitForSubscriptionCount(2, eventWaitTimeout)
			xEnv.WaitForTriggerCount(2, eventWaitTimeout)
			xEnv.RequireTriggerCount(2)

			// The blocked client's only event must be out before arming, so that the
			// write that blocks is a heartbeat.
			readSSEData(t, bufio.NewReader(blocked.Body))

			heartbeats := streamSSELines(healthy.Body, ":heartbeat")
			awaitSSELine(t, heartbeats, eventWaitTimeout, "first heartbeat on the healthy client")

			state.armed.Store(true)
			blockedAt := awaitBlockedSSEWrite(t, state, eventWaitTimeout)

			stall := measureSSEStall(t, state, heartbeats, blockedAt, settleTime, sseWriteTimeout+eventWaitTimeout)
			t.Logf("healthy client waited %s for its next heartbeat (heartbeat interval %s)", stall, heartbeatInterval)
			require.GreaterOrEqual(t, stall, minStall)

			xEnv.WaitForSubscriptionCount(1, eventWaitTimeout)
		})
	})
}

func newBlockingSSEWriteState() *blockingSSEWriteState {
	return &blockingSSEWriteState{
		writeStarted: make(chan struct{}),
		writeDone:    make(chan struct{}),
		release:      make(chan struct{}),
	}
}

// streamSSELines reads body in the background and reports when each line starting
// with prefix arrived. The channel is closed when the stream ends.
func streamSSELines(body io.Reader, prefix string) <-chan time.Time {
	arrivals := make(chan time.Time, 64)
	go func() {
		defer close(arrivals)
		reader := bufio.NewReader(body)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if strings.HasPrefix(line, prefix) {
				arrivals <- time.Now()
			}
		}
	}()
	return arrivals
}

func awaitSSELine(t *testing.T, arrivals <-chan time.Time, timeout time.Duration, what string) time.Time {
	t.Helper()

	select {
	case at, ok := <-arrivals:
		require.True(t, ok, "stream ended while waiting for %s", what)
		return at
	case <-time.After(timeout):
		t.Fatalf("timed out waiting for %s", what)
		return time.Time{}
	}
}

func awaitBlockedSSEWrite(t *testing.T, state *blockingSSEWriteState, timeout time.Duration) time.Time {
	t.Helper()

	select {
	case <-state.writeStarted:
		return time.Now()
	case <-time.After(timeout):
		t.Fatal("timed out waiting for the SSE write to block")
		return time.Time{}
	}
}

// measureSSEStall returns how long after blockedAt the healthy client received its
// next line. It fails if a line arrives while the blocked write is still pending,
// because that means the healthy client was not held up.
func measureSSEStall(
	t *testing.T,
	state *blockingSSEWriteState,
	arrivals <-chan time.Time,
	blockedAt time.Time,
	settleTime time.Duration,
	timeout time.Duration,
) time.Duration {
	t.Helper()

	// Drop lines whose writes were already in flight when the client blocked.
	settled := time.After(settleTime)
drain:
	for {
		select {
		case _, ok := <-arrivals:
			require.True(t, ok, "healthy stream ended while the other client was blocked")
		case <-settled:
			break drain
		}
	}

	deadline := time.After(timeout)
	select {
	case at, ok := <-arrivals:
		require.True(t, ok, "healthy stream ended while the other client was blocked")
		select {
		case <-state.writeDone:
		default:
			t.Fatalf("healthy client received a line %s after the other client blocked, before the blocked write returned", at.Sub(blockedAt))
		}
		return at.Sub(blockedAt)
	case <-state.writeDone:
	case <-deadline:
		t.Fatal("blocked SSE write did not return after its deadline")
	}

	select {
	case at, ok := <-arrivals:
		require.True(t, ok, "healthy stream ended after the blocked write returned")
		return at.Sub(blockedAt)
	case <-deadline:
		t.Fatal("healthy client received nothing after the blocked write returned")
		return 0
	}
}
