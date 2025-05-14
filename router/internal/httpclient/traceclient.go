package httpclient

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"sync"
	"time"
)

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

func GetClientTraceFromContext(ctx context.Context) *ClientTraceInfo {
	value := ctx.Value(ClientTraceContextKey{})
	// Return no-op context if the subgraph context key was never set
	if value == nil {
		return &ClientTraceInfo{}
	}
	return value.(*ClientTraceInfo)
}

func (t *TraceInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	trace := t.getClientTrace(req.Context())

	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	trip, err := t.base.RoundTrip(req)

	return trip, err
}

func IncrementRetryCount(ctx context.Context) {
	fromContext := GetClientTraceFromContext(ctx)
	fromContext.RetryCountLatestIndex++
	fromContext.ClientTraces = append(fromContext.ClientTraces, &ClientTrace{})
}

func InitTraceContext(ctx context.Context) context.Context {
	trace := &ClientTraceInfo{
		ClientTraces: []*ClientTrace{
			{},
		},
	}
	ctx = context.WithValue(ctx, ClientTraceContextKey{}, trace)
	return ctx
}

func (t *TraceInjectingRoundTripper) getClientTrace(ctx context.Context) *httptrace.ClientTrace {
	ecList := GetClientTraceFromContext(ctx)
	eC := ecList.ClientTraces[ecList.RetryCountLatestIndex]

	var dialStartMu sync.Mutex
	var dialDoneMu sync.Mutex

	trace := &httptrace.ClientTrace{
		GetConn: func(hostPort string) {
			eC.ConnectionGet = &GetConnection{
				Time:     time.Now(),
				HostPort: hostPort,
			}
		},
		GotConn: func(info httptrace.GotConnInfo) {
			eC.ConnectionAcquired = &AcquiredConnection{
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
		WroteRequest:     nil,
		PutIdleConn:      nil,
		Got100Continue:   nil,
		Got1xxResponse:   nil,
		WroteHeaderField: nil,
		Wait100Continue:  nil,
	}
	return trace
}

