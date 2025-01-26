package execution_config

import (
	"bytes"
	"fmt"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"testing"
)

func TestExecutionConfiguration(t *testing.T) {
	t.Run("no compatibility version is supported", func(t *testing.T) {
		observed, logs := observer.New(zapcore.DebugLevel)
		logger := newLogger(observed)
		assert.True(t, IsRouterCompatibleWithExecutionConfig(logger, ""))
		assert.Equal(t, 0, len(logs.All()))
	})

	t.Run("same compatibility version is supported", func(t *testing.T) {
		observed, logs := observer.New(zapcore.DebugLevel)
		logger := newLogger(observed)
		assert.True(t, IsRouterCompatibleWithExecutionConfig(logger, fmt.Sprintf("%d:0.1.0", RouterCompatibilityVersionThreshold)))
		assert.Equal(t, 0, len(logs.All()))
	})

	t.Run("return an error if compatibility version is unparsable #1", func(t *testing.T) {
		observed, logs := observer.New(zapcore.DebugLevel)
		logger := newLogger(observed)
		compatibilityVersion := "nonsense"
		assert.False(t, IsRouterCompatibleWithExecutionConfig(logger, compatibilityVersion))
		logsSlice := logs.All()
		assert.Equal(t, 1, len(logsSlice))
		assert.Equal(t, compatibilityVersionParseErrorMessage, logsSlice[0].Message)
		assert.Equal(t, zapcore.ErrorLevel, logsSlice[0].Level)
		assert.Equal(t, 1, len(logsSlice[0].Context))
		assert.Equal(t, zap.String("compatibility_version", compatibilityVersion), logsSlice[0].Context[0])
	})

	t.Run("return an error if compatibility version is unparsable #2", func(t *testing.T) {
		observed, logs := observer.New(zapcore.DebugLevel)
		logger := newLogger(observed)
		compatibilityVersion := "1:2:3"
		assert.False(t, IsRouterCompatibleWithExecutionConfig(logger, compatibilityVersion))
		logsSlice := logs.All()
		assert.Equal(t, 1, len(logsSlice))
		assert.Equal(t, compatibilityVersionParseErrorMessage, logsSlice[0].Message)
		assert.Equal(t, zapcore.ErrorLevel, logsSlice[0].Level)
		assert.Equal(t, 1, len(logsSlice[0].Context))
		assert.Equal(t, zap.String("compatibility_version", compatibilityVersion), logsSlice[0].Context[0])
	})

	t.Run("return an error if the router compatibility version is unparsable", func(t *testing.T) {
		observed, logs := observer.New(zapcore.DebugLevel)
		logger := newLogger(observed)
		compatibilityVersion := "a:0.1.0"
		assert.False(t, IsRouterCompatibleWithExecutionConfig(logger, compatibilityVersion))
		logsSlice := logs.All()
		assert.Equal(t, 1, len(logsSlice))
		assert.Equal(t, routerCompatibilityVersionParseErrorMessage, logsSlice[0].Message)
		assert.Equal(t, zapcore.ErrorLevel, logsSlice[0].Level)
		assert.Equal(t, 1, len(logsSlice[0].Context))
		assert.Equal(t, zap.String("compatibility_version", compatibilityVersion), logsSlice[0].Context[0])
	})

	t.Run("return an error if the maximum router compatibility version threshold of the router is exceeded", func(t *testing.T) {
		observed, logs := observer.New(zapcore.DebugLevel)
		logger := newLogger(observed)
		nextVersion := int64(RouterCompatibilityVersionThreshold + 1)
		compVersion := "0.1.0"
		compatibilityVersion := fmt.Sprintf("%d:%s", nextVersion, compVersion)
		assert.False(t, IsRouterCompatibleWithExecutionConfig(logger, compatibilityVersion))
		logsSlice := logs.All()
		assert.Equal(t, 1, len(logsSlice))
		assert.Equal(t, executionConfigVersionThresholdExceededError(nextVersion), logsSlice[0].Message)
		assert.Equal(t, zapcore.ErrorLevel, logsSlice[0].Level)
		assert.Equal(t, 2, len(logsSlice[0].Context))
		assert.Equal(t, zap.Int64("router_compatibility_version", nextVersion), logsSlice[0].Context[0])
		assert.Equal(t, zap.String("composition_package_version", compVersion), logsSlice[0].Context[1])
	})

	t.Run("return a warning if the router compatibility version is insufficient", func(t *testing.T) {
		observed, logs := observer.New(zapcore.DebugLevel)
		logger := newLogger(observed)
		previousVersion := int64(RouterCompatibilityVersionThreshold - 1)
		compVersion := "0.1.0"
		compatibilityVersion := fmt.Sprintf("%d:%s", previousVersion, compVersion)
		assert.True(t, IsRouterCompatibleWithExecutionConfig(logger, compatibilityVersion))
		logsSlice := logs.All()
		assert.Equal(t, 1, len(logsSlice))
		assert.Equal(t, executionConfigVersionInsufficientWarning(previousVersion), logsSlice[0].Message)
		assert.Equal(t, zapcore.WarnLevel, logsSlice[0].Level)
		assert.Equal(t, 2, len(logsSlice[0].Context))
		assert.Equal(t, zap.Int64("router_compatibility_version", previousVersion), logsSlice[0].Context[0])
		assert.Equal(t, zap.String("composition_package_version", compVersion), logsSlice[0].Context[1])
	})
}

func newLogger(observed zapcore.Core) *zap.Logger {
	var buffer bytes.Buffer
	return zap.New(
		zapcore.NewTee(
			zapcore.NewCore(zapcore.NewJSONEncoder(zapcore.EncoderConfig{}), zapcore.AddSync(&buffer), zapcore.DebugLevel),
			observed,
		),
	)
}
