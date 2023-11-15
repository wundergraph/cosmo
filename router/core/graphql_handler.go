package core

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/internal/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/go-chi/chi/middleware"
	"github.com/hashicorp/go-multierror"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
)

var (
	errMsgOperationParseFailed = errors.New("failed to parse operation")
	errCouldNotResolveResponse = errors.New("could not resolve response")
	errServerTimeout           = errors.New("server timeout")
	errServerCanceled          = errors.New("server canceled")
	errInternalServer          = errors.New("internal server error")
)

type ReportError interface {
	error
	Report() *operationreport.Report
}

type reportError struct {
	report *operationreport.Report
}

func (e *reportError) Error() string {
	if len(e.report.InternalErrors) > 0 {
		return errors.Join(e.report.InternalErrors...).Error()
	}
	var messages []string
	for _, e := range e.report.ExternalErrors {
		messages = append(messages, e.Message)
	}
	return strings.Join(messages, ", ")
}

func (e *reportError) Report() *operationreport.Report {
	return e.report
}

func MergeJsonRightIntoLeft(left, right []byte) []byte {
	if len(left) == 0 {
		return right
	}
	if len(right) == 0 {
		return left
	}
	result := gjson.ParseBytes(right)
	result.ForEach(func(key, value gjson.Result) bool {
		left, _ = sjson.SetRawBytes(left, key.Str, unsafebytes.StringToBytes(value.Raw))
		return true
	})
	return left
}

type HandlerOptions struct {
	Executor *Executor
	Log      *zap.Logger
}

func NewGraphQLHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		log:      opts.Log,
		executor: opts.Executor,
	}

	return graphQLHandler
}

// Error and Status Code handling
//
// When a server receives a well-formed GraphQL-over-HTTP request, it must return a
// well‐formed GraphQL response. The server's response describes the result of validating
// and executing the requested operation if successful, and describes any errors encountered
// during the request. This means working errors should be returned as part of the response body.
// That also implies parsing or validation errors. They should be returned as part of the response body.
// Only in cases where the request is malformed or invalid GraphQL should the server return an HTTP 4xx or 5xx error code.
// https://github.com/graphql/graphql-over-http/blob/main/spec/GraphQLOverHTTP.md#response

type GraphQLHandler struct {
	log      *zap.Logger
	executor *Executor
}

func (h *GraphQLHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
	operationCtx := getOperationContext(r.Context())

	ctx := &resolve.Context{
		Variables: operationCtx.Variables(),
		Request: resolve.Request{
			Header: r.Header,
		},
		RenameTypeNames: h.executor.RenameTypeNames,
		EnableTracing:   operationCtx.enableRequestTrace,
	}
	ctx = ctx.WithContext(r.Context())

	switch p := operationCtx.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		w.Header().Set("Content-Type", "application/json")

		executionBuf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(executionBuf)

		err := h.executor.Resolver.ResolveGraphQLResponse(ctx, p.Response, nil, executionBuf)
		if err != nil {
			var nErr net.Error

			if errors.Is(err, context.Canceled) {
				writeRequestErrors(r, graphql.RequestErrorsFromError(errServerCanceled), w, requestLogger)
			} else if errors.As(err, &nErr) && nErr.Timeout() {
				writeRequestErrors(r, graphql.RequestErrorsFromError(errServerTimeout), w, requestLogger)
			} else {
				writeRequestErrors(r, graphql.RequestErrorsFromError(errCouldNotResolveResponse), w, requestLogger)
			}

			requestLogger.Error("unable to resolve GraphQL response", zap.Error(err))
			return
		}
		_, err = executionBuf.WriteTo(w)
		if err != nil {
			requestLogger.Error("respond to client", zap.Error(err))
			return
		}
	case *plan.SubscriptionResponsePlan:
		var (
			flushWriter resolve.FlushWriter
			ok          bool
		)
		ctx, flushWriter, ok = GetFlushWriter(ctx, ctx.Variables, r, w)
		if !ok {
			requestLogger.Error("connection not flushable")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		err := h.executor.Resolver.ResolveGraphQLSubscription(ctx, p.Response, flushWriter)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				requestLogger.Debug("context canceled: unable to resolve subscription response", zap.Error(err))
				writeRequestErrors(r, graphql.RequestErrorsFromError(errCouldNotResolveResponse), w, requestLogger)
				return
			}

			requestLogger.Error("unable to resolve subscription response", zap.Error(err))
			writeRequestErrors(r, graphql.RequestErrorsFromError(errCouldNotResolveResponse), w, requestLogger)
			return
		}
	default:
		requestLogger.Error("unsupported plan kind")
		w.WriteHeader(http.StatusInternalServerError)
	}
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

func writeRequestErrors(r *http.Request, requestErrors graphql.RequestErrors, w http.ResponseWriter, requestLogger *zap.Logger) {
	ctx := getRequestContext(r.Context())
	span := trace.SpanFromContext(r.Context())

	if requestErrors != nil {

		// can be nil if an error occurred before the context was created e.g. in the pre-handler
		// in that case hasError has to be set in the pre-handler manually
		if ctx != nil {
			ctx.hasError = true
		}

		// set the span status to error
		span.SetStatus(codes.Error, requestErrors.Error())
		// set the span attribute to indicate that the request had an error
		// do it only when there is an error to avoid storing the attribute in the span
		// in queries we use mapContains to check if the attribute is set
		span.SetAttributes(otel.WgRequestError.Bool(true))

		if _, err := requestErrors.WriteResponse(w); err != nil {
			if requestLogger != nil {
				requestLogger.Error("error writing response", zap.Error(err))
			}
		}
	}
}
