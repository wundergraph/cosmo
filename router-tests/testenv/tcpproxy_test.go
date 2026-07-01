package testenv

import (
	"io"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// startEchoServer starts an in-process TCP server that echoes whatever it receives, used as
// the upstream "broker" for the proxy tests. It is torn down when the test finishes.
func startEchoServer(t *testing.T) string {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			conn, acceptErr := ln.Accept()
			if acceptErr != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(conn)
		}
	}()

	return ln.Addr().String()
}

// proxyRoundTrip dials addr, sends a probe, and returns what it reads back. A dropped
// (unreachable) connection yields an error instead of the echoed probe.
func proxyRoundTrip(addr string) (string, error) {
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	if err = conn.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
		return "", err
	}
	if _, err = conn.Write([]byte("ping")); err != nil {
		return "", err
	}
	buf := make([]byte, 4)
	if _, err = io.ReadFull(conn, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}

func TestToggleableProxy(t *testing.T) {
	t.Parallel()

	echoAddr := startEchoServer(t)
	proxy := NewToggleableProxy(t, echoAddr)

	// It starts unreachable: connections are accepted then dropped, so no echo comes back.
	_, err := proxyRoundTrip(proxy.Addr())
	require.Error(t, err)

	// Once reachable, traffic is forwarded to the upstream and echoed back.
	proxy.SetReachable(true)
	require.Eventually(t, func() bool {
		got, rtErr := proxyRoundTrip(proxy.Addr())
		return rtErr == nil && got == "ping"
	}, 5*time.Second, 50*time.Millisecond)

	// Toggled back to unreachable: new connections must not forward anymore.
	proxy.SetReachable(false)
	require.Eventually(t, func() bool {
		_, rtErr := proxyRoundTrip(proxy.Addr())
		return rtErr != nil
	}, 5*time.Second, 50*time.Millisecond)

	// Reachable again: it recovers without recreating the proxy.
	proxy.SetReachable(true)
	require.Eventually(t, func() bool {
		got, rtErr := proxyRoundTrip(proxy.Addr())
		return rtErr == nil && got == "ping"
	}, 5*time.Second, 50*time.Millisecond)
}
