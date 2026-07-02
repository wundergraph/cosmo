package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"

	"github.com/hashicorp/go-multierror"
	"github.com/wundergraph/astjson"
	rErrors "github.com/wundergraph/cosmo/router/internal/errors"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource/subscriptionclient/transport"

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
	errorTypeEDFSInvalidMessage
	errorTypeMergeResult
	errorTypeStreamsHandlerError
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
		Code          string          `json:"code,omitempty"`
	}
)

const (
	ExtCodeErrPersistedQueryNotFound         = "PERSISTED_QUERY_NOT_FOUND"
	ExtCodeErrErrorRequestCanceled           = "REQUEST_CANCELED"
	ExtCodeErrBatchSizeExceeded              = "BATCH_LIMIT_EXCEEDED"
	ExtCodeErrBatchSubscriptionsUnsupported  = "BATCHING_SUBSCRIPTION_UNSUPPORTED"
	ExtCodeErrInlineArgumentValuesNotAllowed = "INLINE_ARGUMENT_VALUES_NOT_ALLOWED"
)

// isTerminalSubscriptionError reports whether the given error, when surfaced
// from the resolver during a subscription, should terminate the stream rather
// than being delivered inline as a per-update error. These are errors that
// invalidate the whole subscription (auth reject, upgrade failure, rate limit)
// — continuing to deliver updates after one of these wouldn't be meaningful.
func isTerminalSubscriptionError(err error) bool {
	switch getErrorType(err) {
	case errorTypeUnauthorized,
		errorTypeUpgradeFailed,
		errorTypeInvalidWsSubprotocol,
		errorTypeRateLimit,
		errorTypeContextCanceled,
		errorTypeContextTimeout:
		return true
	}
	return false
}

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
	var upgradeErr transport.ErrFailedUpgrade
	if errors.As(err, &upgradeErr) {
		return errorTypeUpgradeFailed
	}
	var nErr net.Error
	if errors.As(err, &nErr) {
		if nErr.Timeout() {
			return errorTypeContextTimeout
		}
	}
	var edfsErr *datasource.Error
	if errors.As(err, &edfsErr) {
		return errorTypeEDFS
	}
	var streamsHandlerErr *StreamHandlerError
	if errors.As(err, &streamsHandlerErr) {
		return errorTypeStreamsHandlerError
	}
	var invalidWsSubprotocolErr transport.ErrInvalidSubprotocol
	if errors.As(err, &invalidWsSubprotocolErr) {
		return errorTypeInvalidWsSubprotocol
	}
	var jsonParseErr *astjson.ParseError
	if errors.As(err, &jsonParseErr) {
		return errorTypeEDFSInvalidMessage
	}
	var mergeResultErr resolve.ErrMergeResult
	if errors.As(err, &mergeResultErr) {
		return errorTypeMergeResult
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

// trackFinalResponseError sets the final response error on the request context and
// attaches it to the span. This is used to process the error in the outer middleware
// and therefore only intended to be used in the GraphQL handler.
// Client disconnections (context.Canceled) are tracked separately and do not mark
// the span as ERROR or count toward error metrics, since they are not server-side failures.
func trackFinalResponseError(ctx context.Context, err error) {
	if err == nil {
		return
	}

	requestContext := getRequestContext(ctx)
	if requestContext == nil {
		return
	}

	requestContext.SetError(err)

	if errors.Is(err, context.Canceled) {
		return
	}

	requestContext.graphQLErrorServices = getAggregatedSubgraphServiceNames(requestContext.error)
	requestContext.graphQLErrorCodes = getAggregatedSubgraphErrorCodes(requestContext.error)

	span := trace.SpanFromContext(ctx)
	rtrace.AttachErrToSpan(span, err)
}

func getAggregatedSubgraphErrorCodes(err error) []string {
	if unwrapped, ok := err.(multiError); ok {

		errs := unwrapped.Unwrap()

		errorCodes := make([]string, 0, len(errs))

		for _, e := range errs {
			var subgraphError *resolve.SubgraphError
			if errors.As(e, &subgraphError) {
				errorCodes = append(errorCodes, subgraphError.Codes()...)
			}
		}

		return errorCodes
	}

	return nil
}

func getSubgraphNames(ds []resolve.DataSourceInfo) []string {
	operationServiceNames := make([]string, 0, len(ds))
	for _, ds := range ds {
		operationServiceNames = append(operationServiceNames, ds.Name)
	}
	return operationServiceNames
}

func getAggregatedSubgraphServiceNames(err error) []string {
	if unwrapped, ok := err.(multiError); ok {

		errs := unwrapped.Unwrap()

		serviceNames := make([]string, 0, len(errs))

		for _, e := range errs {
			var subgraphError *resolve.SubgraphError
			if errors.As(e, &subgraphError) {
				serviceNames = append(serviceNames, subgraphError.DataSourceInfo.Name)
			}
		}

		return unique.SliceElements(serviceNames)
	}

	return nil
}

// propagateSubgraphErrors propagates the subgraph errors to the request context
func propagateSubgraphErrors(ctx *resolve.Context) {
	err := ctx.SubgraphErrors()
	if err != nil {
		trackFinalResponseError(ctx.Context(), err)
	}
}

// writeRawErrorBody routes a pre-built JSON error body ({"errors":[...]}) through the correct
// transport framing (SSE, multipart, or plain JSON). All pre-execution error responses funnel
// through here; use it directly when the error payload cannot be expressed as
// graphqlerrors.RequestErrors (e.g. when the extensions object has a custom nested shape).
func writeRawErrorBody(r *http.Request, w http.ResponseWriter, statusCode int, body []byte, logger *zap.Logger, headerPropagation *HeaderPropagation) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")

	// According to the tests requestContext can be nil (when called from module WriteResponseError)
	// As such we have coded this condition defensively to be safe
	requestContext := getRequestContext(r.Context())
	isSubscription := requestContext != nil && requestContext.operation != nil && requestContext.operation.opType == "subscription"

	// We only want to apply header propagation for non-subscription operations
	// In certain cases the requestContext can be nil, e.g.:- when called from the batch handler
	if headerPropagation != nil && requestContext != nil && !isSubscription {
		if err := headerPropagation.ApplyRouterResponseHeaderRules(w, requestContext); err != nil && logger != nil {
			logger.Error("Failed to apply router response header rules on error cases", zap.Error(err))
		}
	}

	wgRequestParams := NegotiateSubscriptionParams(r, !isSubscription)

	switch {
	case wgRequestParams.UseSse:
		setSubscriptionHeaders(wgRequestParams, r, w)
		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}
		if _, err := fmt.Fprintf(w, "event: next\ndata: %s\n\n", body); err != nil {
			logWriteResponseError(logger, err)
		}
	case wgRequestParams.UseMultipart:
		setSubscriptionHeaders(wgRequestParams, r, w)
		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}
		if err := writeMultipartError(w, body, isSubscription); err != nil && logger != nil {
			logger.Error("error writing multipart response", zap.Error(err))
		}
	default:
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}
		if _, err := w.Write(body); err != nil {
			logWriteResponseError(logger, err)
		}
	}
}

func logWriteResponseError(logger *zap.Logger, err error) {
	if logger == nil {
		return
	}
	if rErrors.IsBrokenPipe(err) {
		logger.Warn("Broken pipe, error writing response", zap.Error(err))
		return
	}
	logger.Error("Error writing response", zap.Error(err))
}

// writeRequestErrorsParams contains parameters for writing request errors to the response.
type writeRequestErrorsParams struct {
	request           *http.Request
	writer            http.ResponseWriter
	statusCode        int
	requestErrors     graphqlerrors.RequestErrors
	logger            *zap.Logger
	headerPropagation *HeaderPropagation
}

// writeRequestErrors writes the given request errors to the http.ResponseWriter.
// It accepts a graphqlerrors.RequestErrors object and writes it to the response based on the GraphQL spec.
func writeRequestErrors(params writeRequestErrorsParams) {
	if params.requestErrors == nil {
		return
	}

	response := graphqlerrors.Response{
		Errors: params.requestErrors,
	}
	body, err := response.Marshal()
	if err != nil {
		if params.logger != nil {
			params.logger.Error("Error marshalling request errors", zap.Error(err))
		}
		params.writer.WriteHeader(http.StatusInternalServerError)
		return
	}

	writeRawErrorBody(params.request, params.writer, params.statusCode, body, params.logger, params.headerPropagation)
}

// writeMultipartError writes the error response in a multipart format with proper boundaries and headers.
func writeMultipartError(w http.ResponseWriter, body []byte, isSubscription bool) error {
	// Start with the multipart boundary
	prefix := GetWriterPrefix(false, true, true)
	if _, err := w.Write([]byte(prefix)); err != nil {
		return err
	}

	resp, err := wrapMultipartMessage(body, isSubscription)
	if err != nil {
		return err
	}

	// The multipart spec requires us to use both CRLF (\r and \n) characters together. Since we didn't do this
	// before, some clients that rely on both CR and LF strictly to parse blocks were broken and not parsing our
	// multipart chunks correctly. With this fix here (and in a few other places) the clients are now working.
	resp = append(resp, []byte("\r\n--graphql--")...)

	if _, err := w.Write(resp); err != nil {
		return err
	}

	// Flush the response
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	return nil
}

func requestErrorsFromHttpError(httpErr HttpError) graphqlerrors.RequestErrors {
	requestErr := graphqlerrors.RequestError{
		Message: httpErr.Error(),
	}
	if httpErr.ExtensionCode() != "" {
		requestErr.Extensions = &graphqlerrors.Extensions{
			Code: httpErr.ExtensionCode(),
		}
	}
	return graphqlerrors.RequestErrors{requestErr}
}

// writeOperationError writes the given error to the http.ResponseWriter but evaluates the error type first.
// It also logs additional information about the error.
func writeOperationError(r *http.Request, w http.ResponseWriter, requestLogger *zap.Logger, err error, propagation *HeaderPropagation) {
	requestLogger.Debug("operation error", zap.Error(err))

	var reportErr ReportError
	var httpErr HttpError
	var poNotFoundErr *persistedoperation.PersistentOperationNotFoundError
	switch {
	case errors.Is(err, context.Canceled):
		newErr := NewHttpGraphqlError("request canceled", ExtCodeErrErrorRequestCanceled, http.StatusOK)
		writeRequestErrors(writeRequestErrorsParams{
			request:           r,
			writer:            w,
			statusCode:        http.StatusOK,
			requestErrors:     requestErrorsFromHttpError(newErr),
			logger:            requestLogger,
			headerPropagation: propagation,
		})
	case errors.As(err, &httpErr):
		writeRequestErrors(writeRequestErrorsParams{
			request:           r,
			writer:            w,
			statusCode:        httpErr.StatusCode(),
			requestErrors:     requestErrorsFromHttpError(httpErr),
			logger:            requestLogger,
			headerPropagation: propagation,
		})
	case errors.As(err, &poNotFoundErr):
		newErr := NewHttpGraphqlError("PersistedQueryNotFound", ExtCodeErrPersistedQueryNotFound, http.StatusOK)
		writeRequestErrors(writeRequestErrorsParams{
			request:           r,
			writer:            w,
			statusCode:        http.StatusOK,
			requestErrors:     requestErrorsFromHttpError(newErr),
			logger:            requestLogger,
			headerPropagation: propagation,
		})
	case errors.As(err, &reportErr):
		report := reportErr.Report()
		logInternalErrorsFromReport(reportErr.Report(), requestLogger)

		statusCode, requestErrors := graphqlerrors.RequestErrorsFromOperationReportWithStatusCode(*report)
		if len(requestErrors) > 0 {
			writeRequestErrors(writeRequestErrorsParams{
				request:           r,
				writer:            w,
				statusCode:        statusCode,
				requestErrors:     requestErrors,
				logger:            requestLogger,
				headerPropagation: propagation,
			})
			return
		} else {
			// there were no external errors to return to user, so we return an internal server error
			writeRequestErrors(writeRequestErrorsParams{
				request:           r,
				writer:            w,
				statusCode:        http.StatusInternalServerError,
				requestErrors:     graphqlerrors.RequestErrorsFromError(errInternalServer),
				logger:            requestLogger,
				headerPropagation: propagation,
			})
		}
	default:
		writeRequestErrors(writeRequestErrorsParams{
			request:           r,
			writer:            w,
			statusCode:        http.StatusInternalServerError,
			requestErrors:     graphqlerrors.RequestErrorsFromError(errInternalServer),
			logger:            requestLogger,
			headerPropagation: propagation,
		})
	}
}

type ExprWrapError struct {
	Err error
}

func (e *ExprWrapError) Error() string {
	if e.Err == nil {
		return ""
	}
	return e.Err.Error()
}

func WrapExprError(err error) error {
	if err == nil {
		return nil
	}
	return &ExprWrapError{Err: err}
}
