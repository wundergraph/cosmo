package tracing

import (
	"fmt"
	datadog "github.com/tonglil/opentelemetry-go-datadog-propagator"
	"github.com/wundergraph/cosmo/router-plugin/config"
	"go.opentelemetry.io/contrib/propagators/b3"
	"go.opentelemetry.io/contrib/propagators/jaeger"
	"go.opentelemetry.io/otel/propagation"
)

func buildPropagators(propagators []config.Propagator) ([]propagation.TextMapPropagator, error) {
	var allPropagators []propagation.TextMapPropagator
	for _, p := range propagators {
		switch p {
		case config.PropagatorTraceContext:
			allPropagators = append(allPropagators, propagation.TraceContext{})
		case config.PropagatorB3:
			allPropagators = append(allPropagators, b3.New(b3.WithInjectEncoding(b3.B3MultipleHeader|b3.B3SingleHeader)))
		case config.PropagatorJaeger:
			allPropagators = append(allPropagators, jaeger.Jaeger{})
		case config.PropagatorDatadog:
			allPropagators = append(allPropagators, datadog.Propagator{})
		case config.PropagatorBaggage:
			allPropagators = append(allPropagators, propagation.Baggage{})
		default:
			return nil, fmt.Errorf("unknown trace propagator: %s", p)
		}
	}
	return allPropagators, nil
}
