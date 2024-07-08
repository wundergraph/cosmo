package logging

import (
	"io/ioutil"
	"os"
	"testing"

	"go.uber.org/zap/zapcore"
	"github.com/stretchr/testify/assert"
)

func TestNewLogger(t *testing.T) {
	// Set up a temporary log file for testing
	logFile, err := os.CreateTemp("", "test_log.log")
	assert.NoError(t, err)
	defer os.Remove(logFile.Name())

	config := &Config{
		PrettyLogging: false,
		Debug:         false,
		LogLevel:      "info",
		LogFile:       logFile.Name(),
	}

	logger, err := New(config)
	assert.NoError(t, err)
	assert.NotNil(t, logger)

	logger.Info("This is an info message")
	logger.Error("This is an error message")
	logger.Sync()

	data, err := ioutil.ReadFile(logFile.Name())
	assert.NoError(t, err)

	logContent := string(data)
	assert.Contains(t, logContent, "This is an info message")
	assert.Contains(t, logContent, "This is an error message")
}

func TestNewLoggerWithInvalidLogFile(t *testing.T) {
	config := &Config{
		PrettyLogging: false,
		Debug:         false,
		LogLevel:      "info",
		LogFile:       "/nonexistent/path/to/logfile.log",
	}

	_, err := New(config)
	assert.Error(t, err)
}

func TestZapLogLevelFromString(t *testing.T) {
	tests := []struct {
		levelStr string
		expected zapcore.Level
		isError  bool
	}{
		{"DEBUG", zapcore.DebugLevel, false},
		{"INFO", zapcore.InfoLevel, false},
		{"WARNING", zapcore.WarnLevel, false},
		{"ERROR", zapcore.ErrorLevel, false},
		{"FATAL", zapcore.FatalLevel, false},
		{"PANIC", zapcore.PanicLevel, false},
		{"UNKNOWN", -1, true},
	}

	for _, test := range tests {
		level, err := ZapLogLevelFromString(test.levelStr)
		if test.isError {
			assert.Error(t, err)
		} else {
			assert.NoError(t, err)
			assert.Equal(t, test.expected, level)
		}
	}
}

func TestPrettyLogging(t *testing.T) {
	config := &Config{
		PrettyLogging: true,
		Debug:         false,
		LogLevel:      "info",
		LogFile:       "",
	}

	logger, err := New(config)
	assert.NoError(t, err)
	assert.NotNil(t, logger)

	// Redirect stdout to capture the output
	r, w, err := os.Pipe()
	assert.NoError(t, err)
	stdout := os.Stdout
	os.Stdout = w

	logger.Info("This is a pretty info message")
	logger.Error("This is a pretty error message")
	logger.Sync()

	w.Close()
	os.Stdout = stdout

	output, err := ioutil.ReadAll(r)
	assert.NoError(t, err)
	logContent := string(output)
	assert.Contains(t, logContent, "This is a pretty info message")
	assert.Contains(t, logContent, "This is a pretty error message")
}

func TestDebugLogging(t *testing.T) {
	config := &Config{
		PrettyLogging: false,
		Debug:         true,
		LogLevel:      "debug",
		LogFile:       "",
	}

	logger, err := New(config)
	assert.NoError(t, err)
	assert.NotNil(t, logger)

	// Redirect stdout to capture the output
	r, w, err := os.Pipe()
	assert.NoError(t, err)
	stdout := os.Stdout
	os.Stdout = w

	logger.Debug("This is a debug message")
	logger.Sync()

	w.Close()
	os.Stdout = stdout

	output, err := ioutil.ReadAll(r)
	assert.NoError(t, err)
	logContent := string(output)
	assert.Contains(t, logContent, "This is a debug message")
}

