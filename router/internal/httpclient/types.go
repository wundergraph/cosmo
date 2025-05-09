package httpclient

import "time"

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

type ClientTrace struct {
	ConnectionCreate   *CreateSubgraphConnection
	ConnectionAcquired *AcquiredSubgraphConnection
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
