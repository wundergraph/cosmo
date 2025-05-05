package core

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/http/httptrace"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
)

func TestTraceClient(t *testing.T) {
	t.Parallel()

	t.Run("verify GetConn", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		hostString := "localhost:3002"
		clientTraceHooks.GetConn(hostString)

		require.Equal(t, hostString, exprCtx.Subgraph.Operation.Trace.ConnectionCreate.HostPort)
		require.False(t, exprCtx.Subgraph.Operation.Trace.ConnectionCreate.Time.IsZero())
	})

	t.Run("verify GotConn", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		info := httptrace.GotConnInfo{
			Conn:     nil,
			Reused:   true,
			WasIdle:  true,
			IdleTime: 10 * time.Second,
		}
		clientTraceHooks.GotConn(info)

		require.True(t, exprCtx.Subgraph.Operation.Trace.ConnectionAcquired.Reused)
		require.True(t, exprCtx.Subgraph.Operation.Trace.ConnectionAcquired.WasIdle)
		require.Equal(t, 10*time.Second, exprCtx.Subgraph.Operation.Trace.ConnectionAcquired.IdleTime)
		require.False(t, exprCtx.Subgraph.Operation.Trace.ConnectionAcquired.Time.IsZero())
	})

	t.Run("verify PutIdleConn", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		expectedErr := fmt.Errorf("connection error")
		clientTraceHooks.PutIdleConn(expectedErr)

		require.Equal(t, &ExprWrapError{expectedErr}, exprCtx.Subgraph.Operation.Trace.ConnectionPutIdle.Error)
		require.False(t, exprCtx.Subgraph.Operation.Trace.ConnectionPutIdle.Time.IsZero())
	})

	t.Run("verify GotFirstResponseByte", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		clientTraceHooks.GotFirstResponseByte()

		require.False(t, exprCtx.Subgraph.Operation.Trace.FirstByte.Time.IsZero())
	})

	t.Run("verify Got100Continue", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		clientTraceHooks.Got100Continue()

		require.False(t, exprCtx.Subgraph.Operation.Trace.Continue100.Time.IsZero())
	})

	t.Run("verify DNSStart", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		host := "example.com"
		clientTraceHooks.DNSStart(httptrace.DNSStartInfo{Host: host})

		require.Equal(t, host, exprCtx.Subgraph.Operation.Trace.DNSStart.Host)
		require.False(t, exprCtx.Subgraph.Operation.Trace.DNSStart.Time.IsZero())
	})

	t.Run("verify DNSDone", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		expectedErr := fmt.Errorf("dns error")
		expectedAddrs := []string{"192.168.1.1", "192.168.1.2"}
		clientTraceHooks.DNSDone(httptrace.DNSDoneInfo{
			Addrs:     []net.IPAddr{{IP: net.ParseIP("192.168.1.1")}, {IP: net.ParseIP("192.168.1.2")}},
			Coalesced: true,
			Err:       expectedErr,
		})

		require.Equal(t, expectedAddrs, exprCtx.Subgraph.Operation.Trace.DNSDone.Addresses)
		require.True(t, exprCtx.Subgraph.Operation.Trace.DNSDone.Coalesced)
		require.Equal(t, &ExprWrapError{expectedErr}, exprCtx.Subgraph.Operation.Trace.DNSDone.Error)
		require.False(t, exprCtx.Subgraph.Operation.Trace.DNSDone.Time.IsZero())
	})

	t.Run("verify ConnectStart", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		network := "tcp"
		addr := "192.168.1.1:80"
		clientTraceHooks.ConnectStart(network, addr)

		require.Equal(t, network, exprCtx.Subgraph.Operation.Trace.DialStart.Network)
		require.Equal(t, addr, exprCtx.Subgraph.Operation.Trace.DialStart.Address)
		require.False(t, exprCtx.Subgraph.Operation.Trace.DialStart.Time.IsZero())
	})

	t.Run("verify ConnectDone", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		network := "tcp"
		addr := "192.168.1.1:80"
		expectedErr := fmt.Errorf("connection error")
		clientTraceHooks.ConnectDone(network, addr, expectedErr)

		require.Equal(t, network, exprCtx.Subgraph.Operation.Trace.DialDone.Network)
		require.Equal(t, addr, exprCtx.Subgraph.Operation.Trace.DialDone.Address)
		require.Equal(t, &ExprWrapError{expectedErr}, exprCtx.Subgraph.Operation.Trace.DialDone.Error)
		require.False(t, exprCtx.Subgraph.Operation.Trace.DialDone.Time.IsZero())
	})

	t.Run("verify TLSHandshakeStart", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		clientTraceHooks.TLSHandshakeStart()

		require.False(t, exprCtx.Subgraph.Operation.Trace.TLSStart.Time.IsZero())
	})

	t.Run("verify TLSHandshakeDone", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		expectedErr := fmt.Errorf("tls error")
		connectionState := tls.ConnectionState{
			HandshakeComplete: true,
			CipherSuite:       tls.TLS_AES_128_GCM_SHA256,
			DidResume:         true,
			Version:           tls.VersionTLS13,
		}
		clientTraceHooks.TLSHandshakeDone(connectionState, expectedErr)

		require.True(t, exprCtx.Subgraph.Operation.Trace.TLSDone.Complete)
		require.Equal(t, "TLS_AES_128_GCM_SHA256", exprCtx.Subgraph.Operation.Trace.TLSDone.CipherSuite)
		require.True(t, exprCtx.Subgraph.Operation.Trace.TLSDone.DidResume)
		require.Equal(t, "TLS 1.3", exprCtx.Subgraph.Operation.Trace.TLSDone.Version)
		require.Equal(t, &ExprWrapError{expectedErr}, exprCtx.Subgraph.Operation.Trace.TLSDone.Error)
		require.False(t, exprCtx.Subgraph.Operation.Trace.TLSDone.Time.IsZero())
	})

	t.Run("verify WroteHeaders", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		clientTraceHooks.WroteHeaders()

		require.False(t, exprCtx.Subgraph.Operation.Trace.WroteHeaders.Time.IsZero())
	})

	t.Run("verify Wait100Continue", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		clientTraceHooks.Wait100Continue()

		require.False(t, exprCtx.Subgraph.Operation.Trace.Wait100Continue.Time.IsZero())
	})

	t.Run("verify WroteRequest", func(t *testing.T) {
		t.Parallel()
		exprCtx, clientTraceHooks := setupTest()

		expectedErr := fmt.Errorf("write error")
		clientTraceHooks.WroteRequest(httptrace.WroteRequestInfo{Err: expectedErr})

		require.Equal(t, &ExprWrapError{expectedErr}, exprCtx.Subgraph.Operation.Trace.WroteRequest.Error)
		require.False(t, exprCtx.Subgraph.Operation.Trace.WroteRequest.Time.IsZero())
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

		// Add expression context to the request
		exprCtx := &expr.Context{}
		ctx := expr.SetSubgraphExpressionContext(req.Context(), exprCtx)
		req = req.WithContext(ctx)

		// Perform the round trip
		resp, err := traceRT.RoundTrip(req)
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("error from base round tripper", func(t *testing.T) {
		t.Parallel()
		// Create a mock round tripper that returns an error
		expectedErr := fmt.Errorf("connection failed")
		mockRT := &mockRoundTripper{
			err: expectedErr,
		}

		// Create the trace injecting round tripper with our mock
		traceRT := NewTraceInjectingRoundTripper(mockRT)

		// Create a test request
		req, err := http.NewRequest("GET", "http://example.com", nil)
		require.NoError(t, err)

		// Add expression context to the request
		exprCtx := &expr.Context{}
		ctx := expr.SetSubgraphExpressionContext(req.Context(), exprCtx)
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

		// Add expression context to the request
		exprCtx := &expr.Context{}
		ctx := expr.SetSubgraphExpressionContext(req.Context(), exprCtx)
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

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return m.response, m.err
}

func setupTest() (*expr.Context, *httptrace.ClientTrace) {
	ctx := context.Background()
	exprCtx := expr.Context{}
	ctx = expr.SetSubgraphExpressionContext(ctx, &exprCtx)

	traceInjector := NewTraceInjectingRoundTripper(nil)
	clientTraceHooks := traceInjector.getClientTrace(ctx)
	return &exprCtx, clientTraceHooks
}
