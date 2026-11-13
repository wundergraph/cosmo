package custom_metrics

import (
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"

	"github.com/wundergraph/cosmo/router/core"
)

const (
	myModuleID = "customMetricsModule"

	// MeterName is the instrumentation scope of the module's instruments.
	MeterName = "custom-metrics-module"
	// CounterName is exported as "module_subgraph_requests_total" in Prometheus.
	CounterName = "module.subgraph.requests"

	tenantHeader = "X-Tenant"
	tenantKey    = "tenant"
)

// CustomMetricsModule counts subgraph requests per subgraph and tenant. The
// tenant is read from a request header in Middleware, stored on the request
// context, and read back for every origin request.
type CustomMetricsModule struct {
	promCounter otelmetric.Int64Counter
	otlpCounter otelmetric.Int64Counter
}

func (m *CustomMetricsModule) Provision(ctx *core.ModuleContext) error {
	var err error
	m.promCounter, err = newCounter(ctx.PrometheusMeterProvider)
	if err != nil {
		return err
	}
	m.otlpCounter, err = newCounter(ctx.OTLPMeterProvider)
	return err
}

func newCounter(mp otelmetric.MeterProvider) (otelmetric.Int64Counter, error) {
	return mp.Meter(MeterName).Int64Counter(CounterName,
		otelmetric.WithDescription("Subgraph requests per tenant"))
}

func (m *CustomMetricsModule) Middleware(ctx core.RequestContext, next http.Handler) {
	if tenant := ctx.Request().Header.Get(tenantHeader); tenant != "" {
		ctx.Set(tenantKey, tenant)
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *CustomMetricsModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	tenant := ctx.GetString(tenantKey)
	sg := ctx.ActiveSubgraph(req)
	if tenant == "" || sg == nil {
		return req, nil
	}

	opt := otelmetric.WithAttributeSet(attribute.NewSet(
		attribute.String("subgraph", sg.Name),
		attribute.String("tenant", tenant),
	))
	m.promCounter.Add(req.Context(), 1, opt)
	m.otlpCounter.Add(req.Context(), 1, opt)

	return req, nil
}

func (m *CustomMetricsModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &CustomMetricsModule{}
		},
	}
}

// Interface guard
var (
	_ core.Provisioner             = (*CustomMetricsModule)(nil)
	_ core.RouterMiddlewareHandler = (*CustomMetricsModule)(nil)
	_ core.EnginePreOriginHandler  = (*CustomMetricsModule)(nil)
)
