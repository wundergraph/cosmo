package module

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

// The module's settings live under `modules.<moduleID>` in the router config.
const moduleID = "tracing"

func init() {
	core.RegisterModule(&Module{})
}

type Module struct{}

// WrapSpanNameFormatter names the router's HTTP spans. Delegate to next to keep the default name.
// To propagate a tracing convention instead, implement core.TracePropagationProvider.
func (m *Module) WrapSpanNameFormatter(next core.SpanNameFormatterFunc) core.SpanNameFormatterFunc {
	return func(request *http.Request) string {
		return next(request)
	}
}

func (m *Module) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &Module{}
		},
	}
}

var _ core.SpanNameFormatterProvider = (*Module)(nil)
