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
			eC.Subgraph.Operation.Trace.ConnectionCreate = &expr.CreateSubgraphConnection{
				Time:     time.Now(),
				HostPort: hostPort,
			}
		},
		GotConn: func(info httptrace.GotConnInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.ConnectionAcquired = &expr.AcquiredSubgraphConnection{
				Time:     time.Now(),
				Reused:   info.Reused,
				WasIdle:  info.WasIdle,
				IdleTime: info.IdleTime,
			}
		},
		PutIdleConn: func(err error) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.ConnectionPutIdle = &expr.PutIdleConnection{
				Time:  time.Now(),
				Error: &ExprWrapError{Err: err},
			}
		},
		GotFirstResponseByte: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.FirstByte = &expr.SubgraphFirstByte{
				Time: time.Now(),
			}
		},
		Got100Continue: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.Continue100 = &expr.SubgraphContinue100{
				Time: time.Now(),
			}
		},
		Got1xxResponse: nil,
		DNSStart: func(dnsStartInfo httptrace.DNSStartInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.DNSStart = &expr.SubgraphDNSStart{
				Time: time.Now(),
				Host: dnsStartInfo.Host,
			}
		},
		DNSDone: func(dnsDoneInfo httptrace.DNSDoneInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)

			addresses := make([]string, len(dnsDoneInfo.Addrs))
			for i, addr := range dnsDoneInfo.Addrs {
				addresses[i] = addr.String()
			}

			eC.Subgraph.Operation.Trace.DNSDone = &expr.SubgraphDNSDone{
				Time:      time.Now(),
				Addresses: addresses,
				Coalesced: dnsDoneInfo.Coalesced,
				Error:     &ExprWrapError{Err: dnsDoneInfo.Err},
			}
		},
		ConnectStart: func(network, addr string) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.DialStart = &expr.SubgraphDialStart{
				Time:    time.Now(),
				Network: network,
				Address: addr,
			}
		},
		ConnectDone: func(network, addr string, err error) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.DialDone = &expr.SubgraphDialDone{
				Time:    time.Now(),
				Network: network,
				Address: addr,
				Error:   &ExprWrapError{Err: err},
			}
		},
		TLSHandshakeStart: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.TLSStart = &expr.SubgraphTLSStart{
				Time: time.Now(),
			}
		},
		TLSHandshakeDone: func(connectionState tls.ConnectionState, err error) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.TLSDone = &expr.SubgraphTLSDone{
				Time:        time.Now(),
				Complete:    connectionState.HandshakeComplete,
				CipherSuite: t.getCipherSuiteName(connectionState.CipherSuite),
				DidResume:   connectionState.DidResume,
				Version:     tls.VersionName(connectionState.Version),
				Error:       &ExprWrapError{Err: err},
			}
		},
		WroteHeaderField: nil,
		WroteHeaders: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.WroteHeaders = &expr.SubgraphWroteHeaders{
				Time: time.Now(),
			}
		},
		Wait100Continue: func() {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.Wait100Continue = &expr.SubgraphWait100Continue{
				Time: time.Now(),
			}
		},
		WroteRequest: func(wroteRequestInfo httptrace.WroteRequestInfo) {
			eC := expr.GetSubgraphExpressionContext(ctx)
			eC.Subgraph.Operation.Trace.WroteRequest = &expr.SubgraphWroteRequest{
				Time:  time.Now(),
				Error: &ExprWrapError{Err: wroteRequestInfo.Err},
			}
		},
	}
	return trace
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
