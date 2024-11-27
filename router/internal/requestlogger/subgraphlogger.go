package requestlogger

import (
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"net/http"
)

type accessLogger struct {
	timeFormat            string
	utc                   bool
	skipPaths             []string
	ipAnonymizationConfig *IPAnonymizationConfig
	traceID               bool // optionally log Open Telemetry TraceID
	fieldsHandler         ContextFunc
	baseFields            []zapcore.Field
	attributes            []config.CustomAttribute
}

type SubgraphAccessLogger struct {
	accessLogger *accessLogger
	logger       *zap.Logger
}

type SubgraphOptions struct {
	IPAnonymizationConfig *IPAnonymizationConfig
	FieldsHandler         ContextFunc
	Fields                []zapcore.Field
	Attributes            []config.CustomAttribute
}

func NewSubgraphAccessLogger(logger *zap.Logger, opts SubgraphOptions) *SubgraphAccessLogger {
	return &SubgraphAccessLogger{
		logger: logger.With(zap.String("log_type", "client/subgraph")),
		accessLogger: &accessLogger{
			baseFields:            opts.Fields,
			ipAnonymizationConfig: opts.IPAnonymizationConfig,
			traceID:               true,
			fieldsHandler:         opts.FieldsHandler,
			attributes:            opts.Attributes,
		},
	}
}

func (h *SubgraphAccessLogger) WriteRequestLog(r *http.Request, rs *http.Response, subgraphFields []zap.Field) {
	path := r.URL.Path
	fields := h.accessLogger.getRequestFields(r)
	if h.accessLogger.fieldsHandler != nil {
		fields = append(fields, h.accessLogger.fieldsHandler(h.accessLogger.attributes, nil, r, rs)...)
	}

	fields = append(subgraphFields, fields...)
	h.logger.Info(path, fields...)
}
