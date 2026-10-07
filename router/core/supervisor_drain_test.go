package core

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"go.uber.org/zap"
)

func TestSupervisorDrain(t *testing.T) {
	for _, tc := range []struct {
		name                       string
		shutdown                   bool
		period, deadline, wantWait time.Duration
		wantDrain                  bool
	}{
		{"stop", true, 10 * time.Second, 30 * time.Second, 10 * time.Second, true},
		{"reload", false, 10 * time.Second, 30 * time.Second, 0, false},
		{"disabled", true, 0, 30 * time.Second, 0, false},
		{"deadline", true, 10 * time.Second, 3 * time.Second, 3 * time.Second, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				logger := zap.NewNop()
				hc := health.New(&health.Options{Logger: logger})
				hc.SetReady(true)
				srv := &server{healthcheck: hc, drainEnabled: tc.period > 0}
				srv.state.Store(notReadyState)
				routerCtx, routerCancel := context.WithCancel(context.Background())
				defer routerCancel()
				rs := &RouterSupervisor{
					logger:       logger,
					router:       &Router{httpServer: srv, usage: &UsageTrackerNoOp{}, Config: Config{logger: logger}},
					routerCtx:    routerCtx,
					routerCancel: routerCancel,
					resources:    &RouterResources{Config: &config.Config{DrainPeriod: tc.period, ShutdownDelay: tc.deadline}},
				}
				start := time.Now()
				require.NoError(t, rs.stopRouter(tc.shutdown))
				assert.Equal(t, tc.wantWait, time.Since(start))
				assert.Equal(t, tc.wantDrain, srv.draining.Load())
				assert.True(t, rs.router.shutdown.Load())
				assert.ErrorIs(t, routerCtx.Err(), context.Canceled)
			})
		})
	}
}

func TestSupervisorDrain_ActiveRequest(t *testing.T) {
	for _, complete := range []bool{true, false} {
		name := "grace deadline"
		if complete {
			name = "completes during drain"
		}
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				entered, release := make(chan struct{}), make(chan struct{})
				var once sync.Once
				unblock := func() { once.Do(func() { close(release) }) }
				srv, listener := newDrainTestServer(t, func(w http.ResponseWriter, r *http.Request) {
					_, _ = io.Copy(io.Discard, r.Body)
					close(entered)
					<-release
					_, _ = w.Write([]byte("ok"))
				})
				t.Cleanup(unblock)
				conn := dialDrainTestServer(t, listener)
				response := make(chan *http.Response, 1)
				requestDone := make(chan error, 1)
				go func() {
					resp, err := postOnConnection(conn, bufio.NewReader(conn))
					response <- resp
					requestDone <- err
				}()
				<-entered
				routerCtx, routerCancel := context.WithCancel(context.Background())
				defer routerCancel()
				logger := zap.NewNop()
				rs := &RouterSupervisor{
					logger:    logger,
					router:    &Router{httpServer: srv, usage: &UsageTrackerNoOp{}, Config: Config{logger: logger, routerGracePeriod: 2 * time.Second}},
					routerCtx: routerCtx, routerCancel: routerCancel,
					resources: &RouterResources{Config: &config.Config{DrainPeriod: time.Second, GracePeriod: 2 * time.Second, ShutdownDelay: 5 * time.Second}},
				}
				stopped := make(chan error, 1)
				start := time.Now()
				go func() { stopped <- rs.stopRouter(true) }()
				synctest.Wait()
				require.True(t, srv.draining.Load())
				require.False(t, rs.router.shutdown.Load(), "ordinary shutdown starts after the drain window")
				if complete {
					unblock()
				}
				err := <-stopped
				if complete {
					require.NoError(t, err)
					assert.Equal(t, time.Second, time.Since(start))
				} else {
					require.ErrorIs(t, err, context.DeadlineExceeded)
					assert.Equal(t, 3*time.Second, time.Since(start), "draining must leave the full grace period")
				}
				assert.ErrorIs(t, routerCtx.Err(), context.Canceled, "cancel resources even when shutdown times out")
				unblock()
				require.NoError(t, <-requestDone)
				resp := <-response
				require.NotNil(t, resp)
				assert.True(t, resp.Close)
			})
		})
	}
}
