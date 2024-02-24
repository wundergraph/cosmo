package core

import (
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
)

var (
	_ EnginePreOriginHandler = (*ForwardRequestIDHeader)(nil)
)

type ForwardRequestIDHeader struct {
}

// NewForwardRequestIDHeader will forward the router request id to the subgraph.
func NewForwardRequestIDHeader() *ForwardRequestIDHeader {
	return &ForwardRequestIDHeader{}
}

func (h *ForwardRequestIDHeader) OnOriginRequest(request *http.Request, ctx RequestContext) (*http.Request, *http.Response) {
	// Get initial request id
	reqID := middleware.GetReqID(ctx.Request().Context())

	// Set request id on the outgoing subgraph request
	request.Header.Set(middleware.RequestIDHeader, reqID)

	// Next
	return request, nil
}
