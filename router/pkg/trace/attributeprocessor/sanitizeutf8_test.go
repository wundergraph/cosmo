package attributeprocessor

import (
	"context"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

func TestSanitizeUTF8(t *testing.T) {
	t.Parallel()

	t.Run("ValidUTF8Unchanged", func(t *testing.T) {
		t.Parallel()

		validStr := attribute.String("message", "Hello, World!")
		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), validStr)
		require.Contains(t, attributes, validStr)
	})

	t.Run("InvalidUTF8Sanitized", func(t *testing.T) {
		t.Parallel()

		// Create an invalid UTF-8 string with a byte sequence that is not valid UTF-8
		// strings.ToValidUTF8 replaces each run of invalid bytes with a single replacement character
		invalidBytes := string([]byte{0x80, 0x81, 0x82})
		invalidStr := attribute.String("message", invalidBytes)
		expected := attribute.String("message", "\ufffd")

		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), invalidStr)
		require.Contains(t, attributes, expected)
	})

	t.Run("MixedUTF8Sanitized", func(t *testing.T) {
		t.Parallel()

		// Valid UTF-8 followed by invalid bytes
		mixedBytes := string([]byte{'H', 'i', 0x80, '!'})
		mixedStr := attribute.String("message", mixedBytes)
		expected := attribute.String("message", "Hi\ufffd!")

		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), mixedStr)
		require.Contains(t, attributes, expected)
	})

	t.Run("NoTransformers", func(t *testing.T) {
		t.Parallel()

		invalidBytes := string([]byte{0x80, 0x81, 0x82})
		invalidStr := attribute.String("message", invalidBytes)

		// With no transformers, the invalid string should remain unchanged
		attributes := testAttributes(NewAttributeProcessorOption(), invalidStr)
		require.Contains(t, attributes, invalidStr)
	})

	t.Run("NonStringAttributesUnchanged", func(t *testing.T) {
		t.Parallel()

		intAttr := attribute.Int("count", 42)
		boolAttr := attribute.Bool("flag", true)

		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), intAttr, boolAttr)
		require.Contains(t, attributes, intAttr)
		require.Contains(t, attributes, boolAttr)
	})

	t.Run("RedactionTakesPrecedenceOverSanitization", func(t *testing.T) {
		t.Parallel()

		const key = "password"
		invalidBytes := string([]byte{'s', 'e', 'c', 'r', 'e', 't', 0x80})
		passStr := attribute.String(key, invalidBytes)
		expected := attribute.String(key, "[REDACTED]")

		// With both redaction and sanitization, redaction runs first and handles the attribute
		attributes := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Redact), SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), passStr)
		require.Contains(t, attributes, expected)
	})

	t.Run("EmptyStringUnchanged", func(t *testing.T) {
		t.Parallel()

		emptyStr := attribute.String("empty", "")
		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), emptyStr)
		require.Contains(t, attributes, emptyStr)
	})

	t.Run("UnicodeCharactersPreserved", func(t *testing.T) {
		t.Parallel()

		// Valid UTF-8 with various unicode characters should be preserved
		unicodeStr := attribute.String("message", "Hello, 世界! 🌍 Ñoño")
		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), unicodeStr)
		require.Contains(t, attributes, unicodeStr)
	})

	t.Run("MultipleInvalidSequences", func(t *testing.T) {
		t.Parallel()

		// Multiple separate invalid sequences should each be replaced
		// "Hi" + invalid + "there" + invalid + "!"
		mixedBytes := string([]byte{'H', 'i', 0x80, 't', 'h', 'e', 'r', 'e', 0x81, '!'})
		mixedStr := attribute.String("message", mixedBytes)
		expected := attribute.String("message", "Hi\ufffdthere\ufffd!")

		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), mixedStr)
		require.Contains(t, attributes, expected)
	})

	t.Run("StringSliceAttributeUnchanged", func(t *testing.T) {
		t.Parallel()

		// String slice attributes should not be modified (only simple strings are processed)
		sliceAttr := attribute.StringSlice("tags", []string{"tag1", "tag2"})
		attributes := testAttributes(NewAttributeProcessorOption(SanitizeUTF8(&SanitizeUTF8Config{Enabled: true}, nil)), sliceAttr)
		require.Contains(t, attributes, sliceAttr)
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
