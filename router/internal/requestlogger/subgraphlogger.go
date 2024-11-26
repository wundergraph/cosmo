package requestlogger

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"net/http"
	"net/url"
)

type accessLogger struct {
	timeFormat            string
	utc                   bool
	skipPaths             []string
	ipAnonymizationConfig *IPAnonymizationConfig
	traceID               bool // optionally log Open Telemetry TraceID
	fieldsHandler         ContextFunc
	logger                *zap.Logger
	baseFields            []zapcore.Field
}

type SubgraphAccessLogger struct {
	accessLogger *accessLogger
	logger       *zap.Logger
}

type SubgraphOptions struct {
	IPAnonymizationConfig *IPAnonymizationConfig
	FieldsHandler         ContextFunc
	Fields                []zapcore.Field
}

func NewSubgraphAccessLogger(logger *zap.Logger, opts SubgraphOptions) *SubgraphAccessLogger {
	return &SubgraphAccessLogger{
		logger: logger.With(zap.String("log_type", "client/subgraph")),
		accessLogger: &accessLogger{
			baseFields:            opts.Fields,
			ipAnonymizationConfig: opts.IPAnonymizationConfig,
			fieldsHandler:         opts.FieldsHandler,
			traceID:               true,
		},
	}
}

func (h *SubgraphAccessLogger) WriteRequestLog(url *url.URL, r *http.Request, subgraphFields []zap.Field) {
	path := url.Path
	fields := h.accessLogger.getRequestFields(url, r)
	if h.accessLogger.fieldsHandler != nil {
		fields = append(fields, h.accessLogger.fieldsHandler(nil, r)...)
	}

	fields = append(subgraphFields, fields...)
	h.logger.Info(path, fields...)
}
