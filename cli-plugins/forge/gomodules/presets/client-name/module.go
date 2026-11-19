// Package clientname rejects requests that do not say which client sent them.
package clientname

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const (
	moduleID      = "clientName"
	defaultHeader = "GraphQL-Client-Name"
)

func init() {
	core.RegisterModule(&ClientName{})
}

// ClientName is configured under `modules.clientName` in the router config.
type ClientName struct {
	// Header is the request header that must carry the client name.
	Header string `mapstructure:"header"`
}

func (m *ClientName) Provision(_ *core.ModuleContext) error {
	if m.Header == "" {
		m.Header = defaultHeader
	}
	return nil
}

func (m *ClientName) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	if ctx.Request().Header.Get(m.Header) != "" {
		next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
		return
	}

	writer := ctx.ResponseWriter()
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(writer).Encode(map[string]any{
		"errors": []map[string]string{
			{"message": fmt.Sprintf("Missing required header %s. Send the name of your client in it.", m.Header)},
		},
	})
}

func (m *ClientName) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 2,
		New: func() core.Module {
			return &ClientName{}
		},
	}
}

var (
	_ core.RouterOnRequestHandler = (*ClientName)(nil)
	_ core.Provisioner            = (*ClientName)(nil)
)
