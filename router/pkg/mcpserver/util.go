package mcpserver

import "go.uber.org/zap"

// Logger interface as expected by the server.WithLogger function
type Logger interface {
	Infof(format string, v ...any)
	Errorf(format string, v ...any)
}

// ZapAdapter struct that wraps a zap.SugaredLogger to implement the Logger interface
type ZapAdapter struct {
	logger *zap.SugaredLogger
}

// NewZapAdapter creates a new ZapAdapter from a zap.Logger
func NewZapAdapter(zapLogger *zap.Logger) *ZapAdapter {
	return &ZapAdapter{
		logger: zapLogger.Sugar(),
	}
}

// Infof logs an informational message using Zap
func (z *ZapAdapter) Infof(format string, v ...any) {
	z.logger.Infof(format, v...)
}

// Errorf logs an error message using Zap
func (z *ZapAdapter) Errorf(format string, v ...any) {
	z.logger.Errorf(format, v...)
}
