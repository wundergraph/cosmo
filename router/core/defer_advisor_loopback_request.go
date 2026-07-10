package core

import (
	"bytes"
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type deferAdvisorLoopbackParentContext struct {
	context.Context
}

func (c deferAdvisorLoopbackParentContext) Value(key any) any {
	switch key {
	case http.ServerContextKey, http.LocalAddrContextKey, middleware.RequestIDKey:
		return c.Context.Value(key)
	default:
		return nil
	}
}

func newDeferAdvisorLoopbackRequest(parent *http.Request, body []byte) (*http.Request, error) {
	requestURL := *parent.URL
	query := requestURL.Query()
	for key := range query {
		if stripDeferAdvisorLoopbackQueryParameter(key) {
			query.Del(key)
		}
	}
	requestURL.RawQuery = query.Encode()
	requestURL.ForceQuery = false

	// Re-entry starts a new request scope. Preserve cancellation and a small set
	// of immutable server/logging values, but do not share arbitrary mutable
	// middleware values between concurrent profiling requests.
	isolatedParent := deferAdvisorLoopbackParentContext{Context: parent.Context()}
	ctx := context.WithValue(isolatedParent, chi.RouteCtxKey, nil)
	ctx = withInternalRequestTracingAuthorization(ctx)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Host = parent.Host
	request.RemoteAddr = parent.RemoteAddr
	request.TLS = parent.TLS
	request.Proto = parent.Proto
	request.ProtoMajor = parent.ProtoMajor
	request.ProtoMinor = parent.ProtoMinor
	request.RequestURI = request.URL.RequestURI()
	request.Header = parent.Header.Clone()
	removeDeferAdvisorHopByHopHeaders(request.Header)

	for _, header := range []string{
		"Accept-Encoding",
		"Content-Encoding",
		"Content-Length",
		"Content-Digest",
		"Content-MD5",
		"Digest",
		"DPoP",
		"Repr-Digest",
		"Signature",
		"Signature-Input",
		"X-Amz-Content-Sha256",
		"X-Goog-Content-Sha256",
		DeferAdvisorHeader,
		DeferAdvisorRunsHeader,
		DeferAdvisorSkipValidationHeader,
		RequestTraceHeader,
		"X-WG-Token",
		"X-WG-Include-Query-Plan",
		"X-WG-Skip-Loader",
	} {
		request.Header.Del(header)
	}
	if !authorizationIsReplaySafe(request.Header.Get("Authorization")) {
		request.Header.Del("Authorization")
	}
	request.Header.Set("Accept", jsonContent)
	request.Header.Set("Content-Type", jsonContent)
	request.ContentLength = int64(len(body))
	return request, nil
}

func stripDeferAdvisorLoopbackQueryParameter(key string) bool {
	lowerKey := strings.ToLower(key)
	switch lowerKey {
	case RequestTraceQueryParameter,
		"wg_skip_loader",
		"wg_include_query_plan",
		"dpop",
		"key-pair-id",
		"policy",
		"sig",
		"signature":
		return true
	default:
		return strings.HasPrefix(lowerKey, "oauth_") ||
			strings.HasPrefix(lowerKey, "x-amz-") ||
			strings.HasPrefix(lowerKey, "x-goog-")
	}
}

func authorizationIsReplaySafe(value string) bool {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return true
	}
	switch strings.ToLower(fields[0]) {
	case "basic", "bearer":
		return true
	default:
		return false
	}
}

func removeDeferAdvisorHopByHopHeaders(header http.Header) {
	for _, connection := range header.Values("Connection") {
		for token := range strings.SplitSeq(connection, ",") {
			header.Del(strings.TrimSpace(token))
		}
	}
	for _, name := range []string{
		"Connection",
		"Proxy-Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"TE",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade",
	} {
		header.Del(name)
	}
}
