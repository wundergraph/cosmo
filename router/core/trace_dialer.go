package core

import (
	"context"
	"errors"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"net"
	"syscall"
)

type TraceDialer struct {
	connectionPoolStats *metric.ConnectionPoolStats
}

func NewTraceDialer() *TraceDialer {
	return &TraceDialer{
		connectionPoolStats: metric.NewConnectionPoolStats(),
	}
}

type DialerFunc func(ctx context.Context, network, address string) (net.Conn, error)

func (t *TraceDialer) WrapDial(base DialerFunc, subgraph string) DialerFunc {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		key := metric.SubgraphHostKey{
			Subgraph: subgraph,
			Host:     address,
		}

		counter := t.connectionPoolStats.GetCounter(key)
		counter.Add(1)

		conn, err := base(ctx, network, address)
		if err != nil {
			counter.Add(-1)
			return conn, err
		}

		onClose := func() {
			counter.Add(-1)
		}

		if _, ok := conn.(syscall.Conn); ok {
			return &trackedConnWithSyscall{
				Conn:    conn,
				onClose: onClose,
			}, nil
		}

		return &trackedConn{
			Conn:    conn,
			onClose: onClose,
		}, nil
	}
}

type trackedConn struct {
	net.Conn
	onClose func()
}

func (c *trackedConn) Close() error {
	err := c.Conn.Close()
	if c.onClose != nil {
		c.onClose()
	}
	return err
}

// We duplicate the trackedConn here to also implement syscall.Conn
// we do this instead of using type assertion on trackedConn
// because that would result in trackedConn being incorrectly typed
// and would pass type assertions for syscall.Conn
type trackedConnWithSyscall struct {
	net.Conn
	onClose func()
}

func (c *trackedConnWithSyscall) Close() error {
	err := c.Conn.Close()
	if c.onClose != nil {
		c.onClose()
	}
	return err
}

func (c *trackedConnWithSyscall) SyscallConn() (syscall.RawConn, error) {
	if sc, ok := c.Conn.(syscall.Conn); ok {
		return sc.SyscallConn()
	}
	// This should not really happen because we check the type before
	// using trackedConnWithSyscall
	return nil, errors.New("underlying conn doesn't implement syscall.Conn")
}
