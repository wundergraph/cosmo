package custom_trace_propagator

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
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

type ctxKeyCustomPropagator string

const ctxKey = "CustomPropagator"

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

	switch v := ctx.Value(ctxKeyCustomPropagator(ctxKey)).(type) {
	case *info:
		i = *v
	default:
	}

	i.injectCalled = c.InjectCalled
	carrier.Set(ctxKey, i.String())
}

func (c *customPropagator) Extract(ctx context.Context, carrier propagation.TextMapCarrier) context.Context {
	c.ExtractCalled++

	cStr := carrier.Get(ctxKey)

	i := parse(cStr)
	if i == nil {
		return ctx
	}

	// create a fantasy trace ID for testing purposes
	sID := "acde00000000000000000000eeeeffff"

	tid, err := trace.TraceIDFromHex(sID)
	if err != nil {
		return ctx
	}

	sc := trace.SpanFromContext(ctx).SpanContext()

	ssc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    tid,
		SpanID:     sc.SpanID(),
		TraceFlags: sc.TraceFlags(),
		TraceState: sc.TraceState(),
		Remote:     sc.IsRemote(),
	})

	i.extractCalled = c.ExtractCalled
	ctx = context.WithValue(ctx, ctxKeyCustomPropagator(ctxKey), i)

	return trace.ContextWithSpanContext(ctx, ssc)
}

func (c *customPropagator) Fields() []string {
	return []string{ctxKey}
}

var _ propagation.TextMapPropagator = (*customPropagator)(nil)
