package core

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"

	"github.com/hashicorp/go-multierror"
	"github.com/wundergraph/astjson"
	rErrors "github.com/wundergraph/cosmo/router/internal/errors"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
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
	errorTypeEDFSInvalidMessage
	errorTypeMergeResult
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
	var upgradeErr *graphql_datasource.UpgradeRequestError
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
	var invalidWsSubprotocolErr graphql_datasource.InvalidWsSubprotocolError
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
func trackFinalResponseError(ctx context.Context, err error) {
	if err == nil {
		return
	}

	span := trace.SpanFromContext(ctx)
	requestContext := getRequestContext(ctx)
	if requestContext == nil {
		return
	}

	requestContext.SetError(err)
	requestContext.graphQLErrorServices = getAggregatedSubgraphServiceNames(requestContext.error)
	requestContext.graphQLErrorCodes = getAggregatedSubgraphErrorCodes(requestContext.error)

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

// writeRequestErrors writes the given request errors to the http.ResponseWriter.
// It accepts a graphqlerrors.RequestErrors object and writes it to the response based on the GraphQL spec.
func writeRequestErrors(r *http.Request, w http.ResponseWriter, statusCode int, requestErrors graphqlerrors.RequestErrors, requestLogger *zap.Logger) {
	if requestErrors == nil {
		return
	}

	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")

	// According to the tests requestContext can be nil (when called from module WriteResponseError)
	// As such we have coded this condition defensively to be safe
	requestContext := getRequestContext(r.Context())
	isSubscription := requestContext != nil && requestContext.operation != nil && requestContext.operation.opType == "subscription"

	wgRequestParams := NegotiateSubscriptionParams(r, !isSubscription)

	// Is subscription
	if wgRequestParams.UseSse || wgRequestParams.UseMultipart {
		setSubscriptionHeaders(wgRequestParams, r, w)

		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}

		if wgRequestParams.UseSse {
			_, err := w.Write([]byte("event: next\ndata: "))
			if err != nil {
				if requestLogger != nil {
					if rErrors.IsBrokenPipe(err) {
						requestLogger.Warn("Broken pipe, error writing response", zap.Error(err))
						return
					}
					requestLogger.Error("Error writing response", zap.Error(err))
				}
				return
			}
		} else if wgRequestParams.UseMultipart {
			// Handle multipart error response
			if err := writeMultipartError(w, requestErrors, isSubscription); err != nil {
				if requestLogger != nil {
					requestLogger.Error("error writing multipart response", zap.Error(err))
				}
			}
			return
		}
	} else {
		// Regular request
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}
	}

	if _, err := requestErrors.WriteResponse(w); err != nil {
		if requestLogger != nil {
			if rErrors.IsBrokenPipe(err) {
				requestLogger.Warn("Broken pipe, error writing response", zap.Error(err))
				return
			}
			requestLogger.Error("Error writing response", zap.Error(err))
		}
	}
}

// writeMultipartError writes the error response in a multipart format with proper boundaries and headers.
func writeMultipartError(
	w http.ResponseWriter,
	requestErrors graphqlerrors.RequestErrors,
	isSubscription bool,
) error {
	// Start with the multipart boundary
	prefix := GetWriterPrefix(false, true, true)
	if _, err := w.Write([]byte(prefix)); err != nil {
		return err
	}

	// Write the actual error payload
	response := graphqlerrors.Response{
		Errors: requestErrors,
	}

	responseBytes, err := response.Marshal()
	if err != nil {
		return err
	}

	resp, err := wrapMultipartMessage(responseBytes, isSubscription)
	if err != nil {
		return err
	}

	// The multipart spec requires us to use both CRLF (\r and \n) characters together. Since we didn't do this
	// before, some clients that rely on both CR and LF strictly to parse blocks were broken and not parsing our
	// multipart chunks correctly. With this fix here (and in a few other places) the clients are now working.
	resp = append(resp, []byte("\r\n--graphql--")...)

	if _, err := w.Write([]byte(resp)); err != nil {
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
func writeOperationError(r *http.Request, w http.ResponseWriter, requestLogger *zap.Logger, err error) {
	requestLogger.Debug("operation error", zap.Error(err))

	var reportErr ReportError
	var httpErr HttpError
	var poNotFoundErr *persistedoperation.PersistentOperationNotFoundError
	switch {
	case errors.As(err, &httpErr):
		writeRequestErrors(r, w, httpErr.StatusCode(), requestErrorsFromHttpError(httpErr), requestLogger)
	case errors.As(err, &poNotFoundErr):
		newErr := NewHttpGraphqlError("PersistedQueryNotFound", "PERSISTED_QUERY_NOT_FOUND", http.StatusOK)
		writeRequestErrors(r, w, http.StatusOK, requestErrorsFromHttpError(newErr), requestLogger)
	case errors.As(err, &reportErr):
		report := reportErr.Report()
		logInternalErrorsFromReport(reportErr.Report(), requestLogger)

		statusCode, requestErrors := graphqlerrors.RequestErrorsFromOperationReportWithStatusCode(*report)
		if len(requestErrors) > 0 {
			writeRequestErrors(r, w, statusCode, requestErrors, requestLogger)
			return
		} else {
			// there were no external errors to return to user, so we return an internal server error
			writeRequestErrors(r, w, http.StatusInternalServerError, graphqlerrors.RequestErrorsFromError(errInternalServer), requestLogger)
		}
	default:
		writeRequestErrors(r, w, http.StatusInternalServerError, graphqlerrors.RequestErrorsFromError(errInternalServer), requestLogger)
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
