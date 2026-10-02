package requestlogger

import (
	"context"
	"net/http"
	"slices"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
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
	exprAttributes        []ExpressionAttribute
	ignoreQueryParamsList []string
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
	ExprAttributes        []ExpressionAttribute
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
			exprAttributes:        opts.ExprAttributes,
		},
	}
}

// RequestFields returns the fields of a subgraph fetch. ctx is the fetch context,
// used when no request was sent, e.g. on a response cache hit.
func (h *SubgraphAccessLogger) RequestFields(ctx context.Context, respInfo *resolve.ResponseInfo, overrideExprCtx *expr.Context) []zap.Field {
	if respInfo == nil {
		return []zap.Field{}
	}

	request := respInfo.Request
	var fields []zap.Field
	if request != nil {
		fields = h.accessLogger.getRequestFields(request, h.logger)
		if request.URL != nil {
			fields = append(fields, zap.String("url", request.URL.String()))
		}
	} else {
		fields = slices.Clone(h.accessLogger.baseFields)
		if ctx == nil {
			ctx = context.Background()
		}
		if h.accessLogger.traceID {
			if traceID := rtrace.GetTraceID(ctx); traceID != "" {
				fields = append(fields, logging.WithTraceID(traceID))
			}
		}
		// Carries the context only, for the request scoped fields.
		request = (&http.Request{Header: http.Header{}}).WithContext(ctx)
	}
	if h.accessLogger.fieldsHandler != nil {
		fields = append(fields, h.accessLogger.fieldsHandler(h.logger, h.accessLogger.attributes, h.accessLogger.exprAttributes, respInfo.Err, request, &respInfo.ResponseHeaders, overrideExprCtx)...)
	}

	return fields
}

func (h *SubgraphAccessLogger) Info(message string, fields []zap.Field) {
	h.logger.Info(message, fields...)
}

func (h *SubgraphAccessLogger) Error(message string, fields []zap.Field) {
	h.logger.Error(message, fields...)
}
