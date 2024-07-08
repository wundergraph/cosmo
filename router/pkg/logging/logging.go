package logging

import (
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/yaml.v2"
)

const (
	requestIDField = "reqId"
)

type Config struct {
	PrettyLogging bool   `yaml:"pretty_logging"`
	Debug         bool   `yaml:"debug"`
	LogLevel      string `yaml:"log_level"`
	LogFile       string `yaml:"log_file"`
}

type RequestIDKey struct{}

func New(config *Config) (*zap.Logger, error) {
	level, err := ZapLogLevelFromString(config.LogLevel)
	if err != nil {
		return nil, err
	}

	consoleSyncer := zapcore.AddSync(os.Stdout)
	fileSyncer, err := getLogFileSyncer(config.LogFile)
	if err != nil {
		return nil, err
	}
	multiSyncer := zapcore.NewMultiWriteSyncer(consoleSyncer, fileSyncer)

	return newZapLogger(multiSyncer, config.PrettyLogging, config.Debug, level), nil
}

func NewFromConfigFile(configFile string) (*zap.Logger, error) {
	config, err := loadConfig(configFile)
	if err != nil {
		return nil, err
	}
	return New(config)
}

func loadConfig(configFile string) (*Config, error) {
	file, err := os.Open(configFile)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var config Config
	decoder := yaml.NewDecoder(file)
	err = decoder.Decode(&config)
	if err != nil {
		return nil, err
	}

	return &config, nil
}

func getLogFileSyncer(logFile string) (zapcore.WriteSyncer, error) {
	file, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0666)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file: %w", err)
	}
	return zapcore.AddSync(file), nil
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

func newZapLogger(syncer zapcore.WriteSyncer, prettyLogging bool, debug bool, level zapcore.Level) *zap.Logger {
	var encoder zapcore.Encoder
	var zapOpts []zap.Option

	if prettyLogging {
		encoder = zapConsoleEncoder()
	} else {
		encoder = ZapJsonEncoder()
	}

	if debug {
		zapOpts = append(zapOpts, zap.AddCaller())
	}

	zapOpts = append(zapOpts, zap.AddStacktrace(zap.ErrorLevel))

	zapLogger := zap.New(zapcore.NewCore(
		encoder,
		syncer,
		level,
	), zapOpts...)

	if prettyLogging {
		return zapLogger
	}

	zapLogger = attachBaseFields(zapLogger)

	return zapLogger
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

