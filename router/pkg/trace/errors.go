package trace

import (
	"errors"
	"go.uber.org/zap"
)

// invalidUTF8Error matches the InvalidUTF8() method exposed by
// google.golang.org/protobuf/internal/impl.errInvalidUTF8.
type invalidUTF8Error interface {
	InvalidUTF8() bool
}

// hasInvalidUTF8Error walks the error chain looking for an error
// that implements the invalidUTF8Error interface.
func hasInvalidUTF8Error(err error) bool {
	var target invalidUTF8Error
	if errors.As(err, &target) {
		return target.InvalidUTF8()
	}
	return false
}

func errHandler(config *ProviderConfig) func(err error) {
	return func(err error) {
		if hasInvalidUTF8Error(err) {
			config.Logger.Error(
				"otel error: Enable 'telemetry.tracing.sanitize_utf8.enabled' in your config to sanitize invalid UTF-8 attributes.",
				zap.Error(err))
			return
		}
		config.Logger.Error("otel error", zap.Error(err))
	}
}
