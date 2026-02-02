package attributeprocessor

import (
	"context"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

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

	t.Run("UnicodeCharactersPreserved", func(t *testing.T) {
		// Valid UTF-8 with various unicode characters should be preserved
		unicodeStr := attribute.String("message", "Hello, 世界! 🌍 Ñoño")
		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), unicodeStr)
		contains(t, got, unicodeStr)
	})

	t.Run("MultipleInvalidSequences", func(t *testing.T) {
		// Multiple separate invalid sequences should each be replaced
		// "Hi" + invalid + "there" + invalid + "!"
		mixedBytes := string([]byte{'H', 'i', 0x80, 't', 'h', 'e', 'r', 'e', 0x81, '!'})
		mixedStr := attribute.String("message", mixedBytes)
		expected := attribute.String("message", "Hi\ufffdthere\ufffd!")

		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), mixedStr)
		contains(t, got, expected)
	})

	t.Run("StringSliceAttributeUnchanged", func(t *testing.T) {
		// String slice attributes should not be modified (only simple strings are processed)
		sliceAttr := attribute.StringSlice("tags", []string{"tag1", "tag2"})
		got := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), sliceAttr)
		contains(t, got, sliceAttr)
	})
}

// sanitizeSpan is a minimal span implementation for benchmarks
type sanitizeSpan struct {
	trace.ReadWriteSpan
	attrs []attribute.KeyValue
}

func (sanitizeSpan) SetAttributes(...attribute.KeyValue) {}
func (s sanitizeSpan) Attributes() []attribute.KeyValue {
	return s.attrs
}

func BenchmarkSanitizeUTF8OnEnd(b *testing.B) {
	b.Run("AllValid/16", benchSanitizeUTF8OnEnd(0, 16))
	b.Run("1Invalid/16", benchSanitizeUTF8OnEnd(1, 16))
	b.Run("4Invalid/16", benchSanitizeUTF8OnEnd(4, 16))
	b.Run("8Invalid/16", benchSanitizeUTF8OnEnd(8, 16))
	b.Run("16Invalid/16", benchSanitizeUTF8OnEnd(16, 16))
}

func benchSanitizeUTF8OnEnd(invalidCount, total int) func(*testing.B) {
	if invalidCount > total {
		panic("invalidCount needs to be less than or equal to total")
	}

	attrs := make([]attribute.KeyValue, total)
	for i := range attrs {
		key := attribute.Key(strconv.Itoa(i))
		if i < invalidCount {
			// Create invalid UTF-8 string
			attrs[i] = attribute.KeyValue{
				Key:   key,
				Value: attribute.StringValue(string([]byte{0x80, 0x81, 0x82})),
			}
		} else {
			// Create valid UTF-8 string
			attrs[i] = attribute.KeyValue{
				Key:   key,
				Value: attribute.StringValue("valid-utf8-string"),
			}
		}
	}

	s := sanitizeSpan{attrs: attrs}
	ac := NewAttributeProcessor(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil))
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

func BenchmarkSanitizeUTF8MixedTypes(b *testing.B) {
	// Benchmark with mixed attribute types (strings, ints, bools)
	attrs := make([]attribute.KeyValue, 16)
	for i := range attrs {
		key := attribute.Key(strconv.Itoa(i))
		switch i % 4 {
		case 0:
			attrs[i] = attribute.KeyValue{Key: key, Value: attribute.StringValue("valid")}
		case 1:
			attrs[i] = attribute.KeyValue{Key: key, Value: attribute.StringValue(string([]byte{0x80}))}
		case 2:
			attrs[i] = attribute.KeyValue{Key: key, Value: attribute.IntValue(i)}
		case 3:
			attrs[i] = attribute.KeyValue{Key: key, Value: attribute.BoolValue(true)}
		}
	}

	s := sanitizeSpan{attrs: attrs}
	ac := NewAttributeProcessor(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil))
	ctx := context.Background()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ac.OnStart(ctx, s)
		ac.OnEnd(s)
	}
}
