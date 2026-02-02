package attributeprocessor

import (
	"context"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
	api "go.opentelemetry.io/otel/trace"
)

type attrRecorder struct {
	attrs []attribute.KeyValue
}

func (r *attrRecorder) OnEnd(s trace.ReadOnlySpan) {
	r.attrs = s.Attributes()
}
func (*attrRecorder) Shutdown(context.Context) error                   { return nil }
func (*attrRecorder) ForceFlush(context.Context) error                 { return nil }
func (*attrRecorder) OnStart(_ context.Context, _ trace.ReadWriteSpan) {}

func TestRedactKeys(t *testing.T) {
	const key = "password"
	var (
		name     = attribute.String("name", "bob")
		eID      = attribute.Int("employee-id", 9287)
		passStr  = attribute.String(key, "super-secret-pswd")
		passBool = attribute.Bool(key, true)
		replaced = attribute.String(key, "[REDACTED]")
	)

	contains := func(t *testing.T, got []attribute.KeyValue, want ...attribute.KeyValue) {
		t.Helper()
		for _, w := range want {
			assert.Contains(t, got, w)
		}
	}

	t.Run("Empty", func(t *testing.T) {
		// No transformers means no changes
		got := testAttributes(NewAttributeProcessorOption(), name, passStr, eID)
		contains(t, got, name, eID, passStr)
	})
	t.Run("EmptyAfterCreation", func(t *testing.T) {
		got := testAttributesAfterCreation(NewAttributeProcessorOption(), name, passStr, eID)
		contains(t, got, name, eID, passStr)
	})

	t.Run("SingleStringAttribute", func(t *testing.T) {
		got := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Redact)), name, passStr, eID)
		contains(t, got, name, eID, replaced)
	})
	t.Run("SingleStringAttributeAfterCreation", func(t *testing.T) {
		got := testAttributesAfterCreation(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Redact)), name, passStr, eID)
		contains(t, got, name, eID, replaced)
	})

	t.Run("NoMatchingKey", func(t *testing.T) {
		got := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{"secret"}, Redact)), name, passStr, eID)
		contains(t, got, name, eID, passStr)
	})
	t.Run("NoMatchingKeyAfterCreation", func(t *testing.T) {
		got := testAttributesAfterCreation(NewAttributeProcessorOption(RedactKeys([]attribute.Key{"secret"}, Redact)), name, passStr, eID)
		contains(t, got, name, eID, passStr)
	})

	t.Run("DifferentValueTypes", func(t *testing.T) {
		got := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Redact)), name, passBool, eID)
		contains(t, got, name, eID, replaced)
	})
	t.Run("DifferentValueTypesAfterCreation", func(t *testing.T) {
		got := testAttributesAfterCreation(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Redact)), name, passBool, eID)
		contains(t, got, name, eID, replaced)
	})
}

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

func BenchmarkAttributeProcessorOnEnd(b *testing.B) {
	b.Run("0/16", benchAttributeProcessorOnEnd(0, 16))
	b.Run("1/16", benchAttributeProcessorOnEnd(1, 16))
	b.Run("2/16", benchAttributeProcessorOnEnd(2, 16))
	b.Run("4/16", benchAttributeProcessorOnEnd(4, 16))
	b.Run("8/16", benchAttributeProcessorOnEnd(8, 16))
	b.Run("16/16", benchAttributeProcessorOnEnd(16, 16))
}

type rwSpan struct {
	trace.ReadWriteSpan

	attrs []attribute.KeyValue
}

func (rwSpan) SetAttributes(...attribute.KeyValue) {}
func (s rwSpan) Attributes() []attribute.KeyValue {
	return s.attrs
}

func benchAttributeProcessorOnEnd(redacted, total int) func(*testing.B) {
	if redacted > total {
		panic("redacted needs to be less than or equal to total")
	}

	keys := make([]attribute.Key, 0, redacted)
	attrs := make([]attribute.KeyValue, total)
	for i := range attrs {
		key := attribute.Key(strconv.Itoa(i))
		if i < redacted {
			keys = append(keys, key)
		}
		attrs[i] = attribute.KeyValue{
			Key:   key,
			Value: attribute.IntValue(i),
		}
	}

	s := rwSpan{attrs: attrs}
	ac := NewAttributeProcessor(RedactKeys(keys, Redact))
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

func TestSanitizeUTF8(t *testing.T) {
	contains := func(t *testing.T, got []attribute.KeyValue, want ...attribute.KeyValue) {
		t.Helper()
		for _, w := range want {
			assert.Contains(t, got, w)
		}
	}

	t.Run("ValidUTF8Unchanged", func(t *testing.T) {
		validStr := attribute.String("message", "Hello, World!")
		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), validStr)
		contains(t, got, validStr)
	})

	t.Run("InvalidUTF8Sanitized", func(t *testing.T) {
		// Create an invalid UTF-8 string with a byte sequence that is not valid UTF-8
		// strings.ToValidUTF8 replaces each run of invalid bytes with a single replacement character
		invalidBytes := string([]byte{0x80, 0x81, 0x82})
		invalidStr := attribute.String("message", invalidBytes)
		expected := attribute.String("message", "\ufffd")

		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), invalidStr)
		contains(t, got, expected)
	})

	t.Run("MixedUTF8Sanitized", func(t *testing.T) {
		// Valid UTF-8 followed by invalid bytes
		mixedBytes := string([]byte{'H', 'i', 0x80, '!'})
		mixedStr := attribute.String("message", mixedBytes)
		expected := attribute.String("message", "Hi\ufffd!")

		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), mixedStr)
		contains(t, got, expected)
	})

	t.Run("NoTransformers", func(t *testing.T) {
		invalidBytes := string([]byte{0x80, 0x81, 0x82})
		invalidStr := attribute.String("message", invalidBytes)

		// With no transformers, the invalid string should remain unchanged
		got := testAttributes(NewAttributeProcessorOption(), invalidStr)
		contains(t, got, invalidStr)
	})

	t.Run("NonStringAttributesUnchanged", func(t *testing.T) {
		intAttr := attribute.Int("count", 42)
		boolAttr := attribute.Bool("flag", true)

		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), intAttr, boolAttr)
		contains(t, got, intAttr, boolAttr)
	})

	t.Run("RedactionTakesPrecedenceOverSanitization", func(t *testing.T) {
		const key = "password"
		invalidBytes := string([]byte{'s', 'e', 'c', 'r', 'e', 't', 0x80})
		passStr := attribute.String(key, invalidBytes)
		expected := attribute.String(key, "[REDACTED]")

		// With both redaction and sanitization, redaction runs first and handles the attribute
		got := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Redact), SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), passStr)
		contains(t, got, expected)
	})

	t.Run("EmptyStringUnchanged", func(t *testing.T) {
		emptyStr := attribute.String("empty", "")
		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), emptyStr)
		contains(t, got, emptyStr)
	})
}

func TestMultipleTransformers(t *testing.T) {
	contains := func(t *testing.T, got []attribute.KeyValue, want ...attribute.KeyValue) {
		t.Helper()
		for _, w := range want {
			assert.Contains(t, got, w)
		}
	}

	t.Run("TransformersAppliedInOrder", func(t *testing.T) {
		// First transformer handles "secret" key
		// Second transformer handles all strings (SanitizeUTF8)
		secretKey := attribute.Key("secret")
		otherKey := attribute.Key("other")

		secret := attribute.String(string(secretKey), "value")
		invalidUTF8 := attribute.String(string(otherKey), string([]byte{0x80}))

		got := testAttributes(
			NewAttributeProcessorOption(RedactKeys([]attribute.Key{secretKey}, Redact), SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)),
			secret, invalidUTF8,
		)

		// secret should be redacted
		contains(t, got, attribute.String(string(secretKey), "[REDACTED]"))
		// other should have UTF-8 sanitized
		contains(t, got, attribute.String(string(otherKey), "\ufffd"))
	})
}
