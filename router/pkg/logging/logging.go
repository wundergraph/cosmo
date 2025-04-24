package logging

import (
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const (
	requestIDField               = "request_id"
	traceIDField                 = "trace_id"
	batchRequestOperationIDField = "batched_request_operation_id"
)

type RequestIDKey struct{}

func New(pretty bool, development bool, level zapcore.Level) *zap.Logger {
	return NewZapLogger(zapcore.AddSync(os.Stdout), pretty, true, development, level)
}

func zapBaseEncoderConfig() zapcore.EncoderConfig {
	ec := zap.NewProductionEncoderConfig()
	ec.EncodeDuration = zapcore.SecondsDurationEncoder
	ec.TimeKey = "time"
	return ec
}

func ZapJsonEncoder() zapcore.Encoder {
	ec := zapBaseEncoderConfig()
	ec.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
		nanos := t.UnixNano()
		millis := int64(math.Trunc(float64(nanos) / float64(time.Millisecond)))
		enc.AppendInt64(millis)
	}
	return zapcore.NewJSONEncoder(ec)
}

func zapConsoleEncoder() zapcore.Encoder {
	ec := zapBaseEncoderConfig()
	ec.ConsoleSeparator = " "
	ec.EncodeTime = zapcore.TimeEncoderOfLayout("15:04:05 PM")
	ec.EncodeLevel = zapcore.CapitalColorLevelEncoder
	return zapcore.NewConsoleEncoder(ec)
}

func attachBaseFields(logger *zap.Logger) *zap.Logger {
	host, err := os.Hostname()
	if err != nil {
		host = "unknown"
	}

	logger = logger.With(
		zap.String("hostname", host),
		zap.Int("pid", os.Getpid()),
	)

	return logger
}

func defaultZapCoreOptions(stacktrace, development bool) []zap.Option {
	var zapOpts []zap.Option

	if development {
		zapOpts = append(zapOpts,
			zap.AddCaller(),
		)
	}
	if stacktrace {
		// Stacktrace is included on logs of ErrorLevel and above.
		zapOpts = append(zapOpts,
			zap.AddStacktrace(zap.ErrorLevel),
		)
	}

	return zapOpts
}

func NewZapLoggerWithCore(core zapcore.Core, stacktrace, development bool) *zap.Logger {
	zapLogger := zap.New(core, defaultZapCoreOptions(stacktrace, development)...)

	zapLogger = attachBaseFields(zapLogger)

	return zapLogger
}

func NewZapLogger(syncer zapcore.WriteSyncer, pretty, stacktrace, development bool, level zapcore.Level) *zap.Logger {
	var encoder zapcore.Encoder

	if pretty {
		encoder = zapConsoleEncoder()
	} else {
		encoder = ZapJsonEncoder()
	}

	c := zapcore.NewCore(
		encoder,
		syncer,
		level,
	)
	zapLogger := zap.New(c, defaultZapCoreOptions(stacktrace, development)...)
	zapLogger = attachBaseFields(zapLogger)

	return zapLogger
}

func NewZapAccessLogger(syncer zapcore.WriteSyncer, level zapcore.Level, stacktrace, development, pretty bool) *zap.Logger {
	var encoder zapcore.Encoder

	if pretty {
		encoder = zapConsoleEncoder()
	} else {
		encoder = ZapJsonEncoder()
	}

	c := zapcore.NewCore(
		encoder,
		syncer,
		level,
	)
	zapLogger := zap.New(c, defaultZapCoreOptions(stacktrace, development)...)
	zapLogger = attachBaseFields(zapLogger)

	return zapLogger
}

type BufferedLogger struct {
	Logger              *zap.Logger
	bufferedWriteSyncer *zapcore.BufferedWriteSyncer
}

type BufferedLoggerOptions struct {
	WS            *os.File
	BufferSize    int
	FlushInterval time.Duration
	Stacktrace    bool
	Development   bool
	Level         zapcore.Level
	Pretty        bool
}

func NewJSONZapBufferedLogger(options BufferedLoggerOptions) (*BufferedLogger, error) {
	fl := &BufferedLogger{}

	fl.bufferedWriteSyncer = &zapcore.BufferedWriteSyncer{
		WS:            options.WS,
		Size:          options.BufferSize,
		FlushInterval: options.FlushInterval,
	}

	fl.Logger = NewZapAccessLogger(fl.bufferedWriteSyncer, options.Level, options.Stacktrace, options.Development, options.Pretty)

	return fl, nil
}

func (f *BufferedLogger) Close() error {
	return f.bufferedWriteSyncer.Stop()
}

func NewLogFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0644)
}

func ZapLogLevelFromString(logLevel string) (zapcore.Level, error) {
	switch strings.ToUpper(logLevel) {
	case "DEBUG":
		return zap.DebugLevel, nil
	case "INFO":
		return zap.InfoLevel, nil
	case "WARNING":
		return zap.WarnLevel, nil
	case "ERROR":
		return zap.ErrorLevel, nil
	case "FATAL":
		return zap.FatalLevel, nil
	case "PANIC":
		return zap.PanicLevel, nil
	default:
		return -1, fmt.Errorf("unknown log level: %s", logLevel)
	}
}

func WithRequestID(reqID string) zap.Field {
	return zap.String(requestIDField, reqID)
}

func WithBatchedRequestOperationID(id string) zap.Field {
	return zap.String(batchRequestOperationIDField, id)
}

func WithTraceID(traceId string) zap.Field {
	return zap.String(traceIDField, traceId)
}
