package observability

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestLoggingHelpersEmitStructuredInfoEntries(t *testing.T) {
	core, observed := observer.New(zapcore.InfoLevel)
	logger := zap.New(core)

	LogSessionLifecycle(logger, "created", "session-1", zap.String("storage", "memory"))
	LogTranspileFailure(logger, "session-1", "Unexpected \";\"")
	LogElicitationOutcome(logger, "session-1", false, "operator declined")
	LogToolInvocationFailure(logger, "session-1", "getOrders", errors.New("upstream timeout"))

	entries := observed.AllUntimed()
	require.Len(t, entries, 4)
	assert.Equal(t, []observer.LoggedEntry{
		{
			Entry:   zapcore.Entry{Level: zapcore.InfoLevel, Message: "code mode session lifecycle"},
			Context: []zapcore.Field{zap.String("event", "created"), zap.String("session_id", "session-1"), zap.String("storage", "memory")},
		},
		{
			Entry:   zapcore.Entry{Level: zapcore.InfoLevel, Message: "code mode transpile failure"},
			Context: []zapcore.Field{zap.String("session_id", "session-1"), zap.String("diagnostic", "Unexpected \";\"")},
		},
		{
			Entry:   zapcore.Entry{Level: zapcore.InfoLevel, Message: "code mode elicitation outcome"},
			Context: []zapcore.Field{zap.String("session_id", "session-1"), zap.Bool("approved", false), zap.String("reason", "operator declined")},
		},
		{
			Entry:   zapcore.Entry{Level: zapcore.InfoLevel, Message: "code mode tool invocation failure"},
			Context: []zapcore.Field{zap.String("session_id", "session-1"), zap.String("op_name", "getOrders"), zap.Error(errors.New("upstream timeout"))},
		},
	}, entries)
}
