package core

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type deferAdvisorContextKey struct{}

func TestNewDeferAdvisorLoopbackRequestSanitizesCallerControls(t *testing.T) {
	t.Parallel()

	parent := httptest.NewRequest(
		http.MethodPost,
		"https://router.example/graphql?keep=one&keep=two&wg_trace=user&wg_skip_loader=1&wg_include_query_plan=1&X-Amz-Credential=credential&X-Amz-Signature=secret&X-Goog-Signature=secret&oauth_signature=secret&Signature=secret&sig=secret",
		nil,
	)
	parent.Host = "graph.example"
	parent.RemoteAddr = "192.0.2.1:1234"
	parent.Proto = "HTTP/2.0"
	parent.ProtoMajor = 2
	parent.ProtoMinor = 0
	parent.TLS = &tls.ConnectionState{ServerName: "router.example"}
	parent.Header.Set("Authorization", "Bearer user")
	parent.Header.Set("Cookie", "session=abc")
	parent.Header.Set("X-WG-Token", "signed-graph-token")
	parent.Header.Set("X-Keep", "kept")
	parent.Header.Set("Accept", "multipart/mixed")
	parent.Header.Set("Accept-Encoding", "gzip")
	parent.Header.Set("Content-Encoding", "br")
	parent.Header.Set("Content-Type", "text/plain")
	parent.Header.Set("Content-Length", "999")
	parent.Header.Set(DeferAdvisorHeader, "true")
	parent.Header.Set(DeferAdvisorRunsHeader, "9")
	parent.Header.Set(DeferAdvisorSkipValidationHeader, "true")
	parent.Header.Set(RequestTraceHeader, "user-control")
	parent.Header.Set("X-WG-Include-Query-Plan", "user-control")
	parent.Header.Set("X-WG-Skip-Loader", "user-control")
	parent.Header.Set("Connection", "keep-alive, X-Remove-Me")
	parent.Header.Set("X-Remove-Me", "secret")
	parent.Header.Set("Proxy-Connection", "keep-alive")
	parent.Header.Set("Keep-Alive", "timeout=5")
	parent.Header.Set("TE", "trailers")
	parent.Header.Set("Trailer", "X-Trailer")
	parent.Header.Set("Transfer-Encoding", "chunked")
	parent.Header.Set("Upgrade", "websocket")
	parent.Header.Set("Digest", "sha-256=stale")
	parent.Header.Set("Repr-Digest", "sha-256=:stale:")
	parent.Header.Set("Content-Digest", "sha-256=:stale:")
	parent.Header.Set("Content-MD5", "stale")
	parent.Header.Set("Signature", "stale")
	parent.Header.Set("Signature-Input", "stale")
	parent.Header.Set("X-Amz-Content-Sha256", "stale")
	parent.Header.Set("DPoP", "stale")

	body := []byte("{\"query\":\"query Read { value }\",\"operationName\":\"Read\"}")
	request, err := newDeferAdvisorLoopbackRequest(parent, body)
	require.NoError(t, err)

	assert.Equal(t, http.MethodPost, request.Method)
	assert.Equal(t, "https://router.example/graphql?keep=one&keep=two", request.URL.String())
	assert.Equal(t, "graph.example", request.Host)
	assert.Equal(t, "192.0.2.1:1234", request.RemoteAddr)
	assert.Equal(t, "HTTP/2.0", request.Proto)
	assert.Equal(t, 2, request.ProtoMajor)
	assert.Equal(t, 0, request.ProtoMinor)
	assert.Equal(t, "/graphql?keep=one&keep=two", request.RequestURI)
	assert.Same(t, parent.TLS, request.TLS)
	assert.Equal(t, int64(len(body)), request.ContentLength)
	actualBody, err := io.ReadAll(request.Body)
	require.NoError(t, err)
	assert.Equal(t, body, actualBody)

	assert.Equal(t, "Bearer user", request.Header.Get("Authorization"))
	assert.Equal(t, "session=abc", request.Header.Get("Cookie"))
	assert.Empty(t, request.Header.Get("X-WG-Token"))
	assert.True(t, hasInternalRequestTracingAuthorization(request.Context()))
	assert.Equal(t, "kept", request.Header.Get("X-Keep"))
	assert.Equal(t, "application/json", request.Header.Get("Accept"))
	assert.Equal(t, "application/json", request.Header.Get("Content-Type"))
	for _, header := range []string{
		"Accept-Encoding",
		"Content-Encoding",
		"Content-Length",
		DeferAdvisorHeader,
		DeferAdvisorRunsHeader,
		DeferAdvisorSkipValidationHeader,
		RequestTraceHeader,
		"X-WG-Include-Query-Plan",
		"X-WG-Skip-Loader",
		"Connection",
		"X-Remove-Me",
		"Proxy-Connection",
		"Keep-Alive",
		"TE",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade",
		"Digest",
		"Repr-Digest",
		"Content-Digest",
		"Content-MD5",
		"Signature",
		"Signature-Input",
		"X-Amz-Content-Sha256",
		"DPoP",
	} {
		assert.Empty(t, request.Header.Values(header), header)
	}

	assert.Equal(t, "user-control", parent.Header.Get(RequestTraceHeader))
	assert.Equal(t, "signed-graph-token", parent.Header.Get("X-WG-Token"))
	request.Header.Set("X-Keep", "changed")
	assert.Equal(t, "kept", parent.Header.Get("X-Keep"))
	assert.Equal(t, "keep=one&keep=two&wg_trace=user&wg_skip_loader=1&wg_include_query_plan=1&X-Amz-Credential=credential&X-Amz-Signature=secret&X-Goog-Signature=secret&oauth_signature=secret&Signature=secret&sig=secret", parent.URL.RawQuery)
}

func TestNewDeferAdvisorLoopbackRequestPreservesCancellationAndIsolatesContextValues(t *testing.T) {
	t.Parallel()

	parent := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", nil)
	routeContext := chi.NewRouteContext()
	ctx, cancel := context.WithCancel(parent.Context())
	ctx = context.WithValue(ctx, chi.RouteCtxKey, routeContext)
	ctx = context.WithValue(ctx, deferAdvisorContextKey{}, "preserved")
	ctx = context.WithValue(ctx, middleware.RequestIDKey, "request-id")
	parent = parent.WithContext(ctx)

	request, err := newDeferAdvisorLoopbackRequest(parent, []byte("{}"))
	require.NoError(t, err)
	assert.Nil(t, request.Context().Value(chi.RouteCtxKey))
	assert.Nil(t, request.Context().Value(deferAdvisorContextKey{}))
	assert.Equal(t, "request-id", request.Context().Value(middleware.RequestIDKey))
	assert.True(t, hasInternalRequestTracingAuthorization(request.Context()))

	cancel()
	require.ErrorIs(t, request.Context().Err(), context.Canceled)
}

func TestNewDeferAdvisorLoopbackRequestAllowsOnlyReplaySafeAuthorization(t *testing.T) {
	t.Parallel()

	for _, authorization := range []string{
		"AWS4-HMAC-SHA256 Credential=example",
		"AWS4-HMAC-SHA256\tCredential=example",
		"Signature keyId=\"example\"",
		"HMAC example",
		"DPoP access-token",
		"Digest username=\"example\"",
		"OAuth oauth_consumer_key=\"example\"",
		"Hawk id=\"example\"",
		"MAC id=\"example\"",
		"Custom token",
	} {
		parent := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", nil)
		parent.Header.Set("Authorization", authorization)

		request, err := newDeferAdvisorLoopbackRequest(parent, []byte("{}"))
		require.NoError(t, err)
		assert.Empty(t, request.Header.Get("Authorization"))
	}

	for _, authorization := range []string{"Bearer token", "Basic dXNlcjpwYXNz"} {
		parent := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", nil)
		parent.Header.Set("Authorization", authorization)

		request, err := newDeferAdvisorLoopbackRequest(parent, []byte("{}"))
		require.NoError(t, err)
		assert.Equal(t, authorization, request.Header.Get("Authorization"))
	}
}
