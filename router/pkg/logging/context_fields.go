package logging

import (
	"slices"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// contextFieldsCore retains the fields attached by the logging setup and With.
// Zap's underlying core still handles encoding, levels, writes, and syncing.
type contextFieldsCore struct {
	zapcore.Core
	fields []zap.Field
}

func (c *contextFieldsCore) With(fields []zap.Field) zapcore.Core {
	return &contextFieldsCore{
		Core:   c.Core.With(fields),
		fields: slices.Concat(c.fields, fields),
	}
}

// AddContextFields adds the fields retained by this package's logging setup to
// an encoder, in attachment order. It does not emit a log entry. Loggers created
// outside this package, or whose core was replaced, may not retain these fields.
func AddContextFields(logger *zap.Logger, encoder zapcore.ObjectEncoder) {
	if core, ok := logger.Core().(*contextFieldsCore); ok {
		for _, field := range core.fields {
			field.AddTo(encoder)
		}
	}
}
