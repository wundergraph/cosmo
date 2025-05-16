package httpclient

import (
	"sort"
	"time"
)

type DNSStart struct {
	Time time.Time
	Host string
}

type DNSDone struct {
	Time      time.Time
	Coalesced bool
	Error     error
}

type TLSStart struct {
	Time time.Time
}

type TLSDone struct {
	Time      time.Time
	Complete  bool
	DidResume bool
	Error     error
}

type DialStart struct {
	Time    time.Time
	Network string
	Address string
}

type DialDone struct {
	Time    time.Time
	Network string
	Address string
	Error   error
}

type WroteHeaders struct {
	Time time.Time
}

type WroteRequest struct {
	Time  time.Time
	Error error
}

type FirstByte struct {
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
	DNSStart           *DNSStart
	DNSDone            *DNSDone
	TLSStart           *TLSStart
	TLSDone            *TLSDone
	DialStart          []DialStart
	DialDone           []DialDone
	WroteHeaders       *WroteHeaders
	WroteRequest       *WroteRequest
	FirstByte          *FirstByte
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

// GetGroupedDials returns a slice of DialCombined structs
// Which are combined based on the network (tcp/udp/...) and address
// We sort by the first dial that was successful, so that the most likely
// used dial is first in the list
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
		iDone, jDone := dialResults[i].DialDoneTime, dialResults[j].DialDoneTime
		iErr, jErr := dialResults[i].Error, dialResults[j].Error

		switch {
		case iDone == nil:
			return false
		case jDone == nil:
			return true
		case iErr == nil && jErr != nil:
			return true
		case iErr != nil && jErr == nil:
			return false
		default:
			return iDone.Before(*jDone)
		}
	})

	return dialResults
}
