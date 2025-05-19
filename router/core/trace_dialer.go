package core

import (
	"context"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"net"
)

type TraceDialer struct {
	connectionPoolStats *metric.ConnectionPoolStats
}

func NewTraceDialer() *TraceDialer {
	return &TraceDialer{
		connectionPoolStats: metric.NewConnectionPoolStats(),
	}
}

type dialerFunc func(ctx context.Context, network, address string) (net.Conn, error)

func (t *TraceDialer) WrapDial(base dialerFunc, subgraph string) dialerFunc {
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

		// wrap conn to decrement on Close
		return &trackedConn{
			Conn: conn,
			onClose: func() {
				counter.Add(-1)
			},
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
