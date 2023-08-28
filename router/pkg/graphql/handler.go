package graphql

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/go-chi/chi/middleware"
	"github.com/wundergraph/cosmo/router/pkg/contextx"
	"github.com/wundergraph/cosmo/router/pkg/flushwriter"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/trace"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/dgraph-io/ristretto"
	"github.com/hashicorp/go-multierror"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"github.com/wundergraph/cosmo/router/pkg/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"

	"github.com/wundergraph/cosmo/router/pkg/pool"
)

const (
	ErrMsgOperationParseFailed      = "failed to parse operation: %w"
	ErrMsgOperationValidationFailed = "operation validation failed: %s"
)

var (
	couldNotResolveResponseErr = errors.New("could not resolve response")
	internalServerErrorErr     = errors.New("internal server error")
)

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
	PlanConfig plan.Configuration
	Definition *ast.Document
	Resolver   *resolve.Resolver
	Pool       *pool.Pool
	Cache      *ristretto.Cache
	Log        *zap.Logger
}

func NewHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		planConfig:  opts.PlanConfig,
		definition:  opts.Definition,
		resolver:    opts.Resolver,
		log:         opts.Log,
		pool:        opts.Pool,
		sf:          &singleflight.Group{},
		prepared:    map[uint64]planWithExtractedVariables{},
		preparedMux: &sync.RWMutex{},
		planCache:   opts.Cache,
	}
	return graphQLHandler
}

type GraphQLHandler struct {
	planConfig plan.Configuration
	definition *ast.Document
	resolver   *resolve.Resolver
	log        *zap.Logger
	pool       *pool.Pool
	sf         *singleflight.Group

	prepared    map[uint64]planWithExtractedVariables
	preparedMux *sync.RWMutex

	planCache *ristretto.Cache
}

func (h *GraphQLHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {

	var (
		preparedPlan planWithExtractedVariables
	)

	requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
	operationContext := contextx.GetOperationContext(r.Context())

	requestOperationNameBytes := []byte(operationContext.Name)

	if operationContext.Name == "" {
		operationContext.Plan.Normalizer.NormalizeOperation(operationContext.Plan.Doc, h.definition, operationContext.Plan.Report)
	} else {
		operationContext.Plan.Normalizer.NormalizeNamedOperation(operationContext.Plan.Doc, h.definition, requestOperationNameBytes, operationContext.Plan.Report)
	}

	if operationContext.Plan.Report.HasErrors() {
		logInternalErrors(operationContext.Plan.Report, requestLogger)
		w.WriteHeader(http.StatusBadRequest)
		writeRequestErrorsFromReport(operationContext.Plan.Report, w, requestLogger)
		return
	}

	// add the operation name to the hash
	// this is important for multi operation documents to have a different hash for each operation
	// otherwise, the prepared plan cache would return the same plan for all operations
	_, err := operationContext.Plan.Hash.Write(requestOperationNameBytes)
	if err != nil {
		requestLogger.Error("hash write failed", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// create a hash of the query to use as a key for the prepared plan cache
	// in this hash, we include the printed operation
	// and the extracted variables (see below)
	err = operationContext.Plan.Printer.Print(operationContext.Plan.Doc, h.definition, operationContext.Plan.Hash)
	if err != nil {
		requestLogger.Error("unable to print document", zap.Error(err))
		h.respondWithInternalServerError(w, requestLogger)
		return
	}

	// add the extracted variables to the hash
	_, err = operationContext.Plan.Hash.Write(operationContext.Plan.Doc.Input.Variables)
	if err != nil {
		requestLogger.Error("hash write failed", zap.Error(err))
		h.respondWithInternalServerError(w, requestLogger)
		return
	}
	operationID := operationContext.Plan.Hash.Sum64() // generate the operation ID
	operationContext.Plan.Hash.Reset()

	span := trace.SpanFromContext(r.Context())
	span.SetAttributes(otel.WgOperationHash.Int64(int64(operationID)))

	// try to get a prepared plan for this operation ID from the cache
	cachedPlan, ok := h.planCache.Get(operationID)
	if ok && cachedPlan != nil {
		// re-use a prepared plan
		preparedPlan = cachedPlan.(planWithExtractedVariables)
	} else {
		// prepare a new plan using single flight
		// this ensures that we only prepare the plan once for this operation ID
		sharedPreparedPlan, err, _ := h.sf.Do(strconv.FormatUint(operationID, 10), func() (interface{}, error) {
			prepared, err := h.preparePlan(requestOperationNameBytes, operationContext.Plan)
			if err != nil {
				return nil, err
			}
			// cache the prepared plan for 1 hour
			h.planCache.SetWithTTL(operationID, prepared, 1, time.Hour)
			return prepared, nil
		})
		if err != nil {
			if operationContext.Plan.Report.HasErrors() {
				w.WriteHeader(http.StatusBadRequest)
				writeRequestErrorsFromReport(operationContext.Plan.Report, w, requestLogger)
			} else {
				requestLogger.Error("prepare plan failed", zap.Error(err))
				h.respondWithInternalServerError(w, requestLogger)
			}
			return
		}

		if sharedPreparedPlan == nil {
			requestLogger.Error("prepare plan is nil", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		preparedPlan = sharedPreparedPlan.(planWithExtractedVariables)
	}

	if len(preparedPlan.variables) != 0 {
		operationContext.Plan.Ctx.Variables = MergeJsonRightIntoLeft(operationContext.Plan.Ctx.Variables, preparedPlan.variables)
	}

	switch p := preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		w.Header().Set("Content-Type", "application/json")

		executionBuf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(executionBuf)

		err := h.resolver.ResolveGraphQLResponse(operationContext.Plan.Ctx, p.Response, nil, executionBuf)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}

			w.WriteHeader(http.StatusInternalServerError)
			writeRequestErrors(graphql.RequestErrorsFromError(couldNotResolveResponseErr), w, requestLogger)
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
			flushWriter *flushwriter.HttpFlushWriter
			ok          bool
		)
		operationContext.Plan.Ctx, flushWriter, ok = flushwriter.GetFlushWriter(operationContext.Plan.Ctx, operationContext.Plan.Ctx.Variables, r, w)
		if !ok {
			requestLogger.Error("connection not flushable")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		err := h.resolver.ResolveGraphQLSubscription(operationContext.Plan.Ctx, p.Response, flushWriter)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}

			w.WriteHeader(http.StatusInternalServerError)
			writeRequestErrors(graphql.RequestErrorsFromError(couldNotResolveResponseErr), w, requestLogger)
			requestLogger.Error("unable to resolve subscription response", zap.Error(err))
			return
		}
	case *plan.StreamingResponsePlan:
		w.WriteHeader(http.StatusInternalServerError)
	}
}

func (h *GraphQLHandler) respondWithInternalServerError(w http.ResponseWriter, requestLogger *zap.Logger) {
	w.WriteHeader(http.StatusInternalServerError)
	writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
}

func (h *GraphQLHandler) preparePlan(requestOperationName []byte, shared *pool.Shared) (planWithExtractedVariables, error) {
	// copy the extracted variables from the shared document
	// this is necessary because the shared document is reused across requests
	variables := make([]byte, len(shared.Doc.Input.Variables))
	copy(variables, shared.Doc.Input.Variables)

	// print the shared document into a buffer and reparse it
	// this is necessary because the shared document will be re-used across requests
	// as the plan is cached, and will have references to the document, it cannot be re-used
	buf := &bytes.Buffer{}
	err := shared.Printer.Print(shared.Doc, h.definition, buf)
	if err != nil {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, err)
	}

	// parse the document again into a non-shared document, which will be used for planning
	// this will be cached, so it's insignificant that reparsing causes overhead
	doc, report := astparser.ParseGraphqlDocumentBytes(buf.Bytes())
	if report.HasErrors() {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, err)
	}

	// validate the document before planning
	state := shared.Validation.Validate(&doc, h.definition, shared.Report)
	if state != astvalidation.Valid {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationValidationFailed, state.String())
	}

	// create and postprocess the plan
	preparedPlan := shared.Planner.Plan(&doc, h.definition, unsafebytes.BytesToString(requestOperationName), shared.Report)
	if shared.Report.HasErrors() {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, err)
	}
	shared.Postprocess.Process(preparedPlan)

	return planWithExtractedVariables{
		preparedPlan: preparedPlan,
		variables:    variables,
	}, nil
}

func logInternalErrors(report *operationreport.Report, requestLogger *zap.Logger) {
	var internalErr error
	for _, err := range report.InternalErrors {
		internalErr = multierror.Append(internalErr, err)
	}

	if internalErr != nil {
		requestLogger.Error("internal error", zap.Error(internalErr))
	}
}

func writeRequestErrorsFromReport(report *operationreport.Report, w http.ResponseWriter, requestLogger *zap.Logger) {
	requestErrors := graphql.RequestErrorsFromOperationReport(*report)
	writeRequestErrors(requestErrors, w, requestLogger)

	// log internal errors
	logInternalErrors(report, requestLogger)

	// write internal server error if there are no external errors but there are internal errors
	if len(report.ExternalErrors) == 0 && len(report.InternalErrors) > 0 {
		writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
	}
}

func writeRequestErrors(requestErrors graphql.RequestErrors, w http.ResponseWriter, requestLogger *zap.Logger) {
	if requestErrors != nil {
		if _, err := requestErrors.WriteResponse(w); err != nil {
			requestLogger.Error("error writing response", zap.Error(err))
		}
	}
}
