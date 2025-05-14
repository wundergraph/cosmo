package httpclient

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"sync"
	"time"
)

type ClientTraceContextKey struct{}

type TraceInjectingRoundTripper struct {
	base http.RoundTripper
}

func NewTraceInjectingRoundTripper(base http.RoundTripper) *TraceInjectingRoundTripper {
	return &TraceInjectingRoundTripper{
		base: base,
	}
}

func GetClientTraceFromContext(ctx context.Context) *ClientTrace {
	value := ctx.Value(ClientTraceContextKey{})
	// Return no-op context if the subgraph context key was never set
	if value == nil {
		return &ClientTrace{}
	}
	return value.(*ClientTrace)
}

func (t *TraceInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	trace := t.getClientTrace(req.Context())

	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	trip, err := t.base.RoundTrip(req)

	return trip, err
}

func InitTraceContext(ctx context.Context) context.Context {
	trace := &ClientTrace{
		DialStart: make([]SubgraphDialStart, 0),
		DialDone:  make([]SubgraphDialDone, 0),
	}
	ctx = context.WithValue(ctx, ClientTraceContextKey{}, trace)
	return ctx
}

func (t *TraceInjectingRoundTripper) getClientTrace(ctx context.Context) *httptrace.ClientTrace {
	eC := GetClientTraceFromContext(ctx)

	var dialStartMu sync.Mutex
	var dialDoneMu sync.Mutex

	trace := &httptrace.ClientTrace{
		GetConn: func(hostPort string) {
			eC.ConnectionCreate = &CreateSubgraphConnection{
				Time:     time.Now(),
				HostPort: hostPort,
			}
		},
		GotConn: func(info httptrace.GotConnInfo) {
			eC.ConnectionAcquired = &AcquiredSubgraphConnection{
				Time:     time.Now(),
				Reused:   info.Reused,
				WasIdle:  info.WasIdle,
				IdleTime: info.IdleTime,
			}
		},
		GotFirstResponseByte: func() {
			eC.FirstByte = &SubgraphFirstByte{
				Time: time.Now(),
			}
		},
		DNSStart: func(dnsStartInfo httptrace.DNSStartInfo) {
			eC.DNSStart = &SubgraphDNSStart{
				Time: time.Now(),
				Host: dnsStartInfo.Host,
			}
		},
		DNSDone: func(dnsDoneInfo httptrace.DNSDoneInfo) {
			eC.DNSDone = &SubgraphDNSDone{
				Time:      time.Now(),
				Coalesced: dnsDoneInfo.Coalesced,
				Error:     dnsDoneInfo.Err,
			}
		},
		ConnectStart: func(network, addr string) {
			start := SubgraphDialStart{
				Time:    time.Now(),
				Network: network,
				Address: addr,
			}

			dialStartMu.Lock()
			defer dialStartMu.Unlock()
			eC.DialStart = append(eC.DialStart, start)
		},
		ConnectDone: func(network, addr string, err error) {
			done := SubgraphDialDone{
				Time:    time.Now(),
				Network: network,
				Address: addr,
				Error:   err,
			}

			dialDoneMu.Lock()
			defer dialDoneMu.Unlock()
			eC.DialDone = append(eC.DialDone, done)
		},
		TLSHandshakeStart: func() {
			eC.TLSStart = &SubgraphTLSStart{
				Time: time.Now(),
			}
		},
		TLSHandshakeDone: func(connectionState tls.ConnectionState, err error) {
			eC.TLSDone = &SubgraphTLSDone{
				Time:      time.Now(),
				Complete:  connectionState.HandshakeComplete,
				DidResume: connectionState.DidResume,
				Error:     err,
			}
		},
		WroteHeaders: func() {
			eC.WroteHeaders = &SubgraphWroteHeaders{
				Time: time.Now(),
			}
		},
		WroteRequest: func(wroteRequestInfo httptrace.WroteRequestInfo) {
			eC.WroteRequest = &SubgraphWroteRequest{
				Time:  time.Now(),
				Error: wroteRequestInfo.Err,
			}
		},
		PutIdleConn:      nil,
		Got100Continue:   nil,
		Got1xxResponse:   nil,
		WroteHeaderField: nil,
		Wait100Continue:  nil,
	}
	return trace
}
