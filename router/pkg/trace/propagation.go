package trace

import (
	"fmt"
	datadog "github.com/tonglil/opentelemetry-go-datadog-propagator"
	"go.opentelemetry.io/contrib/propagators/b3"
	"go.opentelemetry.io/contrib/propagators/jaeger"
	"go.opentelemetry.io/otel/propagation"
)

func BuildPropagators(propagators ...Propagator) ([]propagation.TextMapPropagator, error) {
	var allPropagators []propagation.TextMapPropagator
	for _, p := range propagators {
		switch p {
		case PropagatorTraceContext:
			allPropagators = append(allPropagators, propagation.TraceContext{})
		case PropagatorB3:
			allPropagators = append(allPropagators, b3.New(b3.WithInjectEncoding(b3.B3MultipleHeader|b3.B3SingleHeader)))
		case PropagatorJaeger:
			allPropagators = append(allPropagators, jaeger.Jaeger{})
		case PropagatorDatadog:
			allPropagators = append(allPropagators, datadog.Propagator{})
		case PropagatorBaggage:
			allPropagators = append(allPropagators, propagation.Baggage{})
		default:
			return nil, fmt.Errorf("unknown trace propagator: %s", p)
		}
	}
	return allPropagators, nil
}
