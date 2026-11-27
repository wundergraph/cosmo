package core

import (
	"context"
	"net"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"go.uber.org/zap"
)

type testDialerModule struct {
	id       ModuleID
	priority int
	onDial   func(ModuleID, string)
}

func (m testDialerModule) Module() ModuleInfo {
	return ModuleInfo{ID: m.id, Priority: m.priority, New: func() Module { return m }}
}

func (m testDialerModule) WrapSubgraphDialer(subgraph string, next DialerFunc) DialerFunc {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		m.onDial(m.id, subgraph)
		return next(ctx, network, address)
	}
}

func TestSubgraphDialerProviders(t *testing.T) {
	server := httptest.NewServer(nil)
	defer server.Close()
	address := server.Listener.Addr().String()

	for _, subgraph := range []string{"", "products"} {
		var calls []ModuleID
		onDial := func(id ModuleID, name string) {
			require.Equal(t, subgraph, name)
			calls = append(calls, id)
		}
		r := &Router{Config: Config{
			logger: zap.NewNop(),
			customModules: []Module{
				testDialerModule{"inner", 2, onDial},
				testDialerModule{"outer", 1, onDial},
			},
		}}
		require.NoError(t, r.initModules(t.Context()))
		for _, trace := range []*TraceDialer{nil, NewTraceDialer()} {
			calls = nil
			transport := newHTTPTransport(&TransportRequestOptions{}, nil, trace, subgraph, nil, r.subgraphDialerProviders)
			conn, err := transport.DialContext(t.Context(), "tcp", address)
			require.NoError(t, err)
			require.Equal(t, []ModuleID{"outer", "inner"}, calls)
			key := metric.SubgraphHostKey{Subgraph: subgraph, Host: address}
			if trace != nil {
				require.EqualValues(t, 1, trace.connectionPoolStats.GetStats()[key])
			}
			require.NoError(t, conn.Close())
			if trace != nil {
				require.Zero(t, trace.connectionPoolStats.GetStats()[key])
			}
		}
	}
}
