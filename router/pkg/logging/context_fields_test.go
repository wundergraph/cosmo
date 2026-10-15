package logging

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestContextFields(t *testing.T) {
	t.Parallel()
	core, logs := observer.New(zapcore.InfoLevel)
	logger := NewZapLoggerWithCore(core, false, false)
	child := logger.With(zap.String("hostname", "custom-host"), zap.Int("pid", 42), zap.String("tenant", "one"))
	sibling := logger.With(zap.String("tenant", "two"))

	for _, logger := range []*zap.Logger{logger, child, sibling} {
		encoder := zapcore.NewMapObjectEncoder()
		AddContextFields(logger, encoder)
		require.Zero(t, logs.Len(), "reading context fields must not emit a log")
		logger.Debug("disabled")
		require.Zero(t, logs.Len(), "the underlying level must still apply")
		logger.Info("entry")
		entries := logs.TakeAll()
		require.Len(t, entries, 1)
		require.Equal(t, entries[0].ContextMap(), encoder.Fields)
	}

	encoder := zapcore.NewMapObjectEncoder()
	AddContextFields(child, encoder)
	require.Equal(t, "custom-host", encoder.Fields["hostname"])
	require.EqualValues(t, 42, encoder.Fields["pid"])
	require.Equal(t, "one", encoder.Fields["tenant"])

	parentFields := zapcore.NewMapObjectEncoder()
	AddContextFields(logger, parentFields)
	require.NotContains(t, parentFields.Fields, "tenant", "children must not mutate their parent")
	require.NotEmpty(t, parentFields.Fields["hostname"])
	require.Positive(t, parentFields.Fields["pid"])
}

func TestContextFieldsUntrackedLogger(t *testing.T) {
	t.Parallel()
	encoder := zapcore.NewMapObjectEncoder()
	AddContextFields(zap.NewNop(), encoder)
	require.Empty(t, encoder.Fields, "do not invent fields that were never attached")
}
