package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

func TestNamedForwardRequestIDHeaderRule(t *testing.T) {
	ht := NewForwardRequestIDHeader()

	rr := httptest.NewRecorder()

	clientReq, err := http.NewRequest("POST", "http://localhost", nil)
	require.NoError(t, err)

	originReq, err := http.NewRequest("POST", "http://localhost", nil)
	assert.Nil(t, err)
	originReq.Header.Set("X-Test-1", "test1")
	// Forge a request id in context
	// Create request ID
	reqID := "fake-request-id"
	// Save request id in context
	reqCtx := context.WithValue(originReq.Context(), middleware.RequestIDKey, reqID)
	// Override context in request
	originReq = originReq.WithContext(reqCtx)

	updatedClientReq, _ := ht.OnOriginRequest(clientReq, &requestContext{
		logger:         zap.NewNop(),
		responseWriter: rr,
		request:        originReq,
		operation:      &operationContext{},
	})

	assert.Empty(t, updatedClientReq.Header.Get("X-Test-1"))
	assert.Empty(t, updatedClientReq.Header.Get(middleware.RequestIDHeader))

	// Check that original request have been updated
	assert.Equal(t, reqID, originReq.Header.Get(middleware.RequestIDHeader))
}
