package integration

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
)

// A hot reload closes the previous graph mux's caches while WebSocket messages,
// which the in-flight request wait doesn't track, may still be planning through
// them. That panicked with "send on closed channel" and crashed the router.
func TestHotReloadClosesCachesWhileWebSocketMessagesAreInFlight(t *testing.T) {
	t.Parallel()

	poller := newFakeConfigPoller(buildHelloRouterConfig("v0", "Hello!", nil))

	testenv.Run(t, &testenv.Config{
		RouterConfig: &testenv.RouterConfig{
			ConfigPollerFactory: func(_ *nodev1.RouterConfig) configpoller.ConfigPoller { return poller },
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx, cancel := context.WithCancel(t.Context())
		var wg sync.WaitGroup
		defer wg.Wait()
		defer cancel()
		var sent atomic.Int64

		for w := range 4 {
			wg.Go(func() {
				// Reloads close the connection, so keep reconnecting until stopped.
				for n := 0; ctx.Err() == nil; {
					conn, _, err := xEnv.GraphQLWebsocketDialWithRetry(nil, nil)
					if err != nil {
						continue
					}
					go func() { // Read the responses so the router never blocks writing them.
						for {
							if _, _, err := conn.ReadMessage(); err != nil {
								return
							}
						}
					}()
					err = conn.WriteJSON(testenv.WebSocketMessage{Type: "connection_init"})
					for ; err == nil && ctx.Err() == nil; n++ {
						// A distinct operation per message misses the caches and writes to them.
						payload := fmt.Appendf(nil, `{"query":"query Q%d_%d { a%d: hello }"}`, w, n, n)
						_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second)) // a stalled write must not hang the test
						err = conn.WriteJSON(testenv.WebSocketMessage{ID: fmt.Sprint(n), Type: "subscribe", Payload: payload})
						if err == nil {
							sent.Add(1)
						}
					}
					_ = conn.Close()
				}
			})
		}

		for i := range 300 {
			// Reload only once more messages are on their way.
			target := sent.Load() + 1000
			require.Eventually(t, func() bool { return sent.Load() >= target }, 10*time.Second, time.Millisecond,
				"no WebSocket messages were sent")
			require.NoError(t, poller.Emit(t, buildHelloRouterConfig(fmt.Sprintf("v%d", i+1), "Hello!", nil), nil))
		}
	})
}
