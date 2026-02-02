package attributeprocessor

import (
	"context"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

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

	t.Run("MultipleKeys", func(t *testing.T) {
		secret := attribute.String("secret", "my-secret")
		apiKey := attribute.String("api_key", "my-api-key")
		normal := attribute.String("normal", "normal-value")

		got := testAttributes(
			NewAttributeProcessorOption(RedactKeys([]attribute.Key{"secret", "api_key"}, Redact)),
			secret, apiKey, normal,
		)
		contains(t, got, attribute.String("secret", "[REDACTED]"))
		contains(t, got, attribute.String("api_key", "[REDACTED]"))
		contains(t, got, normal)
	})
}

func TestRedactKeysWithHash(t *testing.T) {
	const key = "password"
	passStr := attribute.String(key, "super-secret-pswd")

	t.Run("HashMethod", func(t *testing.T) {
		got := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Hash)), passStr)

		// Find the password attribute
		var hashedValue string
		for _, attr := range got {
			if attr.Key == key {
				hashedValue = attr.Value.AsString()
				break
			}
		}

		// Hash should be a 64-character hex string (SHA256)
		assert.Len(t, hashedValue, 64, "Hash should be 64 characters (SHA256 hex)")
		assert.NotEqual(t, "super-secret-pswd", hashedValue, "Value should be hashed")
		assert.NotEqual(t, "[REDACTED]", hashedValue, "Value should be hashed, not redacted")
	})

	t.Run("HashIsDeterministic", func(t *testing.T) {
		// Same value should produce same hash
		got1 := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Hash)), passStr)
		got2 := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Hash)), passStr)

		var hash1, hash2 string
		for _, attr := range got1 {
			if attr.Key == key {
				hash1 = attr.Value.AsString()
				break
			}
		}
		for _, attr := range got2 {
			if attr.Key == key {
				hash2 = attr.Value.AsString()
				break
			}
		}

		assert.Equal(t, hash1, hash2, "Same input should produce same hash")
	})

	t.Run("DifferentValuesProduceDifferentHashes", func(t *testing.T) {
		pass1 := attribute.String(key, "password1")
		pass2 := attribute.String(key, "password2")

		got1 := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Hash)), pass1)
		got2 := testAttributes(NewAttributeProcessorOption(RedactKeys([]attribute.Key{key}, Hash)), pass2)

		var hash1, hash2 string
		for _, attr := range got1 {
			if attr.Key == key {
				hash1 = attr.Value.AsString()
				break
			}
		}
		for _, attr := range got2 {
			if attr.Key == key {
				hash2 = attr.Value.AsString()
				break
			}
		}

		assert.NotEqual(t, hash1, hash2, "Different inputs should produce different hashes")
	})
}

func BenchmarkRedactOnEnd(b *testing.B) {
	b.Run("Redact/0/16", benchRedactOnEnd(0, 16, Redact))
	b.Run("Redact/1/16", benchRedactOnEnd(1, 16, Redact))
	b.Run("Redact/4/16", benchRedactOnEnd(4, 16, Redact))
	b.Run("Redact/8/16", benchRedactOnEnd(8, 16, Redact))
	b.Run("Redact/16/16", benchRedactOnEnd(16, 16, Redact))
	b.Run("Hash/0/16", benchRedactOnEnd(0, 16, Hash))
	b.Run("Hash/1/16", benchRedactOnEnd(1, 16, Hash))
	b.Run("Hash/4/16", benchRedactOnEnd(4, 16, Hash))
	b.Run("Hash/8/16", benchRedactOnEnd(8, 16, Hash))
	b.Run("Hash/16/16", benchRedactOnEnd(16, 16, Hash))
}

type rwSpan struct {
	trace.ReadWriteSpan

	attrs []attribute.KeyValue
}

func (rwSpan) SetAttributes(...attribute.KeyValue) {}
func (s rwSpan) Attributes() []attribute.KeyValue {
	return s.attrs
}

func benchRedactOnEnd(redacted, total int, method IPAnonymizationMethod) func(*testing.B) {
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
			Value: attribute.StringValue("sensitive-value-" + strconv.Itoa(i)),
		}
	}

	s := rwSpan{attrs: attrs}
	ac := NewAttributeProcessor(RedactKeys(keys, method))
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
