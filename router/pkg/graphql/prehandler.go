package graphql

import (
	"errors"
	"github.com/buger/jsonparser"
	"github.com/go-chi/chi/middleware"
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
	Definition      *ast.Document
}

type PreHandler struct {
	log             *zap.Logger
	pool            *pool.Pool
	renameTypeNames []resolve.RenameTypeName
	planConfig      plan.Configuration
	definition      *ast.Document
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:             opts.Logger,
		pool:            opts.Pool,
		renameTypeNames: opts.RenameTypeNames,
		planConfig:      opts.PlanConfig,
		definition:      opts.Definition,
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

		if shared.Report.HasErrors() {
			logInternalErrors(shared.Report, requestLogger)
			w.WriteHeader(http.StatusBadRequest)
			writeRequestErrorsFromReport(shared.Report, w, requestLogger)
			return
		}

		// Add the operation to the trace span
		span := trace.SpanFromContext(r.Context())

		// Set the span name to the operation name after we figured it out
		span.SetName(requestOperationName)

		span.SetAttributes(otel.WgOperationName.String(requestOperationName))
		span.SetAttributes(otel.WgOperationType.String(requestOperationType))
		span.SetAttributes(otel.WgOperationContent.String(requestQuery))

		// Add client info to trace span
		clientName := ctrace.GetClientInfo(r.Header, "graphql-client-name", "apollographql-client-name", "unknown")
		clientVersion := ctrace.GetClientInfo(r.Header, "graphql-client-version", "apollographql-client-version", "missing")
		span.SetAttributes(otel.WgClientName.String(clientName))
		span.SetAttributes(otel.WgClientVersion.String(clientVersion))

		requestOperationNameBytes := []byte(requestOperationName)

		if requestOperationName == "" {
			shared.Normalizer.NormalizeOperation(shared.Doc, h.definition, shared.Report)
		} else {
			shared.Normalizer.NormalizeNamedOperation(shared.Doc, h.definition, requestOperationNameBytes, shared.Report)
		}

		if shared.Report.HasErrors() {
			logInternalErrors(shared.Report, requestLogger)
			w.WriteHeader(http.StatusBadRequest)
			writeRequestErrorsFromReport(shared.Report, w, requestLogger)
			return
		}

		// add the operation name to the hash
		// this is important for multi operation documents to have a different hash for each operation
		// otherwise, the prepared plan cache would return the same plan for all operations
		_, err = shared.Hash.Write(requestOperationNameBytes)
		if err != nil {
			requestLogger.Error("hash write failed", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// create a hash of the query to use as a key for the prepared plan cache
		// in this hash, we include the printed operation
		// and the extracted variables (see below)
		err = shared.Printer.Print(shared.Doc, h.definition, shared.Hash)
		if err != nil {
			requestLogger.Error("unable to print document", zap.Error(err))
			respondWithInternalServerError(w, requestLogger)
			return
		}

		// add the extracted variables to the hash
		_, err = shared.Hash.Write(shared.Doc.Input.Variables)
		if err != nil {
			requestLogger.Error("hash write failed", zap.Error(err))
			respondWithInternalServerError(w, requestLogger)
			return
		}

		operationID := shared.Hash.Sum64() // generate the operation ID
		shared.Hash.Reset()

		ctxWithOperation := withContext(r.Context(), &Context{
			Name:           requestOperationName,
			Type:           requestOperationType,
			OperationHash:  operationID,
			Content:        requestQuery,
			plan:           shared,
			ResponseHeader: w.Header(),
		})

		// Add the operation to the context, so we can access it later in custom transports etc.
		shared.Ctx = shared.Ctx.WithContext(ctxWithOperation)

		// Add the operation hash to the trace span attributes
		span.SetAttributes(otel.WgOperationHash.Int64(int64(operationID)))

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(w, r.WithContext(ctxWithOperation))
	}

	return http.HandlerFunc(fn)
}
