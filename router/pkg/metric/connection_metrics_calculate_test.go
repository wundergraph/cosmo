package metric

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/httpclient"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

// mockConnectionMetricStore implements ConnectionMetricStore for testing
type mockConnectionMetricStore struct {
	connectionAcquireDurations []float64
	connectionHosts            []attribute.KeyValue
	reusedConnections          []bool
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
	m.connectionAcquireDurations = append(m.connectionAcquireDurations, duration)
	m.connectionHosts = append(m.connectionHosts, attrs...)
}

func (m *mockConnectionMetricStore) MeasureConnections(ctx context.Context, reused bool, attrs ...attribute.KeyValue) {
	m.reusedConnections = append(m.reusedConnections, reused)
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

func TestCalculateConnectionMetrics_NilStore(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop()

	// Should not panic with nil store
	CalculateConnectionMetrics(ctx, logger, nil)
}

func TestCalculateConnectionMetrics_ConnectionAcquired(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop()
	store := &mockConnectionMetricStore{}

	// Create a context with client trace
	ctx = httpclient.InitTraceContext(ctx)
	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// Test connection acquire metrics
	startTime := time.Now()
	fromTrace.ClientTraces = []*httpclient.ClientTrace{
		{
			ConnectionGet: &httpclient.GetConnection{
				Time:     startTime,
				HostPort: "example.com:443",
			},
			ConnectionAcquired: &httpclient.AcquiredConnection{
				Time:   startTime.Add(100 * time.Millisecond),
				Reused: false,
			},
		},
	}

	CalculateConnectionMetrics(ctx, logger, store)

	assert.Equal(t, []float64{0.1}, store.connectionAcquireDurations)
	assert.Equal(t, []attribute.KeyValue{rotel.WgHost.String("example.com")}, store.connectionHosts)
	assert.Equal(t, []bool{false}, store.reusedConnections)
}

func TestCalculateConnectionMetrics_DNS(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop()
	store := &mockConnectionMetricStore{}

	// Create a context with client trace
	ctx = httpclient.InitTraceContext(ctx)
	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// Test DNS metrics
	startTime := time.Now()
	fromTrace.ClientTraces = []*httpclient.ClientTrace{
		{
			DNSStart: &httpclient.DNSStart{
				Time: startTime,
				Host: "example.com",
			},
			DNSDone: &httpclient.DNSDone{
				Time: startTime.Add(50 * time.Millisecond),
			},
		},
	}

	CalculateConnectionMetrics(ctx, logger, store)

	assert.Equal(t, []float64{0.05}, store.dnsDurations)
	assert.Equal(t, []attribute.KeyValue{rotel.WgHost.String("example.com")}, store.dnsHosts)
}

func TestCalculateConnectionMetrics_TLS(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop()
	store := &mockConnectionMetricStore{}

	// Create a context with client trace
	ctx = httpclient.InitTraceContext(ctx)
	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// Test TLS metrics
	startTime := time.Now()
	fromTrace.ClientTraces = []*httpclient.ClientTrace{
		{
			ConnectionGet: &httpclient.GetConnection{
				Time:     startTime,
				HostPort: "example.com:443",
			},
			TLSStart: &httpclient.TLSStart{
				Time: startTime.Add(60 * time.Millisecond),
			},
			TLSDone: &httpclient.TLSDone{
				Time: startTime.Add(110 * time.Millisecond),
			},
		},
	}

	CalculateConnectionMetrics(ctx, logger, store)

	assert.Equal(t, []float64{0.05}, store.tlsDurations)
	assert.Equal(t, []attribute.KeyValue{rotel.WgHost.String("example.com")}, store.tlsHosts)
}

func TestCalculateConnectionMetrics_Dial(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop()
	store := &mockConnectionMetricStore{}

	// Create a context with client trace
	ctx = httpclient.InitTraceContext(ctx)
	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// Test dial metrics
	startTime := time.Now()
	fromTrace.ClientTraces = []*httpclient.ClientTrace{
		{
			ConnectionGet: &httpclient.GetConnection{
				Time:     startTime,
				HostPort: "example.com:443",
			},
			DialStart: []httpclient.DialStart{
				{
					Time:    startTime.Add(120 * time.Millisecond),
					Network: "tcp",
					Address: "example.com:443",
				},
			},
			DialDone: []httpclient.DialDone{
				{
					Time:    startTime.Add(170 * time.Millisecond),
					Network: "tcp",
					Address: "example.com:443",
				},
			},
		},
	}

	CalculateConnectionMetrics(ctx, logger, store)

	assert.Equal(t, []float64{0.05}, store.dialDurations)
	assert.Equal(t, []attribute.KeyValue{rotel.WgHost.String("example.com")}, store.dialHosts)
}

func TestCalculateConnectionMetrics_Retry(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop()
	store := &mockConnectionMetricStore{}

	// Create a context with client trace
	ctx = httpclient.InitTraceContext(ctx)
	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// Test retry metrics
	startTime := time.Now()
	fromTrace.ClientTraces = []*httpclient.ClientTrace{
		{
			ConnectionGet: &httpclient.GetConnection{
				Time:     startTime,
				HostPort: "example.com:443",
			},
		},
		{
			ConnectionGet: &httpclient.GetConnection{
				Time:     startTime,
				HostPort: "example.com:443",
			},
		},
	}

	CalculateConnectionMetrics(ctx, logger, store)

	assert.Equal(t, []attribute.KeyValue{rotel.WgHost.String("example.com")}, store.retryHosts)
}

func TestCalculateConnectionMetrics_TotalDuration(t *testing.T) {
	ctx := context.Background()
	logger := zap.NewNop()
	store := &mockConnectionMetricStore{}

	// Create a context with client trace
	ctx = httpclient.InitTraceContext(ctx)
	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// Test total duration metrics
	startTime := time.Now()
	fromTrace.ClientTraces = []*httpclient.ClientTrace{
		{
			ConnectionGet: &httpclient.GetConnection{
				Time:     startTime,
				HostPort: "example.com:443",
			},
			DNSStart: &httpclient.DNSStart{
				Time: startTime,
				Host: "example.com",
			},
			DNSDone: &httpclient.DNSDone{
				Time: startTime.Add(50 * time.Millisecond),
			},
			TLSStart: &httpclient.TLSStart{
				Time: startTime.Add(60 * time.Millisecond),
			},
			TLSDone: &httpclient.TLSDone{
				Time: startTime.Add(110 * time.Millisecond),
			},
		},
	}

	CalculateConnectionMetrics(ctx, logger, store)

	assert.Equal(t, []float64{0.15}, store.totalDurations)
	assert.Equal(t, []attribute.KeyValue{rotel.WgHost.String("example.com")}, store.totalHosts)
}
