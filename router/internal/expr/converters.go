package expr

import "github.com/wundergraph/cosmo/router/internal/httpclient"

func ConvertToExprTrace(trace *httpclient.ClientTraceInfo) (ClientTrace, []ClientTrace, int) {
	retryClientTraces := make([]ClientTrace, 0, trace.RetryCountLatestIndex)
	for k := 0; k < trace.RetryCountLatestIndex; k++ {
		ConvertClientTrace(trace.ClientTraces[k])
	}

	base := ConvertClientTrace(trace.ClientTraces[trace.RetryCountLatestIndex])

	return base, retryClientTraces, trace.RetryCountLatestIndex + 1
}

func ConvertClientTrace(trace *httpclient.ClientTrace) ClientTrace {
	result := ClientTrace{}

	if trace.ConnectionCreate != nil {
		result.ConnectionCreate = &CreateConnection{
			Time:     trace.ConnectionCreate.Time,
			HostPort: trace.ConnectionCreate.HostPort,
		}
	}

	if trace.ConnectionAcquired != nil {
		result.ConnectionAcquired = &AcquiredConnection{
			Time:     trace.ConnectionAcquired.Time,
			Reused:   trace.ConnectionAcquired.Reused,
			WasIdle:  trace.ConnectionAcquired.WasIdle,
			IdleTime: trace.ConnectionAcquired.IdleTime,
		}
	}

	if trace.DNSStart != nil {
		result.DNSStart = &DNSStart{
			Time: trace.DNSStart.Time,
			Host: trace.DNSStart.Host,
		}
	}

	if trace.DNSDone != nil {
		result.DNSDone = &DNSDone{
			Time:      trace.DNSDone.Time,
			Coalesced: trace.DNSDone.Coalesced,
			Error:     wrapExprError(trace.DNSDone.Error),
		}
	}

	if trace.TLSStart != nil {
		result.TLSStart = &TLSStart{
			Time: trace.TLSStart.Time,
		}
	}

	if trace.TLSDone != nil {
		result.TLSDone = &TLSDone{
			Time:      trace.TLSDone.Time,
			Complete:  trace.TLSDone.Complete,
			DidResume: trace.TLSDone.DidResume,
			Error:     wrapExprError(trace.TLSDone.Error),
		}
	}

	result.DialStart = make([]SubgraphDialStart, 0, len(trace.DialStart))
	for _, dialStart := range trace.DialStart {
		dialStartExpr := SubgraphDialStart{
			Time:    dialStart.Time,
			Network: dialStart.Network,
			Address: dialStart.Address,
		}
		result.DialStart = append(result.DialStart, dialStartExpr)
	}

	result.DialDone = make([]SubgraphDialDone, 0, len(trace.DialDone))
	for _, dialDone := range trace.DialDone {
		dialDoneExpr := SubgraphDialDone{
			Time:    dialDone.Time,
			Network: dialDone.Network,
			Address: dialDone.Address,
			Error:   wrapExprError(dialDone.Error),
		}
		result.DialDone = append(result.DialDone, dialDoneExpr)
	}

	if trace.WroteHeaders != nil {
		result.WroteHeaders = &WroteHeaders{
			Time: trace.WroteHeaders.Time,
		}
	}

	if trace.WroteRequest != nil {
		result.WroteRequest = &WroteRequest{
			Time:  trace.WroteRequest.Time,
			Error: wrapExprError(trace.WroteRequest.Error),
		}
	}

	if trace.FirstByte != nil {
		result.FirstByte = &FirstByte{
			Time: trace.FirstByte.Time,
		}
	}

	return result
}

type WrapError struct {
	Err error
}

func (e *WrapError) Error() string {
	if e.Err == nil {
		return ""
	}
	return e.Err.Error()
}

func wrapExprError(err error) error {
	if err == nil {
		return nil
	}
	return &WrapError{err}
}
