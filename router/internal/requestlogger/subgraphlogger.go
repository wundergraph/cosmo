package requestlogger

import (
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
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

func (h *SubgraphAccessLogger) RequestFields(respInfo *resolve.ResponseInfo, subgraphFields []zap.Field) []zap.Field {
	if respInfo == nil {
		return []zap.Field{}
	}

	fields := h.accessLogger.getRequestFields(respInfo.Request)
	if respInfo.Request != nil && respInfo.Request.URL != nil {
		fields = append(fields, zap.String("url", respInfo.Request.URL.String()))
	}
	if h.accessLogger.fieldsHandler != nil {
		fields = append(fields, h.accessLogger.fieldsHandler(h.accessLogger.attributes, respInfo.Err, respInfo.Request, &respInfo.ResponseHeaders)...)
	}

	return fields
}

func (h *SubgraphAccessLogger) Info(message string, fields []zap.Field) {
	h.logger.Info(message, fields...)
}
