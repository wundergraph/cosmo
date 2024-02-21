package redact

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

type RedactFunc func(key attribute.KeyValue) string

// Attributes returns an OpenTelemetry SDK TracerProviderOption. It registers
// an OpenTelemetry SpanProcessor that redacts attributes of new spans matching
// the passed keys.
func Attributes(keys []attribute.Key, redactFunc RedactFunc) trace.TracerProviderOption {
	r := make(map[attribute.Key]struct{}, len(keys))
	for _, k := range keys {
		r[k] = struct{}{}
	}
	censor := NewAttributeCensor(r, redactFunc)
	return trace.WithSpanProcessor(censor)
}

// AttributeCensor is an OpenTelemetry SpanProcessor that censors attributes of
// new spans.
type AttributeCensor struct {
	// args is a slice allocated on creation that is reused when calling
	// SetAttributes in OnStart.
	args         []attribute.KeyValue
	redactFunc   RedactFunc
	replacements map[attribute.Key]struct{}
}

// NewAttributeCensor returns an AttributeCensor that uses the provided mapping
// of replacement values for a set of keys to redact matching attributes.
// Attributes are matched based on the equality of keys.
func NewAttributeCensor(replacements map[attribute.Key]struct{}, redactFunc RedactFunc) AttributeCensor {
	a := AttributeCensor{
		// Allocate a reusable slice to pass to SetAttributes.
		args:         make([]attribute.KeyValue, 0, len(replacements)),
		redactFunc:   redactFunc,
		replacements: replacements,
	}
	return a
}

// OnStart does nothing.
func (c AttributeCensor) OnStart(_ context.Context, _ trace.ReadWriteSpan) {
}

// OnEnd censors the attributes of s matching the Replacements keys of c.
func (c AttributeCensor) OnEnd(s trace.ReadOnlySpan) {
	// We can't change the attribute slice of the span snapshot in OnEnd, but
	// we can change the attribute value in the underlying array.
	attributes := s.Attributes()
	for i := range attributes {
		if _, ok := c.replacements[attributes[i].Key]; ok {
			attributes[i].Value = attribute.StringValue(c.redactFunc(attributes[i]))
		}
	}
}

// Shutdown does nothing.
func (AttributeCensor) Shutdown(context.Context) error { return nil }

// ForceFlush does nothing.
func (AttributeCensor) ForceFlush(context.Context) error { return nil }
