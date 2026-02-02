package attributeprocessor

import (
	"context"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

// AttributeTransformer processes a single attribute and returns the modified value.
// Returns (newValue, handled) where handled=true means the attribute was processed
// and subsequent transformers should be skipped for this attribute.
type AttributeTransformer func(kv attribute.KeyValue) (attribute.Value, bool)

// AttributeProcessor is an OpenTelemetry SpanProcessor that applies
// a chain of transformers to span attributes.
type AttributeProcessor struct {
	transformers []AttributeTransformer
}

// NewAttributeProcessorOption returns an OpenTelemetry SDK TracerProviderOption
// that registers the AttributeProcessor as a SpanProcessor.
func NewAttributeProcessorOption(transformers ...AttributeTransformer) trace.TracerProviderOption {
	return trace.WithSpanProcessor(NewAttributeProcessor(transformers...))
}

// NewAttributeProcessor creates a new AttributeProcessor with the given transformers.
// Transformers are applied in order until one returns handled=true.
func NewAttributeProcessor(transformers ...AttributeTransformer) AttributeProcessor {
	return AttributeProcessor{transformers: transformers}
}

// OnStart does nothing.
func (c AttributeProcessor) OnStart(_ context.Context, _ trace.ReadWriteSpan) {
}

// OnEnd applies all transformers to the attributes of the span.
func (c AttributeProcessor) OnEnd(s trace.ReadOnlySpan) {
	// We can't change the attribute slice of the span snapshot in OnEnd, but
	// we can change the attribute value in the underlying array.
	attributes := s.Attributes()
	for i := range attributes {
		for _, transform := range c.transformers {
			if newVal, replace := transform(attributes[i]); replace {
				attributes[i].Value = newVal
				// Right now we do not process the same attribute via two spans
				break
			}
		}
	}
}

// Shutdown does nothing.
func (AttributeProcessor) Shutdown(context.Context) error { return nil }

// ForceFlush does nothing.
func (AttributeProcessor) ForceFlush(context.Context) error { return nil }
