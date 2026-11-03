package module_meter_providers

import (
	"net/http"

	"go.opentelemetry.io/otel/metric"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "moduleMeterProvidersModule"

// ModuleMeterProvidersModule counts the requests it sees on each of the router's meter providers.
type ModuleMeterProvidersModule struct {
	// OnProvision is told how many meter providers the router gave the module.
	OnProvision func(providers int)

	requests []metric.Int64Counter
}

func (m *ModuleMeterProvidersModule) Provision(ctx *core.ModuleContext) error {
	for _, provider := range ctx.MeterProviders {
		requests, err := provider.Meter("module-meter-providers").Int64Counter("module_meter_providers.requests")
		if err != nil {
			return err
		}
		m.requests = append(m.requests, requests)
	}
	if m.OnProvision != nil {
		m.OnProvision(len(ctx.MeterProviders))
	}
	return nil
}

func (m *ModuleMeterProvidersModule) Middleware(ctx core.RequestContext, next http.Handler) {
	for _, requests := range m.requests {
		requests.Add(ctx.Request().Context(), 1)
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *ModuleMeterProvidersModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &ModuleMeterProvidersModule{}
		},
	}
}

// Interface guard
var (
	_ core.Provisioner             = (*ModuleMeterProvidersModule)(nil)
	_ core.RouterMiddlewareHandler = (*ModuleMeterProvidersModule)(nil)
)
