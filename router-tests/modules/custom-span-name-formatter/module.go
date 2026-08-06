package custom_span_name_formatter

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

// Module is a test fixture that prepends Prefix to whatever the wrapped
// formatter returns. Returning the receiver from New preserves the configured
// Prefix without round-tripping through mapstructure config. The chain test
// registers two instances and needs distinct ID and Priority values.
type Module struct {
	Prefix   string
	Priority int
	ID       string
}

func (m *Module) WrapSpanNameFormatter(next core.SpanNameFormatterFunc) core.SpanNameFormatterFunc {
	return func(r *http.Request) string {
		return m.Prefix + next(r)
	}
}

func (m *Module) Module() core.ModuleInfo {
	id := m.ID
	if id == "" {
		id = "customSpanNameFormatter"
	}
	priority := m.Priority
	if priority == 0 {
		priority = 1
	}
	return core.ModuleInfo{
		ID:       core.ModuleID(id),
		Priority: priority,
		New:      func() core.Module { return m },
	}
}

var (
	_ core.Module                    = (*Module)(nil)
	_ core.SpanNameFormatterProvider = (*Module)(nil)
)
