package expr

import "github.com/wundergraph/cosmo/router/internal/httpclient"

// ConvertToExprTrace converts an OperationTrace to an expr.ClientTrace
func ConvertToExprTrace(trace *httpclient.ClientTrace) *ClientTrace {
	if trace == nil {
		return nil
	}

	result := &ClientTrace{}

	if trace.ConnectionCreate != nil {
		result.ConnectionCreate = &CreateSubgraphConnection{
			Time:     trace.ConnectionCreate.Time,
			HostPort: trace.ConnectionCreate.HostPort,
		}
	}

	if trace.ConnectionAcquired != nil {
		result.ConnectionAcquired = &AcquiredSubgraphConnection{
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

	if trace.DialStart != nil || trace.DialDone != nil {
		result.Dial = &Dial{}

		result.Dial.DialDone = make([]SubgraphDialDone, 0)
		result.Dial.DialStart = make([]SubgraphDialStart, 0)

		for _, dialStart := range trace.DialStart {
			dialStartExpr := SubgraphDialStart{
				Time:    dialStart.Time,
				Network: dialStart.Network,
				Address: dialStart.Address,
			}
			result.Dial.DialStart = append(result.Dial.DialStart, dialStartExpr)
		}

		for _, dialDone := range trace.DialDone {
			dialDoneExpr := SubgraphDialDone{
				Time:    dialDone.Time,
				Network: dialDone.Network,
				Address: dialDone.Address,
				Error:   wrapExprError(dialDone.Error),
			}
			result.Dial.DialDone = append(result.Dial.DialDone, dialDoneExpr)
		}
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
