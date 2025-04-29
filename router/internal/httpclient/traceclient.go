package httpclient

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptrace"
	"time"
)

type logHooksFunc func(ctx context.Context, key string, value any)

type TraceInjectingRoundTripper struct {
	base         http.RoundTripper
	addAttribute logHooksFunc
}

func NewTraceInjectingRoundTripper(base http.RoundTripper, logHooks func(ctx context.Context, key string, value any)) *TraceInjectingRoundTripper {
	return &TraceInjectingRoundTripper{
		base:         base,
		addAttribute: logHooks,
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
			t.addAttribute(ctx, "getconn.time", time.Now())
			t.addAttribute(ctx, "getconn.hostport", hostPort)
		},
		GotConn: func(info httptrace.GotConnInfo) {
			t.addAttribute(ctx, "gotconn.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "gotconn.reused", info.Reused)
			t.addAttribute(ctx, "gotconn.wasidle", info.WasIdle)
			t.addAttribute(ctx, "gotconn.idletime", info.IdleTime)
		},
		PutIdleConn: func(err error) {
			t.addAttribute(ctx, "putidleconn.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "putidleconn.error", err)
		},
		GotFirstResponseByte: func() {
			t.addAttribute(ctx, "gotfirstresponsebyte.time", time.Now().Format(time.RFC3339Nano))
		},
		Got100Continue: func() {
			t.addAttribute(ctx, "got100continue.time", time.Now().Format(time.RFC3339Nano))
		},
		Got1xxResponse: nil,
		DNSStart: func(dnsStartInfo httptrace.DNSStartInfo) {
			t.addAttribute(ctx, "dnsstart.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "dnsstart.host", dnsStartInfo.Host)
		},
		DNSDone: func(dnsDoneInfo httptrace.DNSDoneInfo) {
			t.addAttribute(ctx, "dnsdone.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "dnsdone.addresses", dnsDoneInfo.Addrs)
			t.addAttribute(ctx, "dnsdone.coalesced", dnsDoneInfo.Coalesced)
			t.addAttribute(ctx, "dnsdone.error", dnsDoneInfo.Err)
		},
		ConnectStart: func(network, addr string) {
			t.addAttribute(ctx, "connectstart.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "connectstart.network", network)
			t.addAttribute(ctx, "connectstart.address", addr)
		},
		ConnectDone: func(network, addr string, err error) {
			t.addAttribute(ctx, "connectdone.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "connectdone.network", network)
			t.addAttribute(ctx, "connectdone.address", addr)
			t.addAttribute(ctx, "connectdone.error", err)
		},
		TLSHandshakeStart: func() {
			t.addAttribute(ctx, "tlshandshakestart.time", time.Now().Format(time.RFC3339Nano))
		},
		TLSHandshakeDone: func(connectionState tls.ConnectionState, err error) {
			t.addAttribute(ctx, "tlshandshakedone.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "tlshandshakedone.complete", connectionState.HandshakeComplete)

			cipherSuiteName := t.getCipherSuiteName(connectionState.CipherSuite)
			t.addAttribute(ctx, "tlshandshakedone.ciphersuitename", cipherSuiteName)
			t.addAttribute(ctx, "tlshandshakedone.didresume", connectionState.DidResume)

			versionName := tls.VersionName(connectionState.Version)
			t.addAttribute(ctx, "tlshandshakedone.version", versionName)

			t.addAttribute(ctx, "tlshandshakedone.error", err)
		},
		WroteHeaderField: nil,
		WroteHeaders: func() {
			t.addAttribute(ctx, "wroteheaders.time", time.Now().Format(time.RFC3339Nano))
		},
		Wait100Continue: func() {
			t.addAttribute(ctx, "wait100continue.time", time.Now().Format(time.RFC3339Nano))
		},
		WroteRequest: func(wroteRequestInfo httptrace.WroteRequestInfo) {
			t.addAttribute(ctx, "wroterequest.time", time.Now().Format(time.RFC3339Nano))
			t.addAttribute(ctx, "wroterequest.error", wroteRequestInfo.Err)
		},
	}
	return trace
}

func (t *TraceInjectingRoundTripper) getErrString(err error) string {
	errString := "null"
	if err != nil {
		errString = fmt.Sprintf("%q", err)
	}
	return errString
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
