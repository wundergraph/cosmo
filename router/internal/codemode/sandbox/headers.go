package sandbox

import (
	"net/http"
	"strings"
)

var hopByHopHeaders = map[string]struct{}{
	"connection":          {},
	"keep-alive":          {},
	"proxy-authenticate":  {},
	"proxy-authorization": {},
	"te":                  {},
	"trailer":             {},
	"transfer-encoding":   {},
	"upgrade":             {},
}

func headerAllowList(headers []string) map[string]struct{} {
	allow := make(map[string]struct{}, len(headers))
	for _, h := range headers {
		canonical := strings.ToLower(http.CanonicalHeaderKey(h))
		if _, hop := hopByHopHeaders[canonical]; hop {
			continue
		}
		allow[canonical] = struct{}{}
	}
	return allow
}

func copyAllowedHeaders(dst, src http.Header, allow map[string]struct{}) {
	for name, values := range src {
		canonical := strings.ToLower(http.CanonicalHeaderKey(name))
		if _, hop := hopByHopHeaders[canonical]; hop {
			continue
		}
		if _, ok := allow[canonical]; !ok {
			continue
		}
		for _, value := range values {
			dst.Add(name, value)
		}
	}
}
