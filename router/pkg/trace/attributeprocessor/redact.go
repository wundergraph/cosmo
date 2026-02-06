package attributeprocessor

import (
	"crypto/sha256"
	"encoding/hex"

	"go.opentelemetry.io/otel/attribute"
)

type (
	IPAnonymizationMethod string

	IPAnonymizationConfig struct {
		Enabled bool
		Method  IPAnonymizationMethod
	}
)

const (
	Hash   IPAnonymizationMethod = "hash"
	Redact IPAnonymizationMethod = "redact"
)

// RedactKeys returns a transformer that redacts attributes matching the given keys.
// The redactFunc is called with the original attribute to produce the replacement value.
func RedactKeys(keys []attribute.Key, ipAnonymizationMethod IPAnonymizationMethod) AttributeTransformer {
	var rFunc func(attribute.KeyValue) string

	switch ipAnonymizationMethod {
	case Hash:
		rFunc = func(key attribute.KeyValue) string {
			h := sha256.New()
			h.Write([]byte(key.Value.AsString()))
			return hex.EncodeToString(h.Sum(nil))
		}
	case Redact:
		rFunc = func(_ attribute.KeyValue) string {
			return "[REDACTED]"
		}
	}

	keySet := make(map[attribute.Key]struct{}, len(keys))
	for _, k := range keys {
		keySet[k] = struct{}{}
	}

	return func(kv attribute.KeyValue) (attribute.Value, bool) {
		if _, ok := keySet[kv.Key]; ok {
			return attribute.StringValue(rFunc(kv)), true
		}
		return kv.Value, false
	}
}
