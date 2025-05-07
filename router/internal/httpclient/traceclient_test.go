package httpclient

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptrace"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTraceClient(t *testing.T) {
	t.Parallel()

	t.Run("verify GetConn", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		hostString := "localhost:3002"
		trace.GetConn(hostString)

		clientTrace := GetClientTraceFromContext(ctx)
		require.Equal(t, hostString, clientTrace.ConnectionCreate.HostPort)
		require.False(t, clientTrace.ConnectionCreate.Time.IsZero())
	})

	t.Run("verify GotConn", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		info := httptrace.GotConnInfo{
			Conn:     nil,
			Reused:   true,
			WasIdle:  true,
			IdleTime: 10 * time.Second,
		}
		trace.GotConn(info)

		clientTrace := GetClientTraceFromContext(ctx)
		require.True(t, clientTrace.ConnectionAcquired.Reused)
		require.True(t, clientTrace.ConnectionAcquired.WasIdle)
		require.Equal(t, 10*time.Second, clientTrace.ConnectionAcquired.IdleTime)
		require.False(t, clientTrace.ConnectionAcquired.Time.IsZero())
	})

	t.Run("verify GotFirstResponseByte", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		trace.GotFirstResponseByte()

		clientTrace := GetClientTraceFromContext(ctx)
		require.False(t, clientTrace.FirstByte.Time.IsZero())
	})

	t.Run("verify DNSStart", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		host := "example.com"
		trace.DNSStart(httptrace.DNSStartInfo{Host: host})

		clientTrace := GetClientTraceFromContext(ctx)
		require.Equal(t, host, clientTrace.DNSStart.Host)
		require.False(t, clientTrace.DNSStart.Time.IsZero())
	})

	t.Run("verify DNSDone", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		expectedErr := errors.New("dns error")
		trace.DNSDone(httptrace.DNSDoneInfo{
			Addrs:     []net.IPAddr{{IP: net.ParseIP("192.168.1.1")}, {IP: net.ParseIP("192.168.1.2")}},
			Coalesced: true,
			Err:       expectedErr,
		})

		clientTrace := GetClientTraceFromContext(ctx)
		require.True(t, clientTrace.DNSDone.Coalesced)
		require.Equal(t, expectedErr, clientTrace.DNSDone.Error)
		require.False(t, clientTrace.DNSDone.Time.IsZero())
	})

	t.Run("verify ConnectStart", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		network := "tcp"
		addr := "192.168.1.1:80"
		trace.ConnectStart(network, addr)

		clientTrace := GetClientTraceFromContext(ctx)
		require.Len(t, clientTrace.DialStart, 1)
		require.Equal(t, network, clientTrace.DialStart[0].Network)
		require.Equal(t, addr, clientTrace.DialStart[0].Address)
		require.False(t, clientTrace.DialStart[0].Time.IsZero())
	})

	t.Run("verify ConnectStart concurrent", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		const numGoroutines = 10
		done := make(chan struct{})

		for i := 0; i < numGoroutines; i++ {
			go func(i int) {
				network := fmt.Sprintf("tcp%d", i)
				addr := fmt.Sprintf("192.168.1.%d:80", i)
				trace.ConnectStart(network, addr)
				done <- struct{}{}
			}(i)
		}

		// Wait for all goroutines to complete
		for i := 0; i < numGoroutines; i++ {
			<-done
		}

		clientTrace := GetClientTraceFromContext(ctx)
		require.Len(t, clientTrace.DialStart, numGoroutines)

		// Verify all entries were recorded
		seen := make(map[string]bool)
		for _, dial := range clientTrace.DialStart {
			key := fmt.Sprintf("%s-%s", dial.Network, dial.Address)
			require.False(t, seen[key], "duplicate dial entry found")
			seen[key] = true
			require.False(t, dial.Time.IsZero())
		}
	})

	t.Run("verify ConnectDone", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		network := "tcp"
		addr := "192.168.1.1:80"
		expectedErr := errors.New("connection error")
		trace.ConnectDone(network, addr, expectedErr)

		clientTrace := GetClientTraceFromContext(ctx)
		require.Len(t, clientTrace.DialDone, 1)
		require.Equal(t, network, clientTrace.DialDone[0].Network)
		require.Equal(t, addr, clientTrace.DialDone[0].Address)
		require.Equal(t, expectedErr, clientTrace.DialDone[0].Error)
		require.False(t, clientTrace.DialDone[0].Time.IsZero())
	})

	t.Run("verify ConnectDone concurrent", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		const numGoroutines = 10
		done := make(chan struct{})

		for i := 0; i < numGoroutines; i++ {
			go func(i int) {
				network := fmt.Sprintf("tcp%d", i)
				addr := fmt.Sprintf("192.168.1.%d:80", i)
				err := fmt.Errorf("connection error %d", i)
				trace.ConnectDone(network, addr, err)
				done <- struct{}{}
			}(i)
		}

		// Wait for all goroutines to complete
		for i := 0; i < numGoroutines; i++ {
			<-done
		}

		clientTrace := GetClientTraceFromContext(ctx)
		require.Len(t, clientTrace.DialDone, numGoroutines)

		// Verify all entries were recorded
		seen := make(map[string]bool)
		for _, dial := range clientTrace.DialDone {
			key := fmt.Sprintf("%s-%s", dial.Network, dial.Address)
			require.False(t, seen[key], "duplicate dial entry found")
			seen[key] = true
			require.False(t, dial.Time.IsZero())
			require.Contains(t, dial.Error.Error(), "connection error")
		}
	})

	t.Run("verify TLSHandshakeStart", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		trace.TLSHandshakeStart()

		clientTrace := GetClientTraceFromContext(ctx)
		require.False(t, clientTrace.TLSStart.Time.IsZero())
	})

	t.Run("verify TLSHandshakeDone", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		expectedErr := errors.New("tls error")
		connectionState := tls.ConnectionState{
			HandshakeComplete: true,
			CipherSuite:       tls.TLS_AES_128_GCM_SHA256,
			DidResume:         true,
			Version:           tls.VersionTLS13,
		}
		trace.TLSHandshakeDone(connectionState, expectedErr)

		clientTrace := GetClientTraceFromContext(ctx)
		require.True(t, clientTrace.TLSDone.Complete)
		require.True(t, clientTrace.TLSDone.DidResume)
		require.Equal(t, expectedErr, clientTrace.TLSDone.Error)
		require.False(t, clientTrace.TLSDone.Time.IsZero())
	})

	t.Run("verify WroteHeaders", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		trace.WroteHeaders()

		clientTrace := GetClientTraceFromContext(ctx)
		require.False(t, clientTrace.WroteHeaders.Time.IsZero())
	})

	t.Run("verify WroteRequest", func(t *testing.T) {
		t.Parallel()
		ctx, trace := setupTest()

		expectedErr := errors.New("write error")
		trace.WroteRequest(httptrace.WroteRequestInfo{Err: expectedErr})

		clientTrace := GetClientTraceFromContext(ctx)
		require.Equal(t, expectedErr, clientTrace.WroteRequest.Error)
		require.False(t, clientTrace.WroteRequest.Time.IsZero())
	})
}

func TestTraceInjectingRoundTripper_RoundTrip(t *testing.T) {
	t.Parallel()

	t.Run("successful round trip", func(t *testing.T) {
		t.Parallel()
		// Create a mock round tripper that returns a successful response
		mockRT := &mockRoundTripper{
			response: &http.Response{
				StatusCode: http.StatusOK,
				Body:       http.NoBody,
			},
		}

		// Create the trace injecting round tripper with our mock
		traceRT := NewTraceInjectingRoundTripper(mockRT)

		// Create a test request
		req, err := http.NewRequest("GET", "http://example.com", nil)
		require.NoError(t, err)

		// Add trace context to the request
		ctx := InitTraceContext(req.Context())
		req = req.WithContext(ctx)

		// Perform the round trip
		resp, err := traceRT.RoundTrip(req)
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("error from base round tripper", func(t *testing.T) {
		t.Parallel()
		// Create a mock round tripper that returns an error
		expectedErr := errors.New("connection failed")
		mockRT := &mockRoundTripper{
			err: expectedErr,
		}

		// Create the trace injecting round tripper with our mock
		traceRT := NewTraceInjectingRoundTripper(mockRT)

		// Create a test request
		req, err := http.NewRequest("GET", "http://example.com", nil)
		require.NoError(t, err)

		// Add trace context to the request
		ctx := InitTraceContext(req.Context())
		req = req.WithContext(ctx)

		// Perform the round trip
		resp, err := traceRT.RoundTrip(req)
		require.Error(t, err)
		require.Equal(t, expectedErr, err)
		require.Nil(t, resp)
	})

	t.Run("nil base round tripper", func(t *testing.T) {
		t.Parallel()
		// Create the trace injecting round tripper with nil base
		traceRT := NewTraceInjectingRoundTripper(nil)

		// Create a test request
		req, err := http.NewRequest("GET", "http://example.com", nil)
		require.NoError(t, err)

		// Add trace context to the request
		ctx := InitTraceContext(req.Context())
		req = req.WithContext(ctx)

		// Expect a panic when trying to use a nil round tripper
		require.Panics(t, func() {
			traceRT.RoundTrip(req)
		})
	})
}

// mockRoundTripper implements http.RoundTripper for testing
type mockRoundTripper struct {
	response *http.Response
	err      error
}

func (m *mockRoundTripper) RoundTrip(_ *http.Request) (*http.Response, error) {
	return m.response, m.err
}

func setupTest() (context.Context, *httptrace.ClientTrace) {
	ctx := context.Background()
	ctx = InitTraceContext(ctx)

	traceInjector := NewTraceInjectingRoundTripper(nil)
	clientTraceHooks := traceInjector.getClientTrace(ctx)
	return ctx, clientTraceHooks
}
