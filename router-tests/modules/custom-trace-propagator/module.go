package custom_trace_propagator

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/core"
	"go.opentelemetry.io/otel/propagation"
	"go.uber.org/zap"
)

func init() {
	// Register your module here
	core.RegisterModule(&CustomTracePropagatorModule{})
}

const myModuleID = "tracePropagatorModule"

// CustomTracePropagatorModule is a simple module that provides a custom trace propagator for the router
type CustomTracePropagatorModule struct {
	Value      uint64 `mapstructure:"value"`
	Propagator *customPropagator
	Logger     *zap.Logger
}

func (m *CustomTracePropagatorModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &CustomTracePropagatorModule{
				Propagator: &customPropagator{},
			}
		},
	}
}

const customPropagatorKey = "customPropagator"

func (m *CustomTracePropagatorModule) TracePropagators() []propagation.TextMapPropagator {
	return []propagation.TextMapPropagator{m.Propagator}
}

type customPropagator struct {
	InjectCalled  int
	ExtractCalled int
}

type info struct {
	injectCalled  int
	extractCalled int
}

func parse(s string) *info {
	var i info

	_, err := fmt.Sscanf(s, "injectCalled:%d, extractCalled:%d", &i.injectCalled, &i.extractCalled)
	if err != nil {
		return nil
	}
	return &i
}

func (i *info) String() string {
	return fmt.Sprintf("injectCalled:%d, extractCalled:%d", i.injectCalled, i.extractCalled)
}

func (c *customPropagator) Inject(ctx context.Context, carrier propagation.TextMapCarrier) {
	c.InjectCalled++
	var i info

	switch v := ctx.Value(customPropagatorKey).(type) {
	case *info:
		i = *v
	default:
	}

	i.injectCalled = c.InjectCalled
	carrier.Set(customPropagatorKey, i.String())
}

func (c *customPropagator) Extract(ctx context.Context, carrier propagation.TextMapCarrier) context.Context {
	c.ExtractCalled++

	cStr := carrier.Get(customPropagatorKey)

	i := parse(cStr)
	if i == nil {
		return ctx
	}

	i.extractCalled = c.ExtractCalled
	return context.WithValue(ctx, customPropagatorKey, i)
}

func (c *customPropagator) Fields() []string {
	return []string{customPropagatorKey}
}

var _ propagation.TextMapPropagator = (*customPropagator)(nil)
