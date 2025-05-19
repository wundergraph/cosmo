package httpclient

import (
	"time"
)

type DNSStart struct {
	Time time.Time
	Host string
}

type DNSDone struct {
	Time  time.Time
	Error error
}

type TLSStart struct {
	Time time.Time
}

type TLSDone struct {
	Time  time.Time
	Error error
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
	IdleTime time.Duration
	Reused   bool
	WasIdle  bool
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
	DialStart          *DialStart
	DialDone           *DialDone
	WroteHeaders       *WroteHeaders
	WroteRequest       *WroteRequest
	FirstByte          *FirstByte
}

type DialCombined struct {
	DialStartTime time.Time
	DialDoneTime  *time.Time
	Error         error
	Network       string
	Address       string
}
