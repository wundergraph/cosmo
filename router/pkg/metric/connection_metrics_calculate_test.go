package metric

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/internal/httpclient"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

type value[T any] struct {
	value T
	attrs []attribute.KeyValue
}

type mockConnectionMetricStore struct {
	connectionAcquireDurations []value[float64]
	connectionHosts            []attribute.KeyValue
	reusedConnections          []value[bool]
	dnsDurations               []float64
	dnsHosts                   []attribute.KeyValue
	tlsDurations               []float64
	tlsHosts                   []attribute.KeyValue
	dialDurations              []float64
	dialHosts                  []attribute.KeyValue
	retryHosts                 []attribute.KeyValue
	totalDurations             []float64
	totalHosts                 []attribute.KeyValue
}

func (m *mockConnectionMetricStore) MeasureConnectionAcquireDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	m.connectionAcquireDurations = append(m.connectionAcquireDurations, value[float64]{
		value: duration,
		attrs: attrs,
	})
}

func (m *mockConnectionMetricStore) MeasureConnections(ctx context.Context, reused bool, attrs ...attribute.KeyValue) {
	m.reusedConnections = append(m.reusedConnections, value[bool]{
		value: reused,
		attrs: attrs,
	})
}

func (m *mockConnectionMetricStore) MeasureDNSDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	m.dnsDurations = append(m.dnsDurations, duration)
	m.dnsHosts = append(m.dnsHosts, attrs...)
}

func (m *mockConnectionMetricStore) MeasureTLSHandshakeDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	m.tlsDurations = append(m.tlsDurations, duration)
	m.tlsHosts = append(m.tlsHosts, attrs...)
}

func (m *mockConnectionMetricStore) MeasureDialDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	m.dialDurations = append(m.dialDurations, duration)
	m.dialHosts = append(m.dialHosts, attrs...)
}

func (m *mockConnectionMetricStore) MeasureTotalConnectionDuration(ctx context.Context, duration float64, attrs ...attribute.KeyValue) {
	m.totalDurations = append(m.totalDurations, duration)
	m.totalHosts = append(m.totalHosts, attrs...)
}

func TestConnectionCalculations(t *testing.T) {
	t.Run("verify reused attribute has been set", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		// Create a context with client trace
		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)

		host := "somehost:givenport"
		// Test total duration metrics
		startTime := time.Now()
		reusedValue := true
		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
				},
				ConnectionAcquired: &httpclient.AcquiredConnection{
					Time:   startTime,
					Reused: reusedValue,
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.reusedConnections, 1)

		actual := store.reusedConnections[0]
		require.Equal(t, actual.value, reusedValue)
		require.Equal(t, actual.attrs, []attribute.KeyValue{rotel.WgHost.String(host)})
	})

	t.Run("verify connection acquire duration", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		// Create a context with client trace
		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)

		host := "somehost:givenport"
		// Test total duration metrics
		startTime := time.Now()
		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
					Time:     startTime.Add(1000 * time.Millisecond),
				},
				ConnectionAcquired: &httpclient.AcquiredConnection{
					Time:   startTime.Add(2500 * time.Millisecond),
					Reused: true,
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.connectionAcquireDurations, 1)

		actual := store.connectionAcquireDurations[0]
		require.Equal(t, 1.5, actual.value)
		require.Equal(t, actual.attrs, []attribute.KeyValue{rotel.WgHost.String(host)})
	})

	t.Run("verify dns duration metrics", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)
		host := "somehost:givenport"
		startTime := time.Now()
		dnsHost := "example.com"

		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
				},
				DNSStart: &httpclient.DNSStart{
					Time: startTime,
					Host: dnsHost,
				},
				DNSDone: &httpclient.DNSDone{
					Time: startTime.Add(100 * time.Millisecond),
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.dnsDurations, 1)
		require.Equal(t, 0.1, store.dnsDurations[0])
		require.Equal(t, []attribute.KeyValue{
			rotel.WgHost.String(host),
			rotel.WgDnsHost.String(dnsHost),
		}, store.dnsHosts)
	})

	t.Run("verify host is empty with nil connectionGet", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)
		startTime := time.Now()
		dnsHost := "example.com"

		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				DNSStart: &httpclient.DNSStart{
					Time: startTime,
					Host: dnsHost,
				},
				DNSDone: &httpclient.DNSDone{
					Time: startTime.Add(100 * time.Millisecond),
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.dnsDurations, 1)
		require.Equal(t, []attribute.KeyValue{
			rotel.WgHost.String(""),
			rotel.WgDnsHost.String(dnsHost),
		}, store.dnsHosts)
	})

	t.Run("verify tls handshake duration metrics", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)
		host := "somehost:givenport"
		startTime := time.Now()

		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
				},
				TLSStart: &httpclient.TLSStart{
					Time: startTime,
				},
				TLSDone: &httpclient.TLSDone{
					Time: startTime.Add(200 * time.Millisecond),
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.tlsDurations, 1)
		require.Equal(t, 0.2, store.tlsDurations[0])
		require.Equal(t, []attribute.KeyValue{rotel.WgHost.String(host)}, store.tlsHosts)
	})

	t.Run("verify dial duration metrics", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)
		host := "somehost:givenport"
		startTime := time.Now()

		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
				},
				DialStart: []httpclient.DialStart{
					{
						Time:    startTime,
						Network: "tcp",
						Address: "example.com:443",
					},
				},
				DialDone: []httpclient.DialDone{
					{
						Time:    startTime.Add(150 * time.Millisecond),
						Network: "tcp",
						Address: "example.com:443",
					},
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.dialDurations, 1)
		require.Equal(t, 0.15, store.dialDurations[0])
		require.Equal(t, []attribute.KeyValue{rotel.WgHost.String(host)}, store.dialHosts)
	})

	t.Run("verify total duration with all components", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)
		host := "somehost:givenport"
		startTime := time.Now()
		dnsHost := "example.com"

		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
				},
				DNSStart: &httpclient.DNSStart{
					Time: startTime,
					Host: dnsHost,
				},
				DNSDone: &httpclient.DNSDone{
					Time: startTime.Add(100 * time.Millisecond),
				},
				TLSStart: &httpclient.TLSStart{
					Time: startTime.Add(100 * time.Millisecond),
				},
				TLSDone: &httpclient.TLSDone{
					Time: startTime.Add(300 * time.Millisecond),
				},
				DialStart: []httpclient.DialStart{
					{
						Time:    startTime.Add(300 * time.Millisecond),
						Network: "tcp",
						Address: "example.com:443",
					},
				},
				DialDone: []httpclient.DialDone{
					{
						Time:    startTime.Add(450 * time.Millisecond),
						Network: "tcp",
						Address: "example.com:443",
					},
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.totalDurations, 1)
		require.Equal(t, 0.45, store.totalDurations[0])
		require.Equal(t, []attribute.KeyValue{
			rotel.WgHost.String(host),
			rotel.WgDnsLookup.Bool(true),
			rotel.WgTlsHandshake.Bool(true),
		}, store.totalHosts)
	})

	t.Run("verify total duration without dns", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)
		host := "somehost:givenport"
		startTime := time.Now()

		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
				},
				TLSStart: &httpclient.TLSStart{
					Time: startTime,
				},
				TLSDone: &httpclient.TLSDone{
					Time: startTime.Add(200 * time.Millisecond),
				},
				DialStart: []httpclient.DialStart{
					{
						Time:    startTime.Add(200 * time.Millisecond),
						Network: "tcp",
						Address: "example.com:443",
					},
				},
				DialDone: []httpclient.DialDone{
					{
						Time:    startTime.Add(350 * time.Millisecond),
						Network: "tcp",
						Address: "example.com:443",
					},
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.totalDurations, 1)
		require.Equal(t, 0.35, store.totalDurations[0])
		require.Equal(t, []attribute.KeyValue{
			rotel.WgHost.String(host),
			rotel.WgDnsLookup.Bool(false),
			rotel.WgTlsHandshake.Bool(true),
		}, store.totalHosts)
	})

	t.Run("verify when there are multiple dials", func(t *testing.T) {
		ctx := context.Background()
		logger := zap.NewNop()
		store := &mockConnectionMetricStore{}

		ctx = httpclient.InitTraceContext(ctx)
		fromTrace := httpclient.GetClientTraceFromContext(ctx)
		host := "somehost:givenport"
		startTime := time.Now()

		fromTrace.ClientTraces = []*httpclient.ClientTrace{
			{
				ConnectionGet: &httpclient.GetConnection{
					HostPort: host,
				},
				DialStart: []httpclient.DialStart{
					{
						Time:    startTime.Add(10 * time.Millisecond),
						Network: "tcp",
						Address: "1.com:443",
					},
					{
						Time:    startTime.Add(50 * time.Millisecond),
						Network: "tcp",
						Address: "2.com:443",
					},
					{
						Time:    startTime.Add(10 * time.Millisecond),
						Network: "tcp",
						Address: "3.com:443",
					},
					{
						Time:    startTime.Add(10 * time.Millisecond),
						Network: "tcp",
						Address: "5.com:443",
					},
				},
				DialDone: []httpclient.DialDone{
					{
						Time:    startTime.Add(150 * time.Millisecond),
						Network: "tcp",
						Address: "1.com:443",
						Error:   fmt.Errorf("first attempt failed"),
					},
					{
						Time:    startTime.Add(200 * time.Millisecond),
						Network: "tcp",
						Address: "2.com:443",
					},
					{
						Time:    startTime.Add(70 * time.Millisecond),
						Network: "tcp",
						Address: "5.com:443",
					},
				},
			},
		}

		CalculateConnectionMetrics(ctx, logger, store)

		require.Len(t, store.dialDurations, 1)
		require.Equal(t, 0.06, store.dialDurations[0])
		require.Equal(t, []attribute.KeyValue{rotel.WgHost.String(host)}, store.dialHosts)
	})
}
