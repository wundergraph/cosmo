package grpcconnector

import (
	"io"
	"log"

	"github.com/hashicorp/go-hclog"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var _ hclog.Logger = &PluginLogger{}

// PluginLogger implements the hclog.Logger interface using zap.Logger.
// It provides a bridge between the hashicorp logging system and zap.
type PluginLogger struct {
	Logger *zap.Logger
}

// NewPluginLogger creates a new PluginLogger that wraps the provided zap.Logger.
func NewPluginLogger(logger *zap.Logger) *PluginLogger {
	return &PluginLogger{Logger: logger}
}

// Trace logs a message at the trace level. In this implementation,
// trace maps to the zap debug level since zap doesn't have a trace level.
func (p *PluginLogger) Trace(msg string, args ...interface{}) {
	p.Logger.Debug(msg, argsToFields(args)...)
}

// Debug logs a message at the debug level.
func (p *PluginLogger) Debug(msg string, args ...interface{}) {
	p.Logger.Debug(msg, argsToFields(args)...)
}

// Warn logs a message at the warn level.
func (p *PluginLogger) Warn(msg string, args ...interface{}) {
	p.Logger.Warn(msg, argsToFields(args)...)
}

// Error logs a message at the error level.
func (p *PluginLogger) Error(msg string, args ...interface{}) {
	p.Logger.Error(msg, argsToFields(args)...)
}

// Info logs a message at the info level.
func (p *PluginLogger) Info(msg string, args ...interface{}) {
	p.Logger.Info(msg, argsToFields(args)...)
}

// GetLevel returns the current logging level of the logger.
func (p *PluginLogger) GetLevel() hclog.Level {
	return hclog.Level(p.Logger.Level())
}

// ImpliedArgs returns the logger's implied args, which aren't used in this implementation.
func (p *PluginLogger) ImpliedArgs() []interface{} {
	return nil
}

// IsDebug checks if the current log level is debug or lower.
func (p *PluginLogger) IsDebug() bool {
	return p.Logger.Level() == zap.DebugLevel
}

// IsError checks if the current log level is error or lower.
func (p *PluginLogger) IsError() bool {
	return p.Logger.Level() == zap.ErrorLevel
}

// IsInfo checks if the current log level is info or lower.
func (p *PluginLogger) IsInfo() bool {
	return p.Logger.Level() == zap.InfoLevel
}

// IsTrace checks if the current log level is trace or lower.
// In this implementation, trace maps to debug since zap doesn't have a trace level.
func (p *PluginLogger) IsTrace() bool {
	return p.Logger.Level() == zap.DebugLevel
}

// IsWarn checks if the current log level is warn or lower.
func (p *PluginLogger) IsWarn() bool {
	return p.Logger.Level() == zap.WarnLevel
}

// Log logs a message at the specified level.
func (p *PluginLogger) Log(level hclog.Level, msg string, args ...interface{}) {
	p.Logger.Log(zapcore.Level(level), msg)
}

// Name returns the name of the logger.
func (p *PluginLogger) Name() string {
	return p.Logger.Name()
}

// Named returns a new logger with the specified name appended to the current logger's name.
func (p *PluginLogger) Named(name string) hclog.Logger {
	return &PluginLogger{Logger: p.Logger.Named(name)}
}

// ResetNamed returns a new logger with the specified name, discarding any previous name.
func (p *PluginLogger) ResetNamed(name string) hclog.Logger {
	return &PluginLogger{Logger: p.Logger.Named(name)}
}

// SetLevel sets the output level for the logger. This implementation is a no-op
// as zap loggers have immutable levels.
func (p *PluginLogger) SetLevel(level hclog.Level) {}

// StandardLogger returns a standard library logger for compatibility.
// This implementation returns nil.
func (p *PluginLogger) StandardLogger(opts *hclog.StandardLoggerOptions) *log.Logger {
	return nil
}

// StandardWriter returns a writer that can be used with the standard library logger.
// This implementation returns nil.
func (p *PluginLogger) StandardWriter(opts *hclog.StandardLoggerOptions) io.Writer {
	return nil
}

// With returns a new logger with the specified key-value pairs added as context.
func (p *PluginLogger) With(args ...interface{}) hclog.Logger {
	return &PluginLogger{Logger: p.Logger.With(argsToFields(args)...)}
}

// argsToFields converts hclog-style args (alternating key/value pairs)
// to zap.Field objects for use with zap logger methods.
func argsToFields(args []interface{}) []zap.Field {
	fields := make([]zap.Field, 0, len(args))
	for i := 0; i < len(args); i += 2 {
		fields = append(fields, zap.Any(args[i].(string), args[i+1]))
	}
	return fields
}
