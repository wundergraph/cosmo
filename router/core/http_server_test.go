package core

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"go.uber.org/zap"
)

func TestNewServer_PortBindingError(t *testing.T) {
	// Bind a port first
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	// Get the address that was bound
	addr := listener.Addr().String()

	// Try to create a server on the same port - this should fail immediately
	logger := zap.NewNop()
	hc := health.New(&health.Options{Logger: logger})

	_, err = newServer(&httpServerOptions{
		addr:               addr,
		logger:             logger,
		healthcheck:        hc,
		baseURL:            "http://" + addr,
		maxHeaderBytes:     1024,
		healthCheckPath:    "/health",
		livenessCheckPath:  "/health/live",
		readinessCheckPath: "/health/ready",
	})

	// Should return an error immediately, not succeed
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to bind to address")
}

func TestNewServer_PortBindingSuccess(t *testing.T) {
	// Find an available port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()
	listener.Close() // Close it so we can use it

	// Try to create a server on the available port - this should succeed
	logger := zap.NewNop()
	hc := health.New(&health.Options{Logger: logger})

	server, err := newServer(&httpServerOptions{
		addr:               addr,
		logger:             logger,
		healthcheck:        hc,
		baseURL:            "http://" + addr,
		maxHeaderBytes:     1024,
		healthCheckPath:    "/health",
		livenessCheckPath:  "/health/live",
		readinessCheckPath: "/health/ready",
	})

	// Should succeed
	assert.NoError(t, err)
	assert.NotNil(t, server)

	// Clean up
	if server != nil {
		server.Shutdown(t.Context())
	}
}

func TestRouter_Start_PortBindingError(t *testing.T) {
	// Bind a port first
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	// Get the address that was bound
	addr := listener.Addr().String()

	// Create a router with static config that uses the already-bound port
	router, err := NewRouter(
		t.Context(),
		WithStaticExecutionConfig(&nodev1.RouterConfig{
			Version: "1.0.0",
		}),
		WithListenerAddr(addr),
	)
	require.NoError(t, err)

	// Try to start the router - should fail immediately with port binding error
	err = router.Start(t.Context())
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create server")
}

// startTestServer starts a real server on an ephemeral port and returns it with its base URL.
func startTestServer(t *testing.T) (*server, string) {
	t.Helper()

	logger := zap.NewNop()
	hc := health.New(&health.Options{Logger: logger})
	srv, err := newServer(&httpServerOptions{
		addr:               "127.0.0.1:0",
		logger:             logger,
		healthcheck:        hc,
		maxHeaderBytes:     1024,
		healthCheckPath:    "/health",
		livenessCheckPath:  "/health/live",
		readinessCheckPath: "/health/ready",
	})
	require.NoError(t, err)
	hc.SetReady(true)

	go func() { _ = srv.listenAndServe() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	return srv, "http://" + srv.listener.Addr().String()
}

// getReused performs a GET and reports whether the connection was reused.
func getReused(t *testing.T, client *http.Client, url string) (*http.Response, bool) {
	t.Helper()

	var reused bool
	trace := &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) { reused = info.Reused }}
	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(t.Context(), trace), http.MethodGet, url, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	require.NoError(t, resp.Body.Close())

	return resp, reused
}

// drainAsync runs srv.drain in the background and returns a channel that is closed when it returns.
func drainAsync(ctx context.Context, srv *server, period time.Duration) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		srv.drain(ctx, period)
	}()
	return done
}

func TestServer_KeepAliveWhenNotDraining(t *testing.T) {
	_, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	resp1, _ := getReused(t, client, base+"/health")
	resp2, reused := getReused(t, client, base+"/health")

	assert.False(t, resp1.Close)
	assert.False(t, resp2.Close)
	assert.True(t, reused)
}

func TestServer_DrainingSetsConnectionClose(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	srv.draining.Store(true)

	resp1, _ := getReused(t, client, base+"/health")
	resp2, reused := getReused(t, client, base+"/health")

	assert.True(t, resp1.Close)
	assert.True(t, resp2.Close)
	assert.False(t, reused)
}

func TestServer_DrainingSkipsUpgrade(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	srv.draining.Store(true)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"/health", nil)
	require.NoError(t, err)
	req.Header.Set("Connection", "upgrade")
	req.Header.Set("Upgrade", "websocket")

	resp, err := client.Do(req)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())

	assert.False(t, resp.Close, "upgrade request must not force connection close")
}

func TestServer_DrainMarksNotReady(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	resp, _ := getReused(t, client, base+"/health/ready")
	require.Equal(t, http.StatusOK, resp.StatusCode)

	<-drainAsync(t.Context(), srv, time.Millisecond)

	resp, _ = getReused(t, client, base+"/health/ready")
	assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
}

func TestServer_DrainReturnsWhenConnectionsAreClosed(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	// Leave an idle keep-alive connection in the client's pool.
	getReused(t, client, base+"/health")
	require.Equal(t, int64(1), srv.openConns.Load())

	done := drainAsync(t.Context(), srv, time.Minute)
	require.Eventually(t, srv.draining.Load, time.Second, time.Millisecond)

	// The next request on the pooled connection is answered with "Connection: close", so the
	// client retires it and the drain ends long before its period.
	resp, reused := getReused(t, client, base+"/health")
	require.True(t, reused)
	require.True(t, resp.Close)

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("drain did not return after all connections were closed")
	}
}

func TestServer_DrainWaitsPeriodForIdleConnection(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	// An idle pooled connection that is never used again keeps the drain going for the full period.
	getReused(t, client, base+"/health")

	const period = 300 * time.Millisecond
	begin := time.Now()
	<-drainAsync(t.Context(), srv, period)

	assert.GreaterOrEqual(t, time.Since(begin), period)
	assert.Equal(t, int64(1), srv.openConns.Load())
}

func TestServer_DrainReturnsWhenContextIsDone(t *testing.T) {
	srv, base := startTestServer(t)
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	getReused(t, client, base+"/health")

	ctx, cancel := context.WithCancel(t.Context())
	done := drainAsync(ctx, srv, time.Minute)
	cancel()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("drain did not return after the context was canceled")
	}
}

// TestServer_DrainThenShutdown_NoEOFForKeepAliveClient reproduces the production race: a pooled
// keep-alive client writing non-idempotent requests while the server shuts down. Without the drain,
// http.Server.Shutdown closes idle connections the client is about to reuse.
func TestServer_DrainThenShutdown_NoEOFForKeepAliveClient(t *testing.T) {
	srv, base := startTestServer(t)

	mux := chi.NewRouter()
	mux.Post("/echo", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = w.Write([]byte("ok"))
	})
	srv.state.Store(&serverState{mux: mux})

	client := &http.Client{Transport: &http.Transport{
		IdleConnTimeout:     200 * time.Millisecond,
		MaxIdleConnsPerHost: 4,
	}}
	t.Cleanup(client.CloseIdleConnections)

	var (
		stop     atomic.Bool
		errsMu   sync.Mutex
		failures int
		firstErr error
		wg       sync.WaitGroup
	)
	for range 4 {
		wg.Go(func() {
			for !stop.Load() {
				req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, base+"/echo", strings.NewReader("{}"))
				if err != nil {
					return
				}
				req.GetBody = nil // no transparent retry, like a proxy forwarding a POST

				var reused bool
				req = req.WithContext(httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { reused = i.Reused }}))
				resp, err := client.Do(req)
				if err == nil {
					_, _ = io.Copy(io.Discard, resp.Body)
					_ = resp.Body.Close()
				} else if reused && !errors.Is(err, syscall.ECONNREFUSED) {
					// Only failures on a pooled connection are the race under test. A fresh
					// connection that lands in the accept backlog as the listener closes fails
					// too, but in production new connections stop arriving once the pod leaves
					// the endpoints.
					errsMu.Lock()
					failures++
					if firstErr == nil {
						firstErr = err
					}
					errsMu.Unlock()
				}
				time.Sleep(time.Millisecond)
			}
		})
	}

	time.Sleep(100 * time.Millisecond) // let the pool warm up

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.drain(ctx, 300*time.Millisecond)
	require.NoError(t, srv.Shutdown(ctx))
	stop.Store(true)
	wg.Wait()

	errsMu.Lock()
	defer errsMu.Unlock()
	assert.Zero(t, failures, "first error: %v", firstErr)
}
