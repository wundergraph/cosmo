package attributeprocessor

import (
	"strings"
	"unicode/utf8"

	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

type SanitizeUTF8Config struct {
	Enabled          bool
	LogSanitizations bool
}

// SanitizeUTF8 returns a transformer that replaces invalid UTF-8 sequences
// with the Unicode replacement character (U+FFFD).
// If config.LogSanitizations is true and logger is provided, it will log a warning
// for each attribute with invalid UTF-8.
func SanitizeUTF8(config *SanitizeUTF8Config, logger *zap.Logger) AttributeTransformer {
	if config.LogSanitizations && logger == nil {
		logger = zap.NewNop()
	}

	return func(kv attribute.KeyValue) (attribute.Value, bool) {
		if kv.Value.Type() != attribute.STRING {
			return kv.Value, false
		}
		strValue := kv.Value.AsString()
		if strValue == "" || utf8.ValidString(strValue) {
			return kv.Value, false
		}
		if config.LogSanitizations {
			logger.Warn("Invalid UTF-8 in span attribute, sanitizing",
				zap.String("key", string(kv.Key)),
				zap.String("value", strValue),
			)
		}
		return attribute.StringValue(strings.ToValidUTF8(strValue, "\ufffd")), true
	}
}
