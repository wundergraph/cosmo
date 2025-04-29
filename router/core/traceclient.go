package core

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptrace"
	"time"

	"github.com/wundergraph/cosmo/router/internal/expr"
)

type TraceInjectingRoundTripper struct {
	base http.RoundTripper
}

func NewTraceInjectingRoundTripper(base http.RoundTripper) *TraceInjectingRoundTripper {
	return &TraceInjectingRoundTripper{
		base: base,
	}
}

func (t *TraceInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	trace := t.getClientTrace(req.Context())

	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	trip, err := t.base.RoundTrip(req)

	return trip, err
}

func (t *TraceInjectingRoundTripper) getClientTrace(ctx context.Context) *httptrace.ClientTrace {
	trace := &httptrace.ClientTrace{
		GetConn: func(hostPort string) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			create := &eC.Subgraph.Operation.Trace.Connection.Create
			create.Time = time.Now()
			create.HostPort = hostPort
		},
		GotConn: func(info httptrace.GotConnInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			acquired := &eC.Subgraph.Operation.Trace.Connection.Acquired
			acquired.Time = time.Now()
			acquired.Reused = info.Reused
			acquired.WasIdle = info.WasIdle
			acquired.IdleTime = info.IdleTime
		},
		PutIdleConn: func(err error) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			putIdle := &eC.Subgraph.Operation.Trace.Connection.PutIdle
			putIdle.Time = time.Now()
			putIdle.Error = err
		},
		GotFirstResponseByte: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			response := &eC.Subgraph.Operation.Trace.Response
			response.FirstByte = time.Now()
		},
		Got100Continue: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			response := &eC.Subgraph.Operation.Trace.Response
			response.Continue = time.Now()
		},
		Got1xxResponse: nil,
		DNSStart: func(dnsStartInfo httptrace.DNSStartInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			dnsStart := &eC.Subgraph.Operation.Trace.DNS.Start
			dnsStart.Time = time.Now()
			dnsStart.Host = dnsStartInfo.Host
		},
		DNSDone: func(dnsDoneInfo httptrace.DNSDoneInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)

			addresses := make([]string, len(dnsDoneInfo.Addrs))
			for i, addr := range dnsDoneInfo.Addrs {
				addresses[i] = addr.String()
			}

			dnsDone := &eC.Subgraph.Operation.Trace.DNS.Done
			dnsDone.Time = time.Now()
			dnsDone.Addresses = addresses
			dnsDone.Coalesced = dnsDoneInfo.Coalesced
			dnsDone.Error = dnsDoneInfo.Err
		},
		ConnectStart: func(network, addr string) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			connectStart := &eC.Subgraph.Operation.Trace.Dial.Start
			connectStart.Time = time.Now()
			connectStart.Network = network
			connectStart.Address = addr
		},
		ConnectDone: func(network, addr string, err error) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			connectDone := &eC.Subgraph.Operation.Trace.Dial.Done
			connectDone.Time = time.Now()
			connectDone.Network = network
			connectDone.Address = addr
			connectDone.Error = err
		},
		TLSHandshakeStart: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			tlsStart := &eC.Subgraph.Operation.Trace.TLS.Start
			tlsStart.Time = time.Now()
		},
		TLSHandshakeDone: func(connectionState tls.ConnectionState, err error) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			tlsDone := &eC.Subgraph.Operation.Trace.TLS.Done
			tlsDone.Time = time.Now()
			tlsDone.Complete = connectionState.HandshakeComplete
			tlsDone.CipherSuite = t.getCipherSuiteName(connectionState.CipherSuite)
			tlsDone.DidResume = connectionState.DidResume
			tlsDone.Version = tls.VersionName(connectionState.Version)
			tlsDone.Error = err
		},
		WroteHeaderField: nil,
		WroteHeaders: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			headers := &eC.Subgraph.Operation.Trace.Request.Headers
			headers.Time = time.Now()
		},
		Wait100Continue: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			wait100 := &eC.Subgraph.Operation.Trace.Request.Wait100Continue
			wait100.Time = time.Now()
		},
		WroteRequest: func(wroteRequestInfo httptrace.WroteRequestInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			wroteRequest := &eC.Subgraph.Operation.Trace.Request.WroteRequest
			wroteRequest.Time = time.Now()
			wroteRequest.Error = wroteRequestInfo.Err
		},
	}
	return trace
}

func (t *TraceInjectingRoundTripper) getErrString(err error) string {
	errString := "null"
	if err != nil {
		errString = fmt.Sprintf("%q", err)
	}
	return errString
}

// Helper to get the cipher suite to follow the standard trace attribute
func (t *TraceInjectingRoundTripper) getCipherSuiteName(id uint16) string {
	for _, cs := range tls.CipherSuites() {
		if cs.ID == id {
			return cs.Name
		}
	}
	for _, cs := range tls.InsecureCipherSuites() {
		if cs.ID == id {
			return cs.Name
		}
	}
	return fmt.Sprintf("%d", id)
}
