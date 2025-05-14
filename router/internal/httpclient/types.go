package httpclient

import (
	"sort"
	"time"
)

type SubgraphDNSStart struct {
	Time time.Time
	Host string
}

type SubgraphDNSDone struct {
	Time      time.Time
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

type SubgraphWroteRequest struct {
	Time  time.Time
	Error error
}

type SubgraphFirstByte struct {
	Time time.Time
}

type AcquiredConnection struct {
	Time     time.Time
	Reused   bool
	WasIdle  bool
	IdleTime time.Duration
}

type GetConnection struct {
	Time     time.Time
	HostPort string
}

type ClientTrace struct {
	ConnectionGet      *GetConnection
	ConnectionAcquired *AcquiredConnection
	DNSStart           *SubgraphDNSStart
	DNSDone            *SubgraphDNSDone
	TLSStart           *SubgraphTLSStart
	TLSDone            *SubgraphTLSDone
	DialStart          []SubgraphDialStart
	DialDone           []SubgraphDialDone
	WroteHeaders       *SubgraphWroteHeaders
	WroteRequest       *SubgraphWroteRequest
	FirstByte          *SubgraphFirstByte
}

type ClientTraceInfo struct {
	ClientTraces          []*ClientTrace
	RetryCountLatestIndex int
}

type DialCombined struct {
	DialStartTime time.Time
	DialDoneTime  *time.Time
	Error         error
	Network       string
	Address       string
}

func (r ClientTrace) GetGroupedDials() []DialCombined {
	dialMap := make(map[string]*DialCombined)

	for _, start := range r.DialStart {
		key := start.Network + "_" + start.Address
		dialMap[key] = &DialCombined{
			DialStartTime: start.Time,
			Network:       start.Network,
			Address:       start.Address,
		}
	}

	for _, done := range r.DialDone {
		key := done.Network + "_" + done.Address
		if dial, exists := dialMap[key]; exists {
			dial.DialDoneTime = &done.Time
			dial.Error = done.Error
		}
	}

	dialResults := make([]DialCombined, 0, len(dialMap))
	for _, dial := range dialMap {
		dialResults = append(dialResults, *dial)
	}

	// Sort the results by DialDoneTime without error
	sort.Slice(dialResults, func(i, j int) bool {
		// Sort only those without errors and with non-nil DialDoneTime
		iDone := dialResults[i].DialDoneTime
		jDone := dialResults[j].DialDoneTime

		if iDone == nil && jDone != nil {
			return false
		}
		if iDone != nil && jDone == nil {
			return true
		}
		if iDone == nil && jDone == nil {
			return false
		}

		if dialResults[i].Error != nil && dialResults[j].Error == nil {
			return false
		}
		if dialResults[i].Error == nil && dialResults[j].Error != nil {
			return true
		}
		return iDone.Before(*jDone)
	})

	return dialResults
}
