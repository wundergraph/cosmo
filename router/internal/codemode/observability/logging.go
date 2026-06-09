package observability

import (
	"go.uber.org/zap"
)

func LogSessionLifecycle(logger *zap.Logger, event string, sessionID string, fields ...zap.Field) {
	if logger == nil {
		return
	}
	allFields := append([]zap.Field{
		zap.String("event", event),
		zap.String("session_id", sessionID),
	}, fields...)
	logger.Info("code mode session lifecycle", allFields...)
}

func LogTranspileFailure(logger *zap.Logger, sessionID string, diagnostic string) {
	if logger == nil {
		return
	}
	logger.Info("code mode transpile failure",
		zap.String("session_id", sessionID),
		zap.String("diagnostic", diagnostic),
	)
}

func LogElicitationOutcome(logger *zap.Logger, sessionID string, approved bool, reason string) {
	if logger == nil {
		return
	}
	logger.Info("code mode elicitation outcome",
		zap.String("session_id", sessionID),
		zap.Bool("approved", approved),
		zap.String("reason", reason),
	)
}

func LogToolInvocationFailure(logger *zap.Logger, sessionID string, opName string, err error) {
	if logger == nil {
		return
	}
	logger.Info("code mode tool invocation failure",
		zap.String("session_id", sessionID),
		zap.String("op_name", opName),
		zap.Error(err),
	)
}
