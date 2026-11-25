package tcpretransmits

import (
	"context"
	"net"
	"sync"
	"syscall"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/metric"
	"golang.org/x/sys/unix"
)

const moduleID = "tcpRetransmits"

func init() {
	core.RegisterModule(&TCPRetransmits{})
}

type TCPRetransmits struct {
	counters []metric.Int64Counter
}

func (*TCPRetransmits) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:  moduleID,
		New: func() core.Module { return &TCPRetransmits{} },
	}
}

func (m *TCPRetransmits) Provision(ctx *core.ModuleContext) error {
	for _, provider := range []metric.MeterProvider{ctx.PrometheusMeterProvider, ctx.OTLPMeterProvider} {
		counter, err := provider.Meter(moduleID).Int64Counter("module.subgraph.tcp.retransmits",
			metric.WithDescription("TCP segments retransmitted by the router, sampled at connection close"))
		if err != nil {
			return err
		}
		m.counters = append(m.counters, counter)
	}
	return nil
}

func (m *TCPRetransmits) WrapSubgraphDialer(subgraph string, next core.DialerFunc) core.DialerFunc {
	var options []metric.AddOption
	if subgraph != "" {
		options = append(options, metric.WithAttributes(otel.WgSubgraphName.String(subgraph)))
	}
	record := func(total uint32) {
		for _, counter := range m.counters {
			counter.Add(context.Background(), int64(total), options...)
		}
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := next(ctx, network, address)
		if err != nil {
			return conn, err
		}
		socket, ok := conn.(socketConn)
		if !ok || conn.RemoteAddr().Network() != "tcp" {
			return conn, nil
		}
		return &retransmitConn{socketConn: socket, record: record}, nil
	}
}

type socketConn interface {
	net.Conn
	syscall.Conn
}

type retransmitConn struct {
	socketConn
	once   sync.Once
	record func(uint32)
}

func (c *retransmitConn) Close() error {
	c.once.Do(func() {
		raw, err := c.SyscallConn()
		if err != nil {
			return
		}
		var info *unix.TCPInfo
		var socketErr error
		err = raw.Control(func(fd uintptr) {
			info, socketErr = unix.GetsockoptTCPInfo(int(fd), unix.IPPROTO_TCP, unix.TCP_INFO)
		})
		if err == nil && socketErr == nil {
			c.record(info.Total_retrans)
		}
	})
	return c.socketConn.Close()
}

var (
	_ core.Provisioner            = (*TCPRetransmits)(nil)
	_ core.SubgraphDialerProvider = (*TCPRetransmits)(nil)
)
