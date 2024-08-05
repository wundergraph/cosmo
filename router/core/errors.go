package core

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"net"
	"net/http"

	"github.com/hashicorp/go-multierror"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

type errorType int

const (
	errorTypeUnknown errorType = iota
	errorTypeRateLimit
	errorTypeUnauthorized
	errorTypeContextCanceled
	errorTypeContextTimeout
	errorTypeUpgradeFailed
	errorTypeEDFS
	errorTypeInvalidWsSubprotocol
)

type (
	GraphQLErrorResponse struct {
		Errors     []graphqlError `json:"errors"`
		Data       any            `json:"data"`
		Extensions *Extensions    `json:"extensions,omitempty"`
	}

	Extensions struct {
		RateLimit     json.RawMessage `json:"rateLimit,omitempty"`
		Authorization json.RawMessage `json:"authorization,omitempty"`
		Trace         json.RawMessage `json:"trace,omitempty"`
		StatusCode    int             `json:"statusCode,omitempty"`
	}
)

func getErrorType(err error) errorType {
	if errors.Is(err, ErrRateLimitExceeded) {
		return errorTypeRateLimit
	}
	if errors.Is(err, ErrUnauthorized) {
		return errorTypeUnauthorized
	}
	if errors.Is(err, context.Canceled) {
		return errorTypeContextCanceled
	}
	var upgradeErr *ErrUpgradeFailed
	if errors.As(err, &upgradeErr) {
		return errorTypeUpgradeFailed
	}
	var nErr net.Error
	if errors.As(err, &nErr) {
		if nErr.Timeout() {
			return errorTypeContextTimeout
		}
	}
	var edfsErr *pubsub.Error
	if errors.As(err, &edfsErr) {
		return errorTypeEDFS
	}
	var invalidWsSubprotocolErr graphql_datasource.InvalidWsSubprotocolError

	if errors.As(err, &invalidWsSubprotocolErr) {
		return errorTypeInvalidWsSubprotocol
	}
	return errorTypeUnknown
}

func logInternalErrorsFromReport(report *operationreport.Report, requestLogger *zap.Logger) {
	var internalErr error
	for _, err := range report.InternalErrors {
		internalErr = multierror.Append(internalErr, err)
	}

	if internalErr != nil {
		requestLogger.Error("internal error", zap.Error(internalErr))
	}
}

// trackResponseError sets the final response error on the request context and
// attaches it to the span. This is used to process the error in the outer middleware
// and therefore only intended to be used in the GraphQL handler.
func trackResponseError(ctx context.Context, err error) {
	if err == nil {
		return
	}

	reqCtx := getRequestContext(ctx)
	if reqCtx == nil {
		return
	}

	reqCtx.error = err

	rtrace.AttachErrToSpan(trace.SpanFromContext(ctx), err)
}

// propagateSubgraphErrors propagates the subgraph errors to the request context
func propagateSubgraphErrors(ctx *resolve.Context, logger *zap.Logger) {
	err := ctx.SubgraphErrors()

	if err != nil {
		logger.Error("subgraph errors", zap.Error(err))
		trackResponseError(ctx.Context(), err)
	}
}

// writeRequestErrors writes the given request errors to the http.ResponseWriter.
// It accepts a graphqlerrors.RequestErrors object and writes it to the response based on the GraphQL spec.
func writeRequestErrors(r *http.Request, w http.ResponseWriter, statusCode int, requestErrors graphqlerrors.RequestErrors, requestLogger *zap.Logger) {
	if requestErrors != nil {
		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}
		if r.URL.Query().Has("wg_sse") {
			_, err := w.Write([]byte("event: next\ndata: "))
			if err != nil {
				if requestLogger != nil {
					requestLogger.Error("error writing response", zap.Error(err))
				}
				return
			}
		}
		if _, err := requestErrors.WriteResponse(w); err != nil {
			if requestLogger != nil {
				requestLogger.Error("error writing response", zap.Error(err))
			}
		}
	}
}

// writeOperationError writes the given error to the http.ResponseWriter but evaluates the error type first.
// It also logs additional information about the error.
func writeOperationError(r *http.Request, w http.ResponseWriter, requestLogger *zap.Logger, err error) {
	var reportErr ReportError
	var inputErr InputError
	var poNotFoundErr *persistedoperation.PersistentOperationNotFoundError
	switch {
	case errors.As(err, &inputErr):
		requestLogger.Debug(inputErr.Error())
		writeRequestErrors(r, w, inputErr.StatusCode(), graphqlerrors.RequestErrorsFromError(err), requestLogger)
	case errors.As(err, &poNotFoundErr):
		requestLogger.Debug("persisted operation not found",
			zap.String("sha256Hash", poNotFoundErr.Sha256Hash),
			zap.String("clientName", poNotFoundErr.ClientName))
		writeRequestErrors(r, w, http.StatusBadRequest, graphqlerrors.RequestErrorsFromError(errors.New("persisted Query not found")), requestLogger)
	case errors.As(err, &reportErr):
		report := reportErr.Report()
		logInternalErrorsFromReport(reportErr.Report(), requestLogger)

		requestErrors := graphqlerrors.RequestErrorsFromOperationReport(*report)
		if len(requestErrors) > 0 {
			writeRequestErrors(r, w, http.StatusOK, requestErrors, requestLogger)
			return
		} else {
			// there was no external errors to return to user,
			// so we return an internal server error
			writeRequestErrors(r, w, http.StatusInternalServerError, graphqlerrors.RequestErrorsFromError(errInternalServer), requestLogger)
		}
	default: // If we have an unknown error, we log it and return an internal server error
		requestLogger.Error("unknown operation error", zap.Error(err))
		writeRequestErrors(r, w, http.StatusInternalServerError, graphqlerrors.RequestErrorsFromError(errInternalServer), requestLogger)
	}
}
