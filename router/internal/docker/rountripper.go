package docker

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"syscall"
)

// localhostFallbackRoundTripper is an http.RoundTripper that will retry failed
// requests to localhost by rewriting the request to use is targetHost. Only
// requests that fail with ECONNREFUSED will be retried.
type localhostFallbackRoundTripper struct {
	targetHost string
	transport  http.RoundTripper
}

func (*localhostFallbackRoundTripper) pointsToLocalhost(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	ip := net.ParseIP(host)
	if ip != nil {
		return ip.IsLoopback()
	}
	return host == "localhost"
}

func (t *localhostFallbackRoundTripper) rewriteToTargetHost(r *http.Request) (*http.Request, error) {
	var newHost string
	_, port, err := net.SplitHostPort(r.Host)
	if err == nil {
		newHost = t.targetHost + ":" + port
	} else {
		newHost = t.targetHost
	}
	newReq, err := http.NewRequestWithContext(r.Context(), r.Method, fmt.Sprintf("%s://%s%s", r.URL.Scheme, newHost, r.URL.Path), r.Body)
	if err != nil {
		return nil, err
	}
	newReq.Header = r.Header
	return newReq, nil
}

func (t *localhostFallbackRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	// If the request has a body, we need to buffer it, otherwise it will
	// get consumed
	resp, err := t.transport.RoundTrip(r)
	if err != nil && t.pointsToLocalhost(r) && errors.Is(err, syscall.ECONNREFUSED) {
		// Retry the request. If the error was ECONNREFUSED, the body
		// will not have been consumed, so we can send the request again.
		redirected, err := t.rewriteToTargetHost(r)
		if err != nil {
			return nil, fmt.Errorf("error creating redirected request to %s: %w", t.targetHost, err)
		}
		resp2, err2 := t.transport.RoundTrip(redirected)
		if err2 == nil {
			return resp2, nil
		}
	}
	// If the redirect fails, return the original error
	return resp, err
}

// NewLocalhostFallbackRoundTripper returns an http.RoundTripper that will retry requests to localhost that fail
// with ECONNREFUSED by rewriting the request to use host.docker.internal.
func NewLocalhostFallbackRoundTripper(transport http.RoundTripper) http.RoundTripper {
	return &localhostFallbackRoundTripper{
		targetHost: dockerInternalHost,
		transport:  transport,
	}
}
