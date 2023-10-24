package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dgraph-io/ristretto"
	"github.com/go-chi/chi/middleware"
	"github.com/hashicorp/go-multierror"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
)

const (
	ErrMsgOperationParseFailed = "failed to parse operation: %w"
)

var (
	couldNotResolveResponseErr = errors.New("could not resolve response")
	serverTimeoutErr           = errors.New("server timeout")
	serverCanceledErr          = errors.New("server canceled")
	internalServerErrorErr     = errors.New("internal server error")
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

type planWithExtractedVariables struct {
	preparedPlan plan.Plan
	variables    []byte
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
	Cache    *ristretto.Cache
	Log      *zap.Logger
}

func NewGraphQLHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		log:         opts.Log,
		sf:          &singleflight.Group{},
		prepared:    map[uint64]planWithExtractedVariables{},
		preparedMux: &sync.RWMutex{},
		planCache:   opts.Cache,
		executor:    opts.Executor,
	}

	return graphQLHandler
}

//
// Error and Status Code handling
//
// When a server receives a well-formed GraphQL-over-HTTP request, it must return a
// well‐formed GraphQL response. The server's response describes the result of validating
// and executing the requested operation if successful, and describes any errors encountered
// during the request. This means working errors should be returned as part of the response body.
// Only in cases where the request is malformed or invalid GraphQL should the server return an HTTP 4xx or 5xx error code.
// That also implies parsing or validation errors. They should be returned as part of the response body.
// https://github.com/graphql/graphql-over-http/blob/main/spec/GraphQLOverHTTP.md#response

type GraphQLHandler struct {
	log      *zap.Logger
	executor *Executor

	prepared    map[uint64]planWithExtractedVariables
	preparedMux *sync.RWMutex

	sf        *singleflight.Group
	planCache *ristretto.Cache
}

func (h *GraphQLHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var (
		preparedPlan planWithExtractedVariables
	)

	requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
	operationContext := getOperationContext(r.Context())

	// Update the resolveCtx with the latest request context so user modules can access it

	requestOperationNameBytes := unsafebytes.StringToBytes(operationContext.Name())

	// try to get a prepared plan for this operation ID from the cache
	cachedPlan, ok := h.planCache.Get(operationContext.Hash())
	if ok && cachedPlan != nil {
		// re-use a prepared plan
		preparedPlan = cachedPlan.(planWithExtractedVariables)
	} else {
		// prepare a new plan using single flight
		// this ensures that we only prepare the plan once for this operation ID
		sharedPreparedPlan, err, _ := h.sf.Do(strconv.FormatUint(operationContext.hash, 10), func() (interface{}, error) {
			prepared, err := h.preparePlan(requestOperationNameBytes, operationContext.Content())
			if err != nil {
				return nil, err
			}
			// cache the prepared plan for 1 hour
			h.planCache.SetWithTTL(operationContext.hash, prepared, 1, time.Hour)
			return prepared, nil
		})
		if err != nil {
			w.Header().Set("Content-Type", "application/json")

			var reportErr ReportError
			if errors.As(err, &reportErr) {
				logInternalErrorsFromReport(reportErr.Report(), requestLogger)
				writeRequestErrors(r, graphql.RequestErrorsFromOperationReport(*reportErr.Report()), w, requestLogger)
				return
			}
			requestLogger.Error("prepare plan failed", zap.Error(err))
			writeRequestErrors(r, graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}

		if sharedPreparedPlan == nil {
			requestLogger.Error("prepare plan is nil", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		preparedPlan = sharedPreparedPlan.(planWithExtractedVariables)
	}

	extractedVariables := make([]byte, len(preparedPlan.variables))
	copy(extractedVariables, preparedPlan.variables)
	requestVariables := operationContext.Variables()
	combinedVariables := MergeJsonRightIntoLeft(requestVariables, extractedVariables)

	ctx := &resolve.Context{
		Variables: combinedVariables,
		Request: resolve.Request{
			Header: r.Header,
		},
		RenameTypeNames: h.executor.RenameTypeNames,
	}
	ctx = ctx.WithContext(r.Context())

	switch p := preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		w.Header().Set("Content-Type", "application/json")

		executionBuf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(executionBuf)

		err := h.executor.Resolver.ResolveGraphQLResponse(ctx, p.Response, nil, executionBuf)
		if err != nil {
			var nErr net.Error

			if errors.Is(err, context.Canceled) {
				writeRequestErrors(r, graphql.RequestErrorsFromError(serverCanceledErr), w, requestLogger)
			} else if errors.As(err, &nErr) && nErr.Timeout() {
				writeRequestErrors(r, graphql.RequestErrorsFromError(serverTimeoutErr), w, requestLogger)
			} else {
				writeRequestErrors(r, graphql.RequestErrorsFromError(couldNotResolveResponseErr), w, requestLogger)
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
				writeRequestErrors(r, graphql.RequestErrorsFromError(couldNotResolveResponseErr), w, requestLogger)
				return
			}

			requestLogger.Error("unable to resolve subscription response", zap.Error(err))
			writeRequestErrors(r, graphql.RequestErrorsFromError(couldNotResolveResponseErr), w, requestLogger)
			return
		}
	default:
		requestLogger.Error("unsupported plan kind")
		w.WriteHeader(http.StatusInternalServerError)
	}
}

func (h *GraphQLHandler) preparePlan(requestOperationName []byte, requestOperationContent string) (planWithExtractedVariables, error) {
	doc, report := astparser.ParseGraphqlDocumentString(requestOperationContent)
	if report.HasErrors() {
		return planWithExtractedVariables{}, &reportError{report: &report}
	}

	validation := astvalidation.DefaultOperationValidator()

	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&doc, h.executor.Definition, &report)

	// validate the document before planning
	state := validation.Validate(&doc, h.executor.Definition, &report)
	if state != astvalidation.Valid {
		return planWithExtractedVariables{}, &reportError{report: &report}
	}

	planner := plan.NewPlanner(context.Background(), h.executor.PlanConfig)

	// create and postprocess the plan
	preparedPlan := planner.Plan(&doc, h.executor.Definition, unsafebytes.BytesToString(requestOperationName), &report)
	if report.HasErrors() {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, report)
	}
	post := postprocess.DefaultProcessor()
	post.Process(preparedPlan)

	extractedVariables := make([]byte, len(doc.Input.Variables))
	copy(extractedVariables, doc.Input.Variables)

	return planWithExtractedVariables{
		preparedPlan: preparedPlan,
		variables:    extractedVariables,
	}, nil
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
		if ctx != nil {
			ctx.hasError = true
		}

		// set the span status to error
		span.SetStatus(codes.Error, requestErrors.Error())
		// set the span attribute to indicate that the request had an error
		span.SetAttributes(otel.WgRequestError.Bool(true))

		if _, err := requestErrors.WriteResponse(w); err != nil {
			requestLogger.Error("error writing response", zap.Error(err))
		}
	}
}
