package core

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

type deferAdvisorCountingReader struct {
	reads atomic.Int64
}

type deferAdvisorBlockingBody struct {
	started     chan struct{}
	closed      chan struct{}
	startedOnce sync.Once
	closedOnce  sync.Once
}

func newDeferAdvisorBlockingBody() *deferAdvisorBlockingBody {
	return &deferAdvisorBlockingBody{
		started: make(chan struct{}),
		closed:  make(chan struct{}),
	}
}

func (b *deferAdvisorBlockingBody) Read([]byte) (int, error) {
	b.startedOnce.Do(func() { close(b.started) })
	<-b.closed
	return 0, io.ErrClosedPipe
}

func (b *deferAdvisorBlockingBody) Close() error {
	b.closedOnce.Do(func() { close(b.closed) })
	return nil
}

func (r *deferAdvisorCountingReader) Read([]byte) (int, error) {
	r.reads.Add(1)
	return 0, io.EOF
}

func TestDeferAdvisorMiddlewareRejectsUnsafeRequestsBeforeLoopback(t *testing.T) {
	t.Parallel()

	oversized := bytes.Repeat([]byte("x"), deferAdvisorMaxRequestBodyBytes+1)
	tests := []struct {
		name         string
		method       string
		contentType  string
		runs         string
		body         []byte
		streamedBody bool
		status       int
		message      string
	}{
		{
			name:        "method",
			method:      http.MethodGet,
			contentType: "application/json",
			body:        []byte("{\"query\":\"query { value }\"}"),
			status:      http.StatusMethodNotAllowed,
			message:     "defer advisor only supports POST requests",
		},
		{
			name:        "content type",
			method:      http.MethodPost,
			contentType: "text/plain",
			body:        []byte("{\"query\":\"query { value }\"}"),
			status:      http.StatusUnsupportedMediaType,
			message:     "defer advisor requires Content-Type application/json",
		},
		{
			name:        "runs",
			method:      http.MethodPost,
			contentType: "application/json",
			runs:        "11",
			body:        []byte("{\"query\":\"query { value }\"}"),
			status:      http.StatusBadRequest,
			message:     "X-WG-Defer-Advisor-Runs must be an integer between 1 and 10",
		},
		{
			name:        "mutation",
			method:      http.MethodPost,
			contentType: "application/json",
			body:        []byte("{\"query\":\"mutation Change { change }\",\"operationName\":\"Change\"}"),
			status:      http.StatusBadRequest,
			message:     "defer advisor only supports query operations; selected operation is mutation",
		},
		{
			name:        "subscription",
			method:      http.MethodPost,
			contentType: "application/json",
			body:        []byte("{\"query\":\"subscription Watch { watch }\",\"operationName\":\"Watch\"}"),
			status:      http.StatusBadRequest,
			message:     "defer advisor only supports query operations; selected operation is subscription",
		},
		{
			name:        "ambiguous operation",
			method:      http.MethodPost,
			contentType: "application/json",
			body:        []byte("{\"query\":\"query One { one } query Two { two }\"}"),
			status:      http.StatusBadRequest,
			message:     "operation name is required when multiple operations are defined",
		},
		{
			name:        "mixed case APQ",
			method:      http.MethodPost,
			contentType: "application/json",
			body:        []byte("{\"query\":\"query { value }\",\"extensions\":{\"PersistedQuery\":{\"version\":1,\"sha256Hash\":\"abc\"}}}"),
			status:      http.StatusBadRequest,
			message:     "defer advisor does not support persistedQuery extensions",
		},
		{
			name:        "declared oversized body",
			method:      http.MethodPost,
			contentType: "application/json",
			body:        oversized,
			status:      http.StatusRequestEntityTooLarge,
			message:     "defer advisor request body exceeds the 1048576 byte limit",
		},
		{
			name:         "streamed oversized body",
			method:       http.MethodPost,
			contentType:  "application/json",
			body:         oversized,
			streamedBody: true,
			status:       http.StatusRequestEntityTooLarge,
			message:      "defer advisor request body exceeds the 1048576 byte limit",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			var targetCalls atomic.Int64
			advisor := NewDeferAdvisor(DeferAdvisorOptions{
				EnableRequestTracing: true,
				DevelopmentMode:      true,
				Logger:               zap.NewNop(),
			})
			advisor.SetTarget(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				targetCalls.Add(1)
			}))
			var nextCalls atomic.Int64
			handler := advisor.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				nextCalls.Add(1)
			}))
			request := httptest.NewRequest(test.method, "http://router.example/graphql", bytes.NewReader(test.body))
			request.Header.Set(DeferAdvisorHeader, "true")
			request.Header.Set("Content-Type", test.contentType)
			if test.runs != "" {
				request.Header.Set(DeferAdvisorRunsHeader, test.runs)
			}
			if test.streamedBody {
				request.ContentLength = -1
			}
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			assert.Equal(t, test.status, response.Code)
			assert.Equal(t, deferAdvisorErrorBody(test.message), response.Body.String())
			assert.Zero(t, targetCalls.Load())
			assert.Zero(t, nextCalls.Load())
			if test.method == http.MethodGet {
				assert.Equal(t, http.MethodPost, response.Header().Get("Allow"))
			}
		})
	}
}

func TestDeferAdvisorMiddlewareUsesRequestTracingAuthorization(t *testing.T) {
	t.Parallel()

	routerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	attackerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	validToken := signedRequestTracingToken(t, routerKey)
	invalidToken := signedRequestTracingToken(t, attackerKey)

	tests := []struct {
		name        string
		options     DeferAdvisorOptions
		token       string
		status      int
		targetCalls int64
	}{
		{
			name:    "tracing disabled",
			options: DeferAdvisorOptions{DevelopmentMode: true, Logger: zap.NewNop()},
			status:  http.StatusForbidden,
		},
		{
			name:    "production missing token",
			options: DeferAdvisorOptions{EnableRequestTracing: true, RouterPublicKey: &routerKey.PublicKey, Logger: zap.NewNop()},
			status:  http.StatusForbidden,
		},
		{
			name:    "production invalid token",
			options: DeferAdvisorOptions{EnableRequestTracing: true, RouterPublicKey: &routerKey.PublicKey, Logger: zap.NewNop()},
			token:   invalidToken,
			status:  http.StatusForbidden,
		},
		{
			name:        "production signed token",
			options:     DeferAdvisorOptions{EnableRequestTracing: true, RouterPublicKey: &routerKey.PublicKey, Logger: zap.NewNop()},
			token:       validToken,
			status:      http.StatusBadGateway,
			targetCalls: 1,
		},
		{
			name:        "development mode",
			options:     DeferAdvisorOptions{EnableRequestTracing: true, DevelopmentMode: true, Logger: zap.NewNop()},
			status:      http.StatusBadGateway,
			targetCalls: 1,
		},
		{
			name:        "forced unauthenticated tracing",
			options:     DeferAdvisorOptions{EnableRequestTracing: true, ForceUnauthenticatedRequestTracing: true, Logger: zap.NewNop()},
			status:      http.StatusBadGateway,
			targetCalls: 1,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			var targetCalls atomic.Int64
			advisor := NewDeferAdvisor(test.options)
			advisor.SetTarget(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				targetCalls.Add(1)
				assert.Empty(t, r.Header.Get("X-WG-Token"))
				assert.Empty(t, r.Header.Get(DeferAdvisorHeader))
				assert.Equal(t, "true", r.Header.Get("X-WG-Include-Query-Plan"))
				assert.Equal(t, "true", r.Header.Get("X-WG-Skip-Loader"))
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte("{\"data\":null,\"extensions\":{}}"))
			}))
			request := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", bytes.NewBufferString("{\"query\":\"query { value }\"}"))
			request.Header.Set(DeferAdvisorHeader, "true")
			request.Header.Set("Content-Type", "application/json")
			if test.token != "" {
				request.Header.Set("X-WG-Token", test.token)
			}
			response := httptest.NewRecorder()

			advisor.Middleware(http.NotFoundHandler()).ServeHTTP(response, request)

			assert.Equal(t, test.status, response.Code)
			assert.Equal(t, test.targetCalls, targetCalls.Load())
			if test.targetCalls == 0 {
				assert.Equal(t, deferAdvisorErrorBody("defer advisor is not authorized for request tracing"), response.Body.String())
			}
		})
	}
}

func TestDeferAdvisorMiddlewarePassesThroughRequestsWithoutAdvisorHeader(t *testing.T) {
	t.Parallel()

	var nextCalls atomic.Int64
	advisor := NewDeferAdvisor(DeferAdvisorOptions{Logger: zap.NewNop()})
	handler := advisor.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		nextCalls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://router.example/graphql", nil))

	assert.Equal(t, http.StatusNoContent, response.Code)
	assert.Equal(t, int64(1), nextCalls.Load())
}

func TestDeferAdvisorMiddlewareRejectsAnUninitializedTarget(t *testing.T) {
	t.Parallel()

	advisor := NewDeferAdvisor(DeferAdvisorOptions{
		EnableRequestTracing: true,
		DevelopmentMode:      true,
		Logger:               zap.NewNop(),
	})
	request := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", bytes.NewBufferString("{\"query\":\"query { value }\"}"))
	request.Header.Set(DeferAdvisorHeader, "true")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	advisor.Middleware(http.NotFoundHandler()).ServeHTTP(response, request)

	assert.Equal(t, http.StatusInternalServerError, response.Code)
	assert.Equal(t, deferAdvisorErrorBody("defer advisor is not initialized"), response.Body.String())
}

func TestDeferAdvisorMiddlewareLimitsConcurrentAnalyses(t *testing.T) {
	t.Parallel()

	entered := make(chan struct{})
	release := make(chan struct{})
	advisor := NewDeferAdvisor(DeferAdvisorOptions{
		EnableRequestTracing: true,
		DevelopmentMode:      true,
		Logger:               zap.NewNop(),
	})
	advisor.analysisSlots = make(chan struct{}, 1)
	advisor.SetTarget(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case entered <- struct{}{}:
		case <-r.Context().Done():
			return
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":null,"extensions":{"queryPlan":{}}}`))
	}))
	handler := advisor.Middleware(http.NotFoundHandler())
	firstResponse := httptest.NewRecorder()
	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		request := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", bytes.NewBufferString(`{"query":"query { value }"}`))
		request.Header.Set(DeferAdvisorHeader, "true")
		request.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(firstResponse, request)
	}()

	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("first analysis did not enter the loopback")
	}
	secondBody := &deferAdvisorCountingReader{}
	secondRequest := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", secondBody)
	secondRequest.Header.Set(DeferAdvisorHeader, "true")
	secondRequest.Header.Set("Content-Type", "application/json")
	secondResponse := httptest.NewRecorder()

	handler.ServeHTTP(secondResponse, secondRequest)

	assert.Equal(t, http.StatusTooManyRequests, secondResponse.Code)
	assert.Equal(t, deferAdvisorErrorBody("defer advisor has reached its concurrent analysis limit"), secondResponse.Body.String())
	assert.Zero(t, secondBody.reads.Load(), "a saturated advisor must reject before consuming the request body")
	close(release)
	select {
	case <-firstDone:
	case <-time.After(5 * time.Second):
		t.Fatal("first analysis did not finish")
	}
	assert.Equal(t, http.StatusBadGateway, firstResponse.Code)
}

func TestDeferAdvisorAnalysisContextHasATotalDeadline(t *testing.T) {
	t.Parallel()

	var sawDeadline atomic.Bool
	advisor := NewDeferAdvisor(DeferAdvisorOptions{
		EnableRequestTracing: true,
		DevelopmentMode:      true,
		Logger:               zap.NewNop(),
	})
	advisor.SetTarget(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, sawDeadlineValue := r.Context().Deadline()
		sawDeadline.Store(sawDeadlineValue)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":null,"extensions":{"queryPlan":{}}}`))
	}))
	request := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", bytes.NewBufferString(`{"query":"query { value }"}`))
	request.Header.Set(DeferAdvisorHeader, "true")
	request.Header.Set(DeferAdvisorRunsHeader, "2")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	advisor.Middleware(http.NotFoundHandler()).ServeHTTP(response, request)

	assert.Equal(t, http.StatusBadGateway, response.Code)
	assert.True(t, sawDeadline.Load())
}

func TestDeferAdvisorAnalysisDeadlineInterruptsBodyRead(t *testing.T) {
	t.Parallel()

	advisor := NewDeferAdvisor(DeferAdvisorOptions{
		EnableRequestTracing: true,
		DevelopmentMode:      true,
		Logger:               zap.NewNop(),
	})
	advisor.totalTimeout = 25 * time.Millisecond
	advisor.SetTarget(http.NotFoundHandler())
	body := newDeferAdvisorBlockingBody()
	request := httptest.NewRequest(http.MethodPost, "http://router.example/graphql", body)
	request.Header.Set(DeferAdvisorHeader, "true")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	done := make(chan struct{})

	go func() {
		defer close(done)
		advisor.Middleware(http.NotFoundHandler()).ServeHTTP(response, request)
	}()

	select {
	case <-body.started:
	case <-time.After(5 * time.Second):
		t.Fatal("advisor did not start reading the request body")
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("advisor deadline did not interrupt the request body read")
	}

	assert.Equal(t, http.StatusGatewayTimeout, response.Code)
	assert.Equal(t, deferAdvisorErrorBody(context.DeadlineExceeded.Error()), response.Body.String())
	select {
	case <-body.closed:
	default:
		t.Fatal("advisor deadline did not close the request body")
	}
}

func deferAdvisorErrorBody(message string) string {
	return "{\"errors\":[{\"message\":\"" + message + "\"}]}\n"
}
