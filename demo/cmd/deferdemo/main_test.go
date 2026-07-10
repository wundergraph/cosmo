package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
)

func TestDemoServerConfiguration(t *testing.T) {
	configs := demoServerConfigs(deferdemo.Latencies{})
	want := []struct {
		name string
		addr string
	}{
		{name: "catalog", addr: "localhost:4012"},
		{name: "pricing", addr: "localhost:4013"},
		{name: "reviews", addr: "localhost:4014"},
	}

	if len(configs) != len(want) {
		t.Fatalf("got %d server configs, want %d", len(configs), len(want))
	}

	for i, config := range configs {
		if config.name != want[i].name {
			t.Errorf("server %d name = %q, want %q", i, config.name, want[i].name)
		}
		if config.addr != want[i].addr {
			t.Errorf("server %d address = %q, want %q", i, config.addr, want[i].addr)
		}

		server := newHTTPServer(config)
		if server.ReadHeaderTimeout != serverReadHeaderTimeout {
			t.Errorf("server %q ReadHeaderTimeout = %s, want %s", config.name, server.ReadHeaderTimeout, serverReadHeaderTimeout)
		}
		if server.ReadTimeout != serverReadTimeout {
			t.Errorf("server %q ReadTimeout = %s, want %s", config.name, server.ReadTimeout, serverReadTimeout)
		}
		if server.IdleTimeout != serverIdleTimeout {
			t.Errorf("server %q IdleTimeout = %s, want %s", config.name, server.IdleTimeout, serverIdleTimeout)
		}
		if server.WriteTimeout != 0 {
			t.Errorf("server %q WriteTimeout = %s, want zero for streaming responses", config.name, server.WriteTimeout)
		}
	}
}

func TestRunRejectsInvalidLatencyConfigurationBeforeListening(t *testing.T) {
	t.Setenv("DEFER_DEMO_BASE_LATENCY_MS", "not-a-number")

	err := run(context.Background())
	if err == nil {
		t.Fatal("run returned nil for an invalid base latency")
	}
	if !strings.Contains(err.Error(), "DEFER_DEMO_BASE_LATENCY_MS") {
		t.Fatalf("run error = %q, want the invalid environment variable name", err)
	}
}

func TestRunMainReturnsFailureExitCodeForInvalidLatencyConfiguration(t *testing.T) {
	t.Setenv("DEFER_DEMO_BASE_LATENCY_MS", "not-a-number")

	if exitCode := runMain(context.Background()); exitCode != 1 {
		t.Fatalf("runMain exit code = %d, want 1", exitCode)
	}
}

func TestServeServersWaitsForInFlightRequestBeforeShutdown(t *testing.T) {
	listener := newCloseNotifyingListener(t)
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	var releaseOnce sync.Once
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
	})
	server := newHTTPServer(serverConfig{name: "test", addr: listener.Addr().String(), handler: handler})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		releaseOnce.Do(func() { close(releaseRequest) })
		_ = server.Close()
	})
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- serveServers(ctx, []listeningServer{{server: server, listener: listener}}, time.Second)
	}()

	requestDone := make(chan error, 1)
	go func() {
		response, err := http.Get("http://" + listener.Addr().String() + "/graphql")
		if err == nil {
			_ = response.Body.Close()
		}
		requestDone <- err
	}()

	waitForSignal(t, requestStarted, "request to reach the handler")
	cancel()
	waitForSignal(t, listener.closed, "listener to close during shutdown")

	select {
	case err := <-serveDone:
		t.Fatalf("serveServers returned before the in-flight request completed: %v", err)
	default:
	}

	releaseOnce.Do(func() { close(releaseRequest) })
	if err := waitForResult(t, requestDone, "request to complete"); err != nil {
		t.Fatalf("request failed during graceful shutdown: %v", err)
	}
	if err := waitForResult(t, serveDone, "servers to shut down"); err != nil {
		t.Fatalf("serveServers returned an error: %v", err)
	}
}

func TestServeServersBoundsGracefulShutdown(t *testing.T) {
	listener := newCloseNotifyingListener(t)
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	var releaseOnce sync.Once
	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		close(requestStarted)
		<-releaseRequest
	})
	server := newHTTPServer(serverConfig{name: "test", addr: listener.Addr().String(), handler: handler})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		releaseOnce.Do(func() { close(releaseRequest) })
		_ = server.Close()
	})
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- serveServers(ctx, []listeningServer{{server: server, listener: listener}}, 10*time.Millisecond)
	}()

	requestDone := make(chan error, 1)
	go func() {
		response, err := http.Get("http://" + listener.Addr().String() + "/graphql")
		if err == nil {
			_ = response.Body.Close()
		}
		requestDone <- err
	}()

	waitForSignal(t, requestStarted, "request to reach the handler")
	cancel()
	err := waitForResult(t, serveDone, "bounded shutdown to finish")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("serveServers error = %v, want context deadline exceeded", err)
	}
	releaseOnce.Do(func() { close(releaseRequest) })
	_ = waitForResult(t, requestDone, "request goroutine to finish")
}

func TestServeServersReturnsServeFailure(t *testing.T) {
	listener := newCloseNotifyingListener(t)
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}
	server := newHTTPServer(serverConfig{
		name:    "test",
		addr:    listener.Addr().String(),
		handler: http.NotFoundHandler(),
	})

	err := serveServers(context.Background(), []listeningServer{{server: server, listener: listener}}, time.Second)
	if err == nil {
		t.Fatal("serveServers returned nil for a closed listener")
	}
}

type closeNotifyingListener struct {
	net.Listener
	closed chan struct{}
	once   sync.Once
}

func newCloseNotifyingListener(t *testing.T) *closeNotifyingListener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	return &closeNotifyingListener{
		Listener: listener,
		closed:   make(chan struct{}),
	}
}

func (l *closeNotifyingListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return l.Listener.Close()
}

func waitForSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

func waitForResult(t *testing.T, result <-chan error, description string) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
		return nil
	}
}
