package speedtrap

import (
	"fmt"
	"net"
	"net/http"
	"slices"
	"time"

	"github.com/gobwas/ws"
)

const (
	defaultBackendAddr    = ":0"
	defaultBackendTimeout = 5 * time.Second
)

// Backend accepts WebSocket connections from the proxy, auto-upgrades them,
// captures request headers, and makes the resulting connections available via Accept.
type Backend struct {
	server       *http.Server
	listener     net.Listener
	pending      chan *ConnectionHandle
	subprotocols []string
	addr         string
	timeout      time.Duration
	done         chan struct{}
}

// BackendOption configures a Backend.
type BackendOption func(*Backend)

// WithAddr sets the listen address for standalone mode. Default is ":0".
func WithAddr(addr string) BackendOption {
	return func(b *Backend) {
		b.addr = addr
	}
}

// WithSubprotocol sets the subprotocols the backend accepts during upgrade.
// If any are configured and the client offers a subprotocol that doesn't match,
// the upgrade is rejected. Clients that offer no subprotocol are accepted.
func WithSubprotocol(protos ...string) BackendOption {
	return func(b *Backend) {
		b.subprotocols = protos
	}
}

// WithTimeout sets the timeout for Accept calls. Default is 5 seconds.
func WithTimeout(timeout time.Duration) BackendOption {
	return func(b *Backend) {
		b.timeout = timeout
	}
}

func applyOpts(b *Backend, opts []BackendOption) {
	for _, o := range opts {
		o(b)
	}
}

// StartBackend creates a standalone backend that listens on a TCP address
// and serves an HTTP handler that upgrades WebSocket connections.
func StartBackend(opts ...BackendOption) (*Backend, error) {
	b := &Backend{
		pending: make(chan *ConnectionHandle, 16),

		addr:    defaultBackendAddr,
		timeout: defaultBackendTimeout,
		done:    make(chan struct{}),
	}
	applyOpts(b, opts)

	ln, err := net.Listen("tcp", b.addr)
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	b.listener = ln
	b.addr = ln.Addr().String()

	b.server = &http.Server{Handler: b.Handler()}
	go b.server.Serve(ln)

	return b, nil
}

// NewBackend creates a backend without a listener, for use in middleware mode.
// Call Handler() to get the http.Handler for mounting in a server.
func NewBackend(opts ...BackendOption) *Backend {
	b := &Backend{
		pending: make(chan *ConnectionHandle, 16),

		timeout: defaultBackendTimeout,
		done:    make(chan struct{}),
	}
	applyOpts(b, opts)
	return b
}

// Handler returns an http.Handler that upgrades incoming WebSocket connections
// using ws.HTTPUpgrader, captures request headers, and pushes the resulting
// ConnectionHandle to the pending channel. Both standalone and middleware modes
// use this same handler.
func (b *Backend) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var upgrader ws.HTTPUpgrader
		if len(b.subprotocols) > 0 {
			upgrader.Protocol = func(proto string) bool {
				return slices.Contains(b.subprotocols, proto)
			}
		}

		conn, _, hs, err := upgrader.Upgrade(r, w)
		if err != nil {
			return
		}

		headers := r.Header.Clone()
		handle := newConnectionHandle(conn, ws.StateServerSide, hs, headers, b.timeout)
		b.pending <- handle
	})
}

func (b *Backend) drain() {
	for {
		select {
		case h := <-b.pending:
			h.Drop()
		default:
			return
		}
	}
}

// Accept waits for the next upgraded connection from the proxy.
func (b *Backend) Accept() (*ConnectionHandle, error) {
	select {
	case h := <-b.pending:
		return h, nil
	case <-b.done:
		return nil, fmt.Errorf("backend stopped")
	case <-time.After(b.timeout):
		return nil, fmt.Errorf("accept timed out after %s", b.timeout)
	}
}

// Addr returns the listen address (standalone mode only).
func (b *Backend) Addr() string {
	return b.addr
}

// Stop shuts down the backend, closing the listener and draining pending connections.
func (b *Backend) Stop() {
	close(b.done)
	if b.server != nil {
		b.server.Close()
	} else if b.listener != nil {
		b.listener.Close()
	}
	b.drain()
}
