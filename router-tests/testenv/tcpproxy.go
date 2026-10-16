package testenv

import (
	"fmt"
	"io"
	"net"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/freeport"
)

// ToggleableProxy is a TCP proxy used to simulate an event broker that is unreachable at
// router startup and later becomes reachable, without changing the address the router is
// configured with.
//
// While not reachable, accepted connections are closed immediately, so a client observes
// the broker as down (failed handshake / connection reset). After SetReachable(true) the
// proxy transparently forwards traffic to the real broker, simulating it coming back. This
// lets a test point an EDFS provider at the proxy address, start the router while the
// broker is "down", then bring it "up" and assert the provider recovers without a restart.
type ToggleableProxy struct {
	listener net.Listener
	target   string

	mu        sync.Mutex
	reachable bool
	conns     map[net.Conn]struct{}
	closed    bool

	wg sync.WaitGroup
}

// NewToggleableProxy starts a proxy that listens on a random loopback port and forwards to
// target (host:port) when reachable. It starts unreachable. The proxy is closed
// automatically when the test finishes.
func NewToggleableProxy(t testing.TB, target string) *ToggleableProxy {
	t.Helper()

	listener, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", freeport.GetOne(t)))
	require.NoError(t, err)

	p := &ToggleableProxy{
		listener: listener,
		target:   target,
		conns:    make(map[net.Conn]struct{}),
	}

	p.wg.Go(p.acceptLoop)

	t.Cleanup(func() {
		_ = p.Close()
	})

	return p
}

// Addr returns the host:port the proxy is listening on.
func (p *ToggleableProxy) Addr() string {
	return p.listener.Addr().String()
}

// Port returns the port the proxy is listening on.
func (p *ToggleableProxy) Port() int {
	return p.listener.Addr().(*net.TCPAddr).Port
}

// SetReachable toggles whether the proxy forwards to the target. Setting it to false also
// closes any in-flight forwarded connections so the client observes the broker going away.
func (p *ToggleableProxy) SetReachable(reachable bool) {
	p.mu.Lock()
	p.reachable = reachable
	var toClose []net.Conn
	if !reachable {
		for c := range p.conns {
			toClose = append(toClose, c)
		}
	}
	p.mu.Unlock()

	for _, c := range toClose {
		_ = c.Close()
	}
}

func (p *ToggleableProxy) isReachable() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.reachable
}

// trackConn registers c so SetReachable(false) and Close can tear it down, but only while
// the proxy is open and reachable. Rejecting registration when p.reachable is false, under
// the same lock SetReachable uses, closes the race where a connection accepted just before
// SetReachable(false) is added to p.conns after SetReachable has already snapshot-closed the
// set: such a connection is never tracked, so handle closes it and bails instead of
// forwarding. It returns false if the connection must not be used.
func (p *ToggleableProxy) trackConn(c net.Conn) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || !p.reachable {
		return false
	}
	p.conns[c] = struct{}{}
	return true
}

func (p *ToggleableProxy) untrackConn(c net.Conn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.conns, c)
}

func (p *ToggleableProxy) acceptLoop() {
	for {
		client, err := p.listener.Accept()
		if err != nil {
			return
		}
		if !p.isReachable() {
			// Broker is "down": drop the connection so the client sees it as unreachable.
			_ = client.Close()
			continue
		}
		p.wg.Go(func() {
			p.handle(client)
		})
	}
}

func (p *ToggleableProxy) handle(client net.Conn) {
	defer client.Close()

	// Register the client before doing any work. If the proxy is (or becomes) unreachable,
	// trackConn rejects it and the connection is closed without ever forwarding, so a
	// connection accepted just before SetReachable(false) cannot leak through the toggle.
	if !p.trackConn(client) {
		return
	}
	defer p.untrackConn(client)

	upstream, err := net.Dial("tcp", p.target)
	if err != nil {
		return
	}
	defer upstream.Close()

	// Re-check reachability after the dial: SetReachable(false) may have run while dialing.
	if !p.trackConn(upstream) {
		return
	}
	defer p.untrackConn(upstream)

	// Closing either side on copy completion unblocks the other copy goroutine.
	var copyWg sync.WaitGroup
	copyWg.Add(2)
	go func() {
		defer copyWg.Done()
		_, _ = io.Copy(upstream, client)
		_ = upstream.Close()
	}()
	go func() {
		defer copyWg.Done()
		_, _ = io.Copy(client, upstream)
		_ = client.Close()
	}()
	copyWg.Wait()
}

// Close stops the proxy and waits for all goroutines to finish.
func (p *ToggleableProxy) Close() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	var toClose []net.Conn
	for c := range p.conns {
		toClose = append(toClose, c)
	}
	p.mu.Unlock()

	err := p.listener.Close()
	for _, c := range toClose {
		_ = c.Close()
	}
	p.wg.Wait()
	return err
}
