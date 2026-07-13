package core

import (
	"crypto/tls"
	"net"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSocketFd(t *testing.T) {
	t.Parallel()

	newTCPConn := func(t *testing.T) net.Conn {
		t.Helper()
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		t.Cleanup(func() { _ = ln.Close() })

		accepted := make(chan net.Conn, 1)
		go func() {
			c, err := ln.Accept()
			if err == nil {
				accepted <- c
			}
		}()

		conn, err := net.Dial("tcp", ln.Addr().String())
		require.NoError(t, err)
		t.Cleanup(func() { _ = conn.Close() })

		srv := <-accepted
		t.Cleanup(func() { _ = srv.Close() })

		return conn
	}

	t.Run("returns a valid fd for a plain tcp connection", func(t *testing.T) {
		t.Parallel()
		conn := newTCPConn(t)
		require.NotZero(t, socketFd(conn), "plain tcp connection should have a socket fd")
	})

	t.Run("returns a valid fd for a tls connection", func(t *testing.T) {
		t.Parallel()
		conn := newTCPConn(t)
		tlsConn := tls.Client(conn, &tls.Config{InsecureSkipVerify: true})
		t.Cleanup(func() { _ = tlsConn.Close() })

		require.NotZero(t, socketFd(tlsConn), "tls connection should resolve to the underlying socket fd")
	})
}
