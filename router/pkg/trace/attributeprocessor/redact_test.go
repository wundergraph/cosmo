package attributeprocessor

import (
	"context"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

func TestRedactKeys(t *testing.T) {
	t.Parallel()

	const key = "password"
	var (
		name     = attribute.String("name", "bob")
		eID      = attribute.Int("employee-id", 9287)
		passStr  = attribute.String(key, "super-secret-pswd")
		passBool = attribute.Bool(key, true)
		replaced = attribute.String(key, "[REDACTED]")
	)

	t.Run("Empty", func(t *testing.T) {
		t.Parallel()

		// No transformers means no changes
		attributes := testAttributes(NewAttributeProcessorOption(), name, passStr, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, passStr)
	})
	t.Run("EmptyAfterCreation", func(t *testing.T) {
		t.Parallel()

		attributes := testAttributesAfterCreation(NewAttributeProcessorOption(), name, passStr, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, passStr)
	})

	t.Run("SingleStringAttribute", func(t *testing.T) {
		t.Parallel()

		transformer, err := RedactKeys([]attribute.Key{key}, Redact)
		require.NoError(t, err)
		attributes := testAttributes(NewAttributeProcessorOption(transformer), name, passStr, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, replaced)
	})
	t.Run("SingleStringAttributeAfterCreation", func(t *testing.T) {
		t.Parallel()

		transformer, err := RedactKeys([]attribute.Key{key}, Redact)
		require.NoError(t, err)
		attributes := testAttributesAfterCreation(NewAttributeProcessorOption(transformer), name, passStr, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, replaced)
	})

	t.Run("NoMatchingKey", func(t *testing.T) {
		t.Parallel()

		transformer, err := RedactKeys([]attribute.Key{"secret"}, Redact)
		require.NoError(t, err)
		attributes := testAttributes(NewAttributeProcessorOption(transformer), name, passStr, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, passStr)
	})
	t.Run("NoMatchingKeyAfterCreation", func(t *testing.T) {
		t.Parallel()

		transformer, err := RedactKeys([]attribute.Key{"secret"}, Redact)
		require.NoError(t, err)
		attributes := testAttributesAfterCreation(NewAttributeProcessorOption(transformer), name, passStr, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, passStr)
	})

	t.Run("DifferentValueTypes", func(t *testing.T) {
		t.Parallel()

		transformer, err := RedactKeys([]attribute.Key{key}, Redact)
		require.NoError(t, err)
		attributes := testAttributes(NewAttributeProcessorOption(transformer), name, passBool, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, replaced)
	})
	t.Run("DifferentValueTypesAfterCreation", func(t *testing.T) {
		t.Parallel()

		transformer, err := RedactKeys([]attribute.Key{key}, Redact)
		require.NoError(t, err)
		attributes := testAttributesAfterCreation(NewAttributeProcessorOption(transformer), name, passBool, eID)
		require.Contains(t, attributes, name)
		require.Contains(t, attributes, eID)
		require.Contains(t, attributes, replaced)
	})

	t.Run("MultipleKeys", func(t *testing.T) {
		t.Parallel()

		secret := attribute.String("secret", "my-secret")
		apiKey := attribute.String("api_key", "my-api-key")
		normal := attribute.String("normal", "normal-value")

		transformer, err := RedactKeys([]attribute.Key{"secret", "api_key"}, Redact)
		require.NoError(t, err)
		attributes := testAttributes(
			NewAttributeProcessorOption(transformer),
			secret, apiKey, normal,
		)
		require.Contains(t, attributes, attribute.String("secret", "[REDACTED]"))
		require.Contains(t, attributes, attribute.String("api_key", "[REDACTED]"))
		require.Contains(t, attributes, normal)
	})
}

func TestRedactKeysUnsupportedMethod(t *testing.T) {
	t.Parallel()

	const key = "password"

	t.Run("UnsupportedMethod", func(t *testing.T) {
		t.Parallel()

		// Test that unsupported methods return an error
		_, err := RedactKeys([]attribute.Key{key}, "unsupported")
		require.Error(t, err)
		require.Contains(t, err.Error(), "unsupported IP anonymization method")
	})

	t.Run("EmptyMethod", func(t *testing.T) {
		t.Parallel()

		// Test that empty method returns an error
		_, err := RedactKeys([]attribute.Key{key}, "")
		require.Error(t, err)
		require.Contains(t, err.Error(), "unsupported IP anonymization method")
	})
}

func TestRedactKeysWithHash(t *testing.T) {
	t.Parallel()

	const key = "password"
	passStr := attribute.String(key, "super-secret-pswd")

	t.Run("HashMethod", func(t *testing.T) {
		t.Parallel()

		transformer, err := RedactKeys([]attribute.Key{key}, Hash)
		require.NoError(t, err)
		attributes := testAttributes(NewAttributeProcessorOption(transformer), passStr)

		// Find the password attribute
		var hashedValue string
		for _, attr := range attributes {
			if attr.Key == key {
				hashedValue = attr.Value.AsString()
				break
			}
		}

		// Hash should be a 64-character hex string (SHA256)
		require.Len(t, hashedValue, 64, "Hash should be 64 characters (SHA256 hex)")
		require.NotEqual(t, "super-secret-pswd", hashedValue, "Value should be hashed")
		require.NotEqual(t, "[REDACTED]", hashedValue, "Value should be hashed, not redacted")
	})

	t.Run("HashIsDeterministic", func(t *testing.T) {
		t.Parallel()

		// Same value should produce same hash
		transformer1, err := RedactKeys([]attribute.Key{key}, Hash)
		require.NoError(t, err)
		transformer2, err := RedactKeys([]attribute.Key{key}, Hash)
		require.NoError(t, err)
		attributes1 := testAttributes(NewAttributeProcessorOption(transformer1), passStr)
		attributes2 := testAttributes(NewAttributeProcessorOption(transformer2), passStr)

		var hash1, hash2 string
		for _, attr := range attributes1 {
			if attr.Key == key {
				hash1 = attr.Value.AsString()
				break
			}
		}
		for _, attr := range attributes2 {
			if attr.Key == key {
				hash2 = attr.Value.AsString()
				break
			}
		}

		require.Equal(t, "84ac464cfb16339f20b38c5dbd2623514badf48f525c165ebd39091a7969a86c", hash1)
		require.Equal(t, hash1, hash2)
	})

	t.Run("DifferentValuesProduceDifferentHashes", func(t *testing.T) {
		t.Parallel()

		pass1 := attribute.String(key, "password1")
		pass2 := attribute.String(key, "password2")

		transformer1, err := RedactKeys([]attribute.Key{key}, Hash)
		require.NoError(t, err)
		transformer2, err := RedactKeys([]attribute.Key{key}, Hash)
		require.NoError(t, err)
		attributes1 := testAttributes(NewAttributeProcessorOption(transformer1), pass1)
		attributes2 := testAttributes(NewAttributeProcessorOption(transformer2), pass2)

		var hash1, hash2 string
		for _, attr := range attributes1 {
			if attr.Key == key {
				hash1 = attr.Value.AsString()
				break
			}
		}
		for _, attr := range attributes2 {
			if attr.Key == key {
				hash2 = attr.Value.AsString()
				break
			}
		}

		require.NotEqual(t, hash1, hash2, "Different inputs should produce different hashes")
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

	return func(b *testing.B) {
		transformer, err := RedactKeys(keys, method)
		if err != nil {
			b.Fatal(err)
		}
		s := rwSpan{attrs: attrs}
		ac := NewAttributeProcessor(transformer)
		ctx := context.Background()

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			ac.OnStart(ctx, s)
			ac.OnEnd(s)
		}
	}
}
