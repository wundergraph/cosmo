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

func TestForwardRequestID(t *testing.T) {
	ht := NewForwardRequestIDHeader()

	rr := httptest.NewRecorder()

	subgraphReq, err := http.NewRequest("POST", "http://localhost", nil)
	require.NoError(t, err)

	originReq, err := http.NewRequest("POST", "http://localhost", nil)
	assert.Nil(t, err)

	// Create request ID
	reqID := "fake-request-id"

	// Save request id in context
	reqCtx := context.WithValue(originReq.Context(), middleware.RequestIDKey, reqID)

	// Override context in request
	clientReq := originReq.WithContext(reqCtx)

	updatedSubgraphReq, _ := ht.OnOriginRequest(subgraphReq, &requestContext{
		logger:         zap.NewNop(),
		responseWriter: rr,
		request:        clientReq,
		operation:      &operationContext{},
	})

	assert.Equal(t, updatedSubgraphReq.Header.Get(middleware.RequestIDHeader), reqID)
	assert.Empty(t, clientReq.Header.Get(middleware.RequestIDHeader))
}
