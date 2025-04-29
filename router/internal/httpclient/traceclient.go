package httpclient

import (
	"context"
	"crypto/tls"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	otrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"
)

type requestLoggerGetter func(req *http.Request) *zap.Logger

type TraceInjectingRoundTripper struct {
	base             http.RoundTripper
	logHooks         bool
	traceHooks       bool
	attrMap          map[string][]any
	mu               sync.Mutex
	logger           *zap.Logger
	getRequestLogger requestLoggerGetter
}

func NewTraceInjectingRoundTripper(base http.RoundTripper, logHooks bool, traceHooks bool, logger requestLoggerGetter) *TraceInjectingRoundTripper {
	return &TraceInjectingRoundTripper{
		base:             base,
		logHooks:         logHooks,
		traceHooks:       traceHooks,
		attrMap:          make(map[string][]any),
		getRequestLogger: logger,
	}
}

func (t *TraceInjectingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	t.setLogger(req)

	trace := t.getClientTrace(req.Context())

	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	trip, err := t.base.RoundTrip(req)

	return trip, err
}

func (t *TraceInjectingRoundTripper) setLogger(req *http.Request) {
	t.logger = zap.NewNop()
	if t.logHooks {
		t.logger = t.getRequestLogger(req)
	}
}

func (t *TraceInjectingRoundTripper) getClientTrace(context context.Context) *httptrace.ClientTrace {

	trace := &httptrace.ClientTrace{
		GetConn: func(hostPort string) {
			t.trace(time.Now().Format(time.RFC3339Nano), "getconn.time", context, "")
			t.trace(hostPort, "getconn.hostport", context, "")

			t.log(fmt.Sprintf(`hostPort: %q`, hostPort), "GetConn")
		},
		GotConn: func(info httptrace.GotConnInfo) {
			t.trace(time.Now().Format(time.RFC3339Nano), "gotconn.time", context, "")
			t.trace(info.Reused, "gotconn.reused", context, "")
			t.trace(info.Reused, "gotconn.wasidle", context, "")
			t.trace(info.Reused, "gotconn.idletime", context, "")

			t.log(fmt.Sprintf(`reused: %t, wasIdle: %t, idleTime: %q`, info.Reused, info.WasIdle, info.IdleTime), "GotConn")
		},
		PutIdleConn: func(err error) {
			t.trace(time.Now().Format(time.RFC3339Nano), "putidleconn.time", context, "")
			if err != nil {
				t.trace(err, "putidleconn.error", context, "")
			}

			baseString := fmt.Sprintf("error: %s", t.getErrString(err))
			t.log(baseString, "PutIdleConn")
		},
		GotFirstResponseByte: func() {
			t.trace(time.Now().Format(time.RFC3339Nano), "gotfirstresponsebyte.time", context, "")
			t.trace(nil, "GotFirstResponseByte", context, "")

			t.log(true, "PutIdleConn")
		},
		Got100Continue: func() {
			t.trace(time.Now().Format(time.RFC3339Nano), "got100continue.time", context, "")

			t.log(true, "Got100Continue")
		},
		Got1xxResponse: nil,
		DNSStart: func(dnsStartInfo httptrace.DNSStartInfo) {
			t.trace(time.Now().Format(time.RFC3339Nano), "dnsstart.time", context, "")
			t.trace(dnsStartInfo.Host, "", context, otel.DnsQuestionName)

			baseString := fmt.Sprintf(`host: %q`, dnsStartInfo.Host)
			t.log(baseString, "DNSStart")
		},
		DNSDone: func(dnsDoneInfo httptrace.DNSDoneInfo) {
			t.trace(time.Now().Format(time.RFC3339Nano), "dnsdone.time", context, "")
			t.trace(dnsDoneInfo.Addrs, "dnsdone.addresses", context, "")
			t.trace(dnsDoneInfo.Coalesced, "dnsdone.coalesced", context, "")

			if dnsDoneInfo.Err != nil {
				t.trace(dnsDoneInfo.Err, "dnsdone.error", context, "")
			}

			baseString := fmt.Sprintf(`addresses: %q, coalesced: %t, error: %s`, dnsDoneInfo.Addrs, dnsDoneInfo.Coalesced, t.getErrString(dnsDoneInfo.Err))
			t.log(baseString, "DNSDone")
		},
		ConnectStart: func(network, addr string) {
			t.trace(time.Now().Format(time.RFC3339Nano), "connectstart.time", context, "")
			t.trace(network, "connectstart.network", context, "")
			t.trace(addr, "connectstart.address", context, "")

			baseString := fmt.Sprintf(`network: %q, addr: %q`, network, addr)
			t.log(baseString, "ConnectStart")
		},
		ConnectDone: func(network, addr string, err error) {
			t.trace(time.Now().Format(time.RFC3339Nano), "connectdone.time", context, "")
			t.trace(network, "connectdone.network", context, "")
			t.trace(addr, "connectdone.address", context, "")

			if err != nil {
				t.trace(err, "connectdone.error", context, "")
			}

			baseString := fmt.Sprintf(`network: %q, addr: %q, error: %s`, network, addr, t.getErrString(err))
			t.log(baseString, "ConnectDone")
		},
		TLSHandshakeStart: func() {
			t.trace(time.Now().Format(time.RFC3339Nano), "tlshandshakestart.time", context, "")

			t.log(true, "TLSHandshakeStart")
		},
		TLSHandshakeDone: func(connectionState tls.ConnectionState, err error) {
			t.trace(time.Now().Format(time.RFC3339Nano), "tlshandshakedone.time", context, "")
			t.trace(connectionState.HandshakeComplete, "tlshandshakedone.complete", context, "")

			cipherSuiteName := t.getCipherSuiteName(connectionState.CipherSuite)
			t.trace(cipherSuiteName, "", context, otel.TlsCipher)
			t.trace(connectionState.DidResume, "", context, otel.TlsResumed)

			versionName := tls.VersionName(connectionState.Version)
			if strings.HasPrefix(versionName, "TLS ") {
				postfix := strings.TrimPrefix(versionName, "TLS ")
				t.trace(postfix, "", context, otel.TlsProtocolVersion)
			}

			if err != nil {
				t.trace(err, "tlshandshakedone.error", context, "")
			}

			baseString := fmt.Sprintf(
				`complete": %t, cipherSuiteName: %s, didResume: %t, versionName: %s, error: %s`,
				connectionState.HandshakeComplete,
				cipherSuiteName,
				connectionState.DidResume,
				versionName,
				t.getErrString(err),
			)
			t.log(baseString, "TLSHandshakeDone")
		},
		// We are skipping since this runs for individual fields multiple times
		// and we can rely on WroteHeaders instead
		WroteHeaderField: nil,
		WroteHeaders: func() {
			t.trace(time.Now().Format(time.RFC3339Nano), "wroteheaders.time", context, "")
			t.log(true, "WroteHeaders")
		},
		Wait100Continue: func() {
			t.trace(time.Now().Format(time.RFC3339Nano), "wait100continue.time", context, "")
			t.log(true, "Wait100Continue")
		},
		WroteRequest: func(wroteRequestInfo httptrace.WroteRequestInfo) {
			t.trace(time.Now().Format(time.RFC3339Nano), "wroterequest.time", context, "")
			if wroteRequestInfo.Err != nil {
				t.trace(wroteRequestInfo.Err, "wroterequest.error", context, "")
			}

			baseString := fmt.Sprintf(`error: %s`, t.getErrString(wroteRequestInfo.Err))
			t.log(baseString, "WroteRequest")
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

func (t *TraceInjectingRoundTripper) log(value any, operationString string) {
	if !t.logHooks {
		return
	}

	t.logger.Info(fmt.Sprintf("%s: %v", operationString, value))
}

func (t *TraceInjectingRoundTripper) trace(value any, operationString string, ctx context.Context, nameOverride attribute.Key) {
	if !t.traceHooks {
		return
	}

	key := nameOverride
	if key == "" {
		key = otel.GetTransportRequestTraceKey(operationString)
	}

	var keyVal attribute.KeyValue
	switch castedVal := value.(type) {
	case string:
		keyVal = key.String(castedVal)
	case bool:
		keyVal = key.Bool(castedVal)
	}

	span := otrace.SpanFromContext(ctx)
	span.SetAttributes(keyVal)
}
