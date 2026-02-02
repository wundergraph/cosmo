package attributeprocessor

import (
	"context"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
	api "go.opentelemetry.io/otel/trace"
)

// attrRecorder is a test helper that records span attributes
type attrRecorder struct {
	attrs []attribute.KeyValue
}

func (r *attrRecorder) OnEnd(s trace.ReadOnlySpan) {
	r.attrs = s.Attributes()
}
func (*attrRecorder) Shutdown(context.Context) error                   { return nil }
func (*attrRecorder) ForceFlush(context.Context) error                 { return nil }
func (*attrRecorder) OnStart(_ context.Context, _ trace.ReadWriteSpan) {}

// testAttributes creates a span with the given attributes at creation time and returns the recorded attributes
func testAttributes(opt trace.TracerProviderOption, attrs ...attribute.KeyValue) []attribute.KeyValue {
	r := &attrRecorder{}
	tp := trace.NewTracerProvider(opt, trace.WithSpanProcessor(r))
	defer func() { _ = tp.Shutdown(context.Background()) }()

	ctx := context.Background()
	tracer := tp.Tracer("testAttributes")
	_, s := tracer.Start(ctx, "span name", api.WithAttributes(attrs...))
	s.End()
	return r.attrs
}

// testAttributesAfterCreation creates a span and sets attributes after creation, then returns the recorded attributes
func testAttributesAfterCreation(opt trace.TracerProviderOption, attrs ...attribute.KeyValue) []attribute.KeyValue {
	r := &attrRecorder{}
	tp := trace.NewTracerProvider(opt, trace.WithSpanProcessor(r))
	defer func() { _ = tp.Shutdown(context.Background()) }()

	ctx := context.Background()
	tracer := tp.Tracer("testAttributes")
	_, s := tracer.Start(ctx, "span name")
	s.SetAttributes(attrs...)
	s.End()
	return r.attrs
}

func TestAttributeProcessor(t *testing.T) {
	t.Parallel()

	t.Run("NoTransformers", func(t *testing.T) {
		t.Parallel()

		// With no transformers, attributes should remain unchanged
		name := attribute.String("name", "bob")
		count := attribute.Int("count", 42)

		attributes := testAttributes(NewAttributeProcessorOption(), name, count)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, count)
	})

	t.Run("EmptyAttributes", func(t *testing.T) {
		t.Parallel()

		// With no attributes, nothing should happen
		attributes := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{"secret"}, Redact)))
		require.Empty(t, attributes)
	})

	t.Run("FirstTransformerHandlesAttribute", func(t *testing.T) {
		t.Parallel()

		// When first transformer handles an attribute, second transformer should be skipped for that attribute
		secretKey := attribute.Key("secret")
		otherKey := attribute.Key("other")
		secret := attribute.String(string(secretKey), "value")
		other := attribute.String(string(otherKey), "other-value")

		// Track which keys the second transformer sees
		seenKeys := make(map[attribute.Key]bool)
		trackingTransformer := func(kv attribute.KeyValue) (attribute.Value, bool) {
			seenKeys[kv.Key] = true
			return kv.Value, false
		}

		// RedactKeys should handle "secret", so trackingTransformer should NOT see "secret"
		// but SHOULD see "other"
		attributes := testAttributes(
			NewAttributeProcessorOption(RedactKeys([]attribute.Key{secretKey}, Redact), trackingTransformer),
			secret, other,
		)

		// secret should be redacted by first transformer
		require.Contains(t, attributes, attribute.String(string(secretKey), "[REDACTED]"))
		// other should be unchanged
		require.Contains(t, attributes, other)
		// tracking transformer should NOT have seen "secret" (it was handled by redact)
		require.False(t, seenKeys[secretKey], "second transformer should NOT see 'secret' key (handled by first)")
		// tracking transformer SHOULD have seen "other"
		require.True(t, seenKeys[otherKey], "second transformer should see 'other' key")
	})
}

func TestMultipleTransformers(t *testing.T) {
	t.Parallel()

	t.Run("TransformersAppliedInOrder", func(t *testing.T) {
		t.Parallel()

		// First transformer handles "secret" key
		// Second transformer handles all strings (SanitizeUTF8)
		secretKey := attribute.Key("secret")
		otherKey := attribute.Key("other")

		secret := attribute.String(string(secretKey), "value")
		invalidUTF8 := attribute.String(string(otherKey), string([]byte{0x80}))

		attributes := testAttributes(
			NewAttributeProcessorOption(RedactKeys([]attribute.Key{secretKey}, Redact), SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)),
			secret, invalidUTF8,
		)

		// secret should be redacted
		require.Contains(t, attributes, attribute.String(string(secretKey), "[REDACTED]"))
		// other should have UTF-8 sanitized
		require.Contains(t, attributes, attribute.String(string(otherKey), "\ufffd"))
	})

	t.Run("RedactedAttributeNotSanitized", func(t *testing.T) {
		t.Parallel()

		// When an attribute is redacted, it should not be passed to sanitize
		// (the redacted value is already valid UTF-8)
		key := attribute.Key("password")
		invalidUTF8Password := attribute.String(string(key), string([]byte{'s', 'e', 'c', 'r', 'e', 't', 0x80}))

		attributes := testAttributes(
			NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Redact), SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)),
			invalidUTF8Password,
		)

		// password should be redacted (not sanitized)
		require.Contains(t, attributes, attribute.String(string(key), "[REDACTED]"))
	})

	t.Run("MixedAttributeTypes", func(t *testing.T) {
		t.Parallel()

		// Test with mixed attribute types - only strings should be affected
		secretKey := attribute.Key("secret")
		secret := attribute.String(string(secretKey), "value")
		count := attribute.Int("count", 42)
		flag := attribute.Bool("flag", true)
		invalidUTF8 := attribute.String("message", string([]byte{0x80}))

		attributes := testAttributes(
			NewAttributeProcessorOption(RedactKeys([]attribute.Key{secretKey}, Redact), SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)),
			secret, count, flag, invalidUTF8,
		)

		require.Contains(t, attributes, attribute.String(string(secretKey), "[REDACTED]"))
		require.Contains(t, attributes, count)
		require.Contains(t, attributes, flag)
		require.Contains(t, attributes, attribute.String("message", "\ufffd"))
	})
}

// benchSpan is a minimal span implementation for benchmarks
type benchSpan struct {
	trace.ReadWriteSpan
	attrs []attribute.KeyValue
}

func (benchSpan) SetAttributes(...attribute.KeyValue) {}
func (s benchSpan) Attributes() []attribute.KeyValue {
	return s.attrs
}

func BenchmarkCombinedTransformers(b *testing.B) {
	b.Run("Redact+SanitizeUTF8/0_redacted/16_total", benchCombinedTransformers(0, 16, 0))
	b.Run("Redact+SanitizeUTF8/4_redacted/16_total", benchCombinedTransformers(4, 16, 0))
	b.Run("Redact+SanitizeUTF8/0_redacted/4_invalid/16_total", benchCombinedTransformers(0, 16, 4))
	b.Run("Redact+SanitizeUTF8/4_redacted/4_invalid/16_total", benchCombinedTransformers(4, 16, 4))
	b.Run("Redact+SanitizeUTF8/8_redacted/8_invalid/16_total", benchCombinedTransformers(8, 16, 8))
}

func benchCombinedTransformers(redacted, total, invalidUTF8 int) func(*testing.B) {
	if redacted > total {
		panic("redacted needs to be less than or equal to total")
	}
	if invalidUTF8 > total-redacted {
		panic("invalidUTF8 needs to be less than or equal to total-redacted")
	}

	keys := make([]attribute.Key, 0, redacted)
	attrs := make([]attribute.KeyValue, total)

	for i := range attrs {
		key := attribute.Key(strconv.Itoa(i))
		switch {
		case i < redacted:
			keys = append(keys, key)
			attrs[i] = attribute.KeyValue{
				Key:   key,
				Value: attribute.StringValue("secret-value"),
			}
		case i < redacted+invalidUTF8:
			// Create invalid UTF-8 string
			attrs[i] = attribute.KeyValue{
				Key:   key,
				Value: attribute.StringValue(string([]byte{0x80, 0x81})),
			}
		default:
			attrs[i] = attribute.KeyValue{
				Key:   key,
				Value: attribute.StringValue("valid-string"),
			}
		}
	}

	s := benchSpan{attrs: attrs}
	ac := NewAttributeProcessor(
		RedactKeys(keys, Redact),
		SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil),
	)
	ctx := context.Background()

	return func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			ac.OnStart(ctx, s)
			ac.OnEnd(s)
		}
	}
}
