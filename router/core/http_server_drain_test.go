package core

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"go.uber.org/zap"
)

// pipeListener exercises net/http's connection lifecycle without OS sockets.
// Unlike a background http.Transport, the raw client below cannot observe a
// server close and silently discard the pooled connection before reusing it.
type pipeListener struct {
	connections chan net.Conn
	closed      chan struct{}
	once        sync.Once
}

func (l *pipeListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.connections:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}
func (l *pipeListener) Close() error   { l.once.Do(func() { close(l.closed) }); return nil }
func (l *pipeListener) Addr() net.Addr { return pipeAddr{} }

type pipeAddr struct{}

func (pipeAddr) Network() string { return "pipe" }
func (pipeAddr) String() string  { return "router.test:80" }

func newDrainTestServer(t *testing.T, handler http.HandlerFunc) (*server, *pipeListener) {
	t.Helper()
	logger := zap.NewNop()
	hc := health.New(&health.Options{Logger: logger})
	hc.SetReady(true)
	mux := chi.NewRouter()
	mux.Get("/health/ready", hc.Readiness())
	mux.Get("/health/live", hc.Liveness())
	mux.HandleFunc("/graphql", handler)
	srv := &server{logger: logger, healthcheck: hc, drainEnabled: true}
	srv.state.Store(&serverState{mux: mux})
	listener := &pipeListener{connections: make(chan net.Conn), closed: make(chan struct{})}
	srv.httpServer = &http.Server{Handler: http.HandlerFunc(srv.serveHTTP)}
	done := make(chan error, 1)
	go func() { done <- srv.httpServer.Serve(listener) }()
	t.Cleanup(func() {
		require.NoError(t, srv.httpServer.Close())
		require.ErrorIs(t, <-done, http.ErrServerClosed)
	})
	return srv, listener
}

func (l *pipeListener) dial(ctx context.Context) (net.Conn, error) {
	client, server := net.Pipe()
	select {
	case l.connections <- server:
		return client, nil
	case <-ctx.Done():
		_ = client.Close()
		_ = server.Close()
		return nil, ctx.Err()
	case <-l.closed:
		_ = client.Close()
		_ = server.Close()
		return nil, net.ErrClosed
	}
}

func dialDrainTestServer(t *testing.T, listener *pipeListener) net.Conn {
	t.Helper()
	client, err := listener.dial(t.Context())
	require.NoError(t, err)
	require.NoError(t, client.SetDeadline(time.Now().Add(5*time.Second)))
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func postOnConnection(conn net.Conn, reader *bufio.Reader) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, "http://router.test/graphql", strings.NewReader("{}"))
	if err != nil {
		return nil, err
	}
	if err = req.Write(conn); err != nil {
		return nil, err
	}
	resp, err := http.ReadResponse(reader, req)
	if err != nil {
		return nil, err
	}
	_, err = io.Copy(io.Discard, resp.Body)
	closeErr := resp.Body.Close()
	if err != nil {
		return nil, err
	}
	return resp, closeErr
}

func echoDrainRequest(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	_, _ = w.Write([]byte("ok"))
}

func TestServerDrain_PooledMutationSurvivesShutdown(t *testing.T) {
	retiring, oldListener := newDrainTestServer(t, echoDrainRequest)
	_, healthyListener := newDrainTestServer(t, echoDrainRequest)
	conn := dialDrainTestServer(t, oldListener)
	reader := bufio.NewReader(conn)
	resp, err := postOnConnection(conn, reader)
	require.NoError(t, err)
	require.False(t, resp.Close)

	retiring.startDraining()
	// The idle connection stays usable for its next mutation, which receives the
	// retirement signal. This fails if draining eagerly closes idle connections.
	resp, err = postOnConnection(conn, reader)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// Model a pool honoring Connection: close and endpoint removal. Keep the
	// stale connection otherwise, to deterministically exercise the EOF race.
	if resp.Close {
		require.NoError(t, conn.Close())
		conn = dialDrainTestServer(t, healthyListener)
		reader = bufio.NewReader(conn)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	require.NoError(t, retiring.Shutdown(ctx))
	_, err = postOnConnection(conn, reader)
	require.NoError(t, err, "a mutation must not reuse a connection retired during shutdown")
}

func TestServerDrain_RequestStartedBeforeDrain(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
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
	type result struct {
		resp *http.Response
		err  error
	}
	done := make(chan result, 1)
	go func() { resp, err := postOnConnection(conn, bufio.NewReader(conn)); done <- result{resp, err} }()
	<-entered
	srv.startDraining()
	unblock()
	got := <-done
	require.NoError(t, got.err)
	require.True(t, got.resp.Close, "check drain state when committing headers, not when the request starts")
}

func TestServerDrain_ReadinessAndLiveness(t *testing.T) {
	srv, _ := newDrainTestServer(t, echoDrainRequest)
	w := httptest.NewRecorder()
	srv.serveHTTP(w, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	require.Equal(t, http.StatusOK, w.Code)

	srv.startDraining()
	for _, tc := range []struct {
		path   string
		status int
	}{
		{"/health/ready", http.StatusServiceUnavailable},
		{"/health/live", http.StatusOK},
		{"/graphql", http.StatusOK},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			srv.serveHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
			assert.Equal(t, tc.status, w.Code)
		})
	}
}

func TestServerDrain_ResponseCommitPaths(t *testing.T) {
	for _, mode := range []string{"write", "header", "empty", "flush", "readfrom", "early hints", "rejected upgrade"} {
		t.Run(mode, func(t *testing.T) {
			srv, listener := newDrainTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				switch mode {
				case "write":
					_, _ = w.Write([]byte("ok"))
				case "header":
					w.WriteHeader(http.StatusNoContent)
				case "empty":
				case "flush":
					w.(http.Flusher).Flush()
				case "readfrom":
					_, _ = w.(io.ReaderFrom).ReadFrom(strings.NewReader("ok"))
				case "early hints":
					w.WriteHeader(http.StatusEarlyHints)
					w.WriteHeader(http.StatusOK)
				case "rejected upgrade":
					w.WriteHeader(http.StatusBadRequest)
				}
			})
			srv.startDraining()
			conn := dialDrainTestServer(t, listener)
			req, err := http.NewRequest(http.MethodPost, "http://router.test/graphql", strings.NewReader("{}"))
			require.NoError(t, err)
			if mode == "rejected upgrade" {
				req.Header.Set("Connection", "upgrade")
				req.Header.Set("Upgrade", "websocket")
			}
			require.NoError(t, req.Write(conn))
			reader := bufio.NewReader(conn)
			resp, err := http.ReadResponse(reader, req)
			require.NoError(t, err)
			if resp.StatusCode == http.StatusEarlyHints {
				resp, err = http.ReadResponse(reader, req)
				require.NoError(t, err)
			}
			_, err = io.Copy(io.Discard, resp.Body)
			require.NoError(t, err)
			require.NoError(t, resp.Body.Close())
			assert.True(t, resp.Close)
		})
	}
}

func TestServerDrain_WebSocketUpgrade(t *testing.T) {
	srv, listener := newDrainTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		kind, msg, err := conn.ReadMessage()
		if err == nil {
			_ = conn.WriteMessage(kind, msg)
		}
	})
	srv.startDraining()
	dialer := websocket.Dialer{NetDialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return listener.dial(ctx)
	}}
	conn, resp, err := dialer.DialContext(t.Context(), "ws://router.test/graphql", nil)
	require.NoError(t, err)
	defer conn.Close()
	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	assert.NotEqual(t, "close", resp.Header.Get("Connection"))
	require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte("hello")))
	_, msg, err := conn.ReadMessage()
	require.NoError(t, err)
	assert.Equal(t, "hello", string(msg))
}

func TestServerDrain_AlreadyCommittedResponse(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	srv, listener := newDrainTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
		// Committed headers cannot be changed even if net/http has buffered them.
		close(entered)
		<-release
		_, _ = w.Write([]byte("ok"))
	})
	t.Cleanup(unblock)
	conn := dialDrainTestServer(t, listener)
	done := make(chan error, 1)
	go func() { _, err := postOnConnection(conn, bufio.NewReader(conn)); done <- err }()
	<-entered
	srv.startDraining()
	unblock()
	require.NoError(t, <-done, "draining must not corrupt a response whose headers are already committed")
}
