package core

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
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
			requestLogger.Error("prepare plan failed", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}

		if sharedPreparedPlan == nil {
			requestLogger.Error("prepare plan is nil", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		preparedPlan = sharedPreparedPlan.(planWithExtractedVariables)
	}

	vars := make([]byte, len(preparedPlan.variables))
	copy(vars, preparedPlan.variables)

	if len(preparedPlan.variables) != 0 {
		vars = MergeJsonRightIntoLeft(operationContext.Variables(), vars)
	}

	ctx := &resolve.Context{
		Variables: vars,
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
			if errors.Is(err, context.Canceled) {
				return
			}

			var nErr net.Error
			if errors.As(err, &nErr) && nErr.Timeout() {
				w.WriteHeader(http.StatusGatewayTimeout)
			} else {
				w.WriteHeader(http.StatusInternalServerError)
			}

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
			flushWriter *HttpFlushWriter
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
				return
			}

			w.WriteHeader(http.StatusInternalServerError)
			writeRequestErrors(graphql.RequestErrorsFromError(couldNotResolveResponseErr), w, requestLogger)
			requestLogger.Error("unable to resolve subscription response", zap.Error(err))
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
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationParseFailed, report)
	}

	validation := astvalidation.DefaultOperationValidator()

	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&doc, h.executor.Definition, &report)

	// validate the document before planning
	state := validation.Validate(&doc, h.executor.Definition, &report)
	if state != astvalidation.Valid {
		return planWithExtractedVariables{}, fmt.Errorf(ErrMsgOperationValidationFailed, state.String())
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
