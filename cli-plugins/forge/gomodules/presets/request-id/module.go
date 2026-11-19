// Package requestid answers every request with exactly one non-empty X-Request-ID header.
package requestid

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const (
	moduleID = "requestId"
	header   = "X-Request-ID"
)

func init() {
	core.RegisterModule(&RequestID{})
}

type RequestID struct{}

// RouterOnRequest keeps the caller's request ID when it sent one and generates one otherwise.
func (m *RequestID) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	id := ctx.Request().Header.Get(header)
	if id == "" {
		id = newRequestID()
	}
	ctx.ResponseWriter().Header().Set(header, id)

	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *RequestID) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &RequestID{}
		},
	}
}

func newRequestID() string {
	bytes := make([]byte, 16)
	// crypto/rand.Read never returns an error on supported platforms.
	_, _ = rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

var _ core.RouterOnRequestHandler = (*RequestID)(nil)
