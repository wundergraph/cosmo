package speedtrap

import (
	"context"
	"fmt"
	"net/http"
	"runtime"
	"sync"
	"time"

	"github.com/gobwas/ws"
)

// Scenario is a named test case. The Run callback receives a test context
// and imperatively scripts the entire WebSocket conversation.
type Scenario struct {
	Name string
	Run  func(t *S)
}

// HarnessConfig configures the test harness for running scenarios.
type HarnessConfig struct {
	TargetAddr string
	Backends   map[string]*Backend
	Timeout    time.Duration
}

// clientConfig holds resolved client connection options.
type clientConfig struct {
	subprotocols []string
	headers      http.Header
}

// ClientOption configures a client connection to the proxy.
type ClientOption func(*clientConfig)

// WithClientSubprotocol sets the subprotocols the client offers during upgrade.
func WithClientSubprotocol(protos ...string) ClientOption {
	return func(c *clientConfig) {
		c.subprotocols = protos
	}
}

// WithClientHeaders sets additional headers sent during the upgrade request.
func WithClientHeaders(h http.Header) ClientOption {
	return func(c *clientConfig) {
		c.headers = h
	}
}

// S is the test context passed to scenario callbacks. It provides methods for
// creating connections, recording failures, and accessing backends.
//
// The failure-reporting API mirrors [testing.T]:
//
//	Fail / FailNow     — mark failed (no message)
//	Log / Logf         — record a message
//	Error / Errorf     — Log + Fail    (non-fatal)
//	Fatal / Fatalf     — Log + FailNow (fatal, stops execution)
type S struct {
	targetAddr string
	backends   map[string]*Backend
	handles    []*ConnectionHandle
	timeout    time.Duration

	mu        sync.Mutex
	hasFailed bool
	failures  []Failure
}

// Client dials the proxy and returns a client-side connection handle.
func (t *S) Client(opts ...ClientOption) (*ConnectionHandle, error) {
	var cfg clientConfig
	for _, o := range opts {
		o(&cfg)
	}

	dialer := ws.Dialer{
		Timeout: t.timeout,
	}
	if len(cfg.subprotocols) > 0 {
		dialer.Protocols = cfg.subprotocols
	}
	if cfg.headers != nil {
		dialer.Header = ws.HandshakeHeaderHTTP(cfg.headers)
	}

	conn, _, hs, err := dialer.Dial(context.Background(), t.targetAddr)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", t.targetAddr, err)
	}

	h := newConnectionHandle(conn, ws.StateClientSide, hs, nil, t.timeout)

	t.mu.Lock()
	t.handles = append(t.handles, h)
	t.mu.Unlock()

	return h, nil
}

// Backend returns the named mock backend. Panics if the name was not registered.
func (t *S) Backend(name string) *Backend {
	b, ok := t.backends[name]
	if !ok {
		panic(fmt.Sprintf("speedtrap: unknown backend %q", name))
	}
	return b
}

// log records a failure message.
func (t *S) log(msg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.failures = append(t.failures, Failure{Message: msg})
}

// Fail marks the scenario as failed but continues execution.
func (t *S) Fail() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.hasFailed = true
}

// FailNow marks the scenario as failed and stops execution via runtime.Goexit.
func (t *S) FailNow() {
	t.mu.Lock()
	t.hasFailed = true
	if n := len(t.failures); n > 0 {
		t.failures[n-1].Fatal = true
	} else {
		t.failures = append(t.failures, Failure{Fatal: true})
	}
	t.mu.Unlock()
	runtime.Goexit()
}

// Log records a message without marking the scenario as failed.
func (t *S) Log(args ...any) { t.log(fmt.Sprint(args...)) }

// Logf records a formatted message without marking the scenario as failed.
func (t *S) Logf(format string, args ...any) { t.log(fmt.Sprintf(format, args...)) }

// Error is equivalent to Log followed by Fail.
func (t *S) Error(args ...any) { t.Log(args...); t.Fail() }

// Errorf is equivalent to Logf followed by Fail.
func (t *S) Errorf(format string, args ...any) { t.Logf(format, args...); t.Fail() }

// Fatal is equivalent to Log followed by FailNow.
func (t *S) Fatal(args ...any) { t.Log(args...); t.FailNow() }

// Fatalf is equivalent to Logf followed by FailNow.
func (t *S) Fatalf(format string, args ...any) { t.Logf(format, args...); t.FailNow() }

// failed reports whether the scenario has been marked as failed.
func (t *S) failed() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.hasFailed
}

func (t *S) cleanup() {
	t.mu.Lock()
	handles := t.handles
	t.mu.Unlock()

	for _, h := range handles {
		h.Drop()
	}
}
