package tcpretransmits

import (
	"context"
	"net"
	"net/http/httptest"
	"syscall"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/metric"
)

type recordingCounter struct {
	metric.Int64Counter
	samples []int64
}

func (c *recordingCounter) Add(_ context.Context, value int64, _ ...metric.AddOption) {
	c.samples = append(c.samples, value)
}

func TestSamplesTCPInfoOnceBeforeClose(t *testing.T) {
	server := httptest.NewServer(nil)
	defer server.Close()

	prom, otlp := &recordingCounter{}, &recordingCounter{}
	m := &TCPRetransmits{counters: []metric.Int64Counter{prom, otlp}}
	dial := m.WrapSubgraphDialer("", (&net.Dialer{}).DialContext)
	conn, err := dial(t.Context(), "tcp", server.Listener.Addr().String())
	require.NoError(t, err)
	require.Implements(t, (*syscall.Conn)(nil), conn)
	require.NoError(t, conn.Close())
	require.ErrorIs(t, conn.Close(), net.ErrClosed)
	require.Len(t, prom.samples, 1)
	require.Equal(t, prom.samples, otlp.samples)
}
