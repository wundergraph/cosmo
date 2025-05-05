package core

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"time"

	"github.com/wundergraph/cosmo/router/internal/expr"
)

type SubgraphDNSStart struct {
	Time time.Time
	Host string
}

type SubgraphDNSDone struct {
	Time      time.Time
	Addresses []string
	Coalesced bool
	Error     error
}

type SubgraphTLSStart struct {
	Time time.Time
}

type SubgraphTLSDone struct {
	Time      time.Time
	Complete  bool
	DidResume bool
	Error     error
}

type SubgraphDialStart struct {
	Time    time.Time
	Network string
	Address string
}

type SubgraphDialDone struct {
	Time    time.Time
	Network string
	Address string
	Error   error
}

type SubgraphWroteHeaders struct {
	Time time.Time
}

type SubgraphWait100Continue struct {
	Time time.Time
}

type SubgraphWroteRequest struct {
	Time  time.Time
	Error error
}

type SubgraphFirstByte struct {
	Time time.Time
}

type SubgraphContinue100 struct {
	Time time.Time
}

type AcquiredSubgraphConnection struct {
	Time     time.Time
	Reused   bool
	WasIdle  bool
	IdleTime time.Duration
}

type CreateSubgraphConnection struct {
	Time     time.Time
	HostPort string
}

type PutIdleConnection struct {
	Time  time.Time
	Error error
}

type OperationTrace struct {
	ConnectionCreate   *CreateSubgraphConnection
	ConnectionAcquired *AcquiredSubgraphConnection
	ConnectionPutIdle  *PutIdleConnection
	DNSStart           *SubgraphDNSStart
	DNSDone            *SubgraphDNSDone
	TLSStart           *SubgraphTLSStart
	TLSDone            *SubgraphTLSDone
	DialStart          *SubgraphDialStart
	DialDone           *SubgraphDialDone
	WroteHeaders       *SubgraphWroteHeaders
	Wait100Continue    *SubgraphWait100Continue
	WroteRequest       *SubgraphWroteRequest
	FirstByte          *SubgraphFirstByte
	Continue100        *SubgraphContinue100
}

type SubgraphTraceContextKey struct{}

func GetSubgraphTraceFromContext(ctx context.Context) *OperationTrace {
	value := ctx.Value(SubgraphTraceContextKey{})
	// Return no-op context if the subgraph context key was never set
	if value == nil {
		return &OperationTrace{}
	}
	return value.(*OperationTrace)
}

func InitSubgraphTraceContext(ctx context.Context) context.Context {
	trace := &OperationTrace{}
	ctx = context.WithValue(ctx, SubgraphTraceContextKey{}, trace)
	return ctx
}

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
			eC := GetSubgraphTraceFromContext(ctx)
			eC.ConnectionCreate = &CreateSubgraphConnection{
				Time:     time.Now(),
				HostPort: hostPort,
			}
		},
		GotConn: func(info httptrace.GotConnInfo) {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.ConnectionAcquired = &AcquiredSubgraphConnection{
				Time:     time.Now(),
				Reused:   info.Reused,
				WasIdle:  info.WasIdle,
				IdleTime: info.IdleTime,
			}
		},
		PutIdleConn: func(err error) {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.ConnectionPutIdle = &PutIdleConnection{
				Time:  time.Now(),
				Error: err,
			}
		},
		GotFirstResponseByte: func() {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.FirstByte = &SubgraphFirstByte{
				Time: time.Now(),
			}
		},
		Got100Continue: func() {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.Continue100 = &SubgraphContinue100{
				Time: time.Now(),
			}
		},
		Got1xxResponse: nil,
		DNSStart: func(dnsStartInfo httptrace.DNSStartInfo) {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.DNSStart = &SubgraphDNSStart{
				Time: time.Now(),
				Host: dnsStartInfo.Host,
			}
		},
		DNSDone: func(dnsDoneInfo httptrace.DNSDoneInfo) {
			eC := GetSubgraphTraceFromContext(ctx)

			addresses := make([]string, len(dnsDoneInfo.Addrs))
			for i, addr := range dnsDoneInfo.Addrs {
				addresses[i] = addr.String()
			}

			eC.DNSDone = &SubgraphDNSDone{
				Time:      time.Now(),
				Addresses: addresses,
				Coalesced: dnsDoneInfo.Coalesced,
				Error:     dnsDoneInfo.Err,
			}
		},
		ConnectStart: func(network, addr string) {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.DialStart = &SubgraphDialStart{
				Time:    time.Now(),
				Network: network,
				Address: addr,
			}
		},
		ConnectDone: func(network, addr string, err error) {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.DialDone = &SubgraphDialDone{
				Time:    time.Now(),
				Network: network,
				Address: addr,
				Error:   err,
			}
		},
		TLSHandshakeStart: func() {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.TLSStart = &SubgraphTLSStart{
				Time: time.Now(),
			}
		},
		TLSHandshakeDone: func(connectionState tls.ConnectionState, err error) {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.TLSDone = &SubgraphTLSDone{
				Time:      time.Now(),
				Complete:  connectionState.HandshakeComplete,
				DidResume: connectionState.DidResume,
				Error:     err,
			}
		},
		WroteHeaderField: nil,
		WroteHeaders: func() {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.WroteHeaders = &SubgraphWroteHeaders{
				Time: time.Now(),
			}
		},
		Wait100Continue: func() {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.Wait100Continue = &SubgraphWait100Continue{
				Time: time.Now(),
			}
		},
		WroteRequest: func(wroteRequestInfo httptrace.WroteRequestInfo) {
			eC := GetSubgraphTraceFromContext(ctx)
			eC.WroteRequest = &SubgraphWroteRequest{
				Time:  time.Now(),
				Error: wroteRequestInfo.Err,
			}
		},
	}
	return trace
}

// TODO: Move to correct package
// ConvertToExprTrace converts a core.SubgraphTrace to an expr.OperationTrace
func ConvertToExprTrace(trace *OperationTrace) *expr.OperationTrace {
	if trace == nil {
		return nil
	}

	result := &expr.OperationTrace{}

	if trace.ConnectionCreate != nil {
		result.ConnectionCreate = &expr.CreateSubgraphConnection{
			Time:     trace.ConnectionCreate.Time,
			HostPort: trace.ConnectionCreate.HostPort,
		}
	}

	if trace.ConnectionAcquired != nil {
		result.ConnectionAcquired = &expr.AcquiredSubgraphConnection{
			Time:     trace.ConnectionAcquired.Time,
			Reused:   trace.ConnectionAcquired.Reused,
			WasIdle:  trace.ConnectionAcquired.WasIdle,
			IdleTime: trace.ConnectionAcquired.IdleTime,
		}
	}

	if trace.ConnectionPutIdle != nil {
		result.ConnectionPutIdle = &expr.PutIdleConnection{
			Time:  trace.ConnectionPutIdle.Time,
			Error: trace.ConnectionPutIdle.Error,
		}
	}

	if trace.DNSStart != nil {
		result.DNSStart = &expr.SubgraphDNSStart{
			Time: trace.DNSStart.Time,
			Host: trace.DNSStart.Host,
		}
	}

	if trace.DNSDone != nil {
		result.DNSDone = &expr.SubgraphDNSDone{
			Time:      trace.DNSDone.Time,
			Addresses: trace.DNSDone.Addresses,
			Coalesced: trace.DNSDone.Coalesced,
			Error:     wrapExprError(trace.DNSDone.Error),
		}
	}

	if trace.TLSStart != nil {
		result.TLSStart = &expr.SubgraphTLSStart{
			Time: trace.TLSStart.Time,
		}
	}

	if trace.TLSDone != nil {
		result.TLSDone = &expr.SubgraphTLSDone{
			Time:      trace.TLSDone.Time,
			Complete:  trace.TLSDone.Complete,
			DidResume: trace.TLSDone.DidResume,
			Error:     wrapExprError(trace.TLSDone.Error),
		}
	}

	if trace.DialStart != nil {
		result.DialStart = &expr.SubgraphDialStart{
			Time:    trace.DialStart.Time,
			Network: trace.DialStart.Network,
			Address: trace.DialStart.Address,
		}
	}

	if trace.DialDone != nil {
		result.DialDone = &expr.SubgraphDialDone{
			Time:    trace.DialDone.Time,
			Network: trace.DialDone.Network,
			Address: trace.DialDone.Address,
			Error:   wrapExprError(trace.DialDone.Error),
		}
	}

	if trace.WroteHeaders != nil {
		result.WroteHeaders = &expr.SubgraphWroteHeaders{
			Time: trace.WroteHeaders.Time,
		}
	}

	if trace.Wait100Continue != nil {
		result.Wait100Continue = &expr.SubgraphWait100Continue{
			Time: trace.Wait100Continue.Time,
		}
	}

	if trace.WroteRequest != nil {
		result.WroteRequest = &expr.SubgraphWroteRequest{
			Time:  trace.WroteRequest.Time,
			Error: wrapExprError(trace.WroteRequest.Error),
		}
	}

	if trace.FirstByte != nil {
		result.FirstByte = &expr.SubgraphFirstByte{
			Time: trace.FirstByte.Time,
		}
	}

	if trace.Continue100 != nil {
		result.Continue100 = &expr.SubgraphContinue100{
			Time: trace.Continue100.Time,
		}
	}

	return result
}

func wrapExprError(err error) error {
	if err == nil {
		return nil
	}
	return &ExprWrapError{err}
}
