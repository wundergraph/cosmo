package graphql

import (
	"errors"
	"github.com/buger/jsonparser"
	"github.com/go-chi/chi/middleware"
	"github.com/wundergraph/cosmo/router/pkg/contextx"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/pool"
	ctrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"io"
	"net/http"
)

type PreHandlerOptions struct {
	Logger          *zap.Logger
	Pool            *pool.Pool
	RenameTypeNames []resolve.RenameTypeName
	PlanConfig      plan.Configuration
}

type PreHandler struct {
	log             *zap.Logger
	pool            *pool.Pool
	renameTypeNames []resolve.RenameTypeName
	planConfig      plan.Configuration
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:             opts.Logger,
		pool:            opts.Pool,
		renameTypeNames: opts.RenameTypeNames,
		planConfig:      opts.PlanConfig,
	}
}

func (h *PreHandler) Handler(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		buf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(buf)
		_, err := io.Copy(buf, r.Body)
		if err != nil {
			requestLogger.Error("failed to read request body", zap.Error(err))
			writeRequestErrors(graphql.RequestErrorsFromError(errors.New("bad request")), w, requestLogger)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		body := buf.Bytes()

		requestQuery, _ := jsonparser.GetString(body, "query")
		requestOperationName, _ := jsonparser.GetString(body, "operationName")
		requestVariables, _, _, _ := jsonparser.Get(body, "variables")
		requestOperationType := ""

		shared := h.pool.GetSharedFromRequest(r, h.planConfig, pool.Config{
			RenameTypeNames: h.renameTypeNames,
		})
		defer h.pool.PutShared(shared)
		shared.Ctx.Variables = requestVariables
		shared.Doc.Input.ResetInputString(requestQuery)
		shared.Parser.Parse(shared.Doc, shared.Report)

		// If the operationName is not set, we try to get it from the named operation in the document
		if requestOperationName == "" {
			if len(shared.Doc.OperationDefinitions) == 1 {
				requestOperationName = shared.Doc.Input.ByteSlice(shared.Doc.OperationDefinitions[0].Name).String()
			}
		}

		// If multiple operations are defined, but no operationName is set, we return an error
		if len(shared.Doc.OperationDefinitions) > 1 && requestOperationName == "" {
			requestLogger.Error("operation name is required when multiple operations are defined")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte("operation name is required when multiple operations are defined"))
			return
		}

		// Extract the operation type from the first operation that matches the operationName
		for _, op := range shared.Doc.OperationDefinitions {
			if shared.Doc.Input.ByteSlice(op.Name).String() == requestOperationName {
				switch op.OperationType {
				case ast.OperationTypeQuery:
					requestOperationType = "query"
				case ast.OperationTypeMutation:
					requestOperationType = "mutation"
				case ast.OperationTypeSubscription:
					requestOperationType = "subscription"
				}
				break
			}
		}

		ctxWithOperation := contextx.WithOperationContext(r.Context(), &contextx.OperationContext{
			Name:    requestOperationName,
			Type:    requestOperationType,
			Content: requestQuery,
			Plan:    shared,
		})

		// Make it available in the request context as well for metrics etc.
		r = r.WithContext(ctxWithOperation)

		// Add the operation to the trace span
		span := trace.SpanFromContext(r.Context())

		// Set the span name to the operation name after we figured it out
		span.SetName(ctrace.SpanNameFormatter(requestOperationName, r))

		span.SetAttributes(otel.WgOperationName.String(requestOperationName))
		span.SetAttributes(otel.WgOperationType.String(requestOperationType))
		span.SetAttributes(otel.WgOperationContent.String(requestQuery))

		// Add client info to trace span
		clientName := ctrace.GetClientInfo(r.Header, "graphql-client-name", "apollographql-client-name", "unknown")
		clientVersion := ctrace.GetClientInfo(r.Header, "graphql-client-version", "apollographql-client-version", "missing")
		span.SetAttributes(otel.WgClientName.String(clientName))
		span.SetAttributes(otel.WgClientVersion.String(clientVersion))

		if shared.Report.HasErrors() {
			logInternalErrors(shared.Report, requestLogger)
			w.WriteHeader(http.StatusBadRequest)
			writeRequestErrorsFromReport(shared.Report, w, requestLogger)
			return
		}

		// Add the operation to the context, so we can access it later in custom transports etc.
		shared.Ctx = shared.Ctx.WithContext(ctxWithOperation)

		next.ServeHTTP(w, r)
	}

	return http.HandlerFunc(fn)
}
