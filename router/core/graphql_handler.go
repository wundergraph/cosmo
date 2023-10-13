package core

import (
	"context"
	"errors"
	"fmt"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
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
	ErrMsgOperationParseFailed      = "failed to parse operation: %w"
	ErrMsgOperationValidationFailed = "operation validation failed: %s"
)

var (
	couldNotResolveResponseErr = errors.New("could not resolve response")
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

type planWithMetaData struct {
	preparedPlan    plan.Plan
	variables       []byte
	schemaUsageInfo plan.SchemaUsageInfo
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
	Executor            *Executor
	Cache               *ristretto.Cache
	Log                 *zap.Logger
	GqlMetricsExporter  *graphqlmetrics.Exporter
	RouterConfigVersion string
}

func NewGraphQLHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		log:                 opts.Log,
		sf:                  &singleflight.Group{},
		prepared:            map[uint64]planWithMetaData{},
		preparedMux:         &sync.RWMutex{},
		planCache:           opts.Cache,
		executor:            opts.Executor,
		gqlMetricsExporter:  opts.GqlMetricsExporter,
		routerConfigVersion: opts.RouterConfigVersion,
	}
	return graphQLHandler
}

type GraphQLHandler struct {
	log      *zap.Logger
	executor *Executor

	prepared    map[uint64]planWithMetaData
	preparedMux *sync.RWMutex

	sf                  *singleflight.Group
	planCache           *ristretto.Cache
	gqlMetricsExporter  *graphqlmetrics.Exporter
	routerConfigVersion string
}

func (h *GraphQLHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {

	var (
		preparedPlan planWithMetaData
	)

	requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
	operationContext := getOperationContext(r.Context())

	// Update the resolveCtx with the latest request context so user modules can access it

	requestOperationNameBytes := unsafebytes.StringToBytes(operationContext.Name())
	operationID := strconv.FormatUint(operationContext.Hash(), 10)

	// try to get a prepared plan for this operation ID from the cache
	cachedPlan, ok := h.planCache.Get(operationID)
	if ok && cachedPlan != nil {
		// re-use a prepared plan
		preparedPlan = cachedPlan.(planWithMetaData)
	} else {
		// prepare a new plan using single flight
		// this ensures that we only prepare the plan once for this operation ID
		sharedPreparedPlan, err, _ := h.sf.Do(operationID, func() (interface{}, error) {
			prepared, err := h.preparePlan(requestOperationNameBytes, operationContext.Content())
			if err != nil {
				return nil, err
			}
			// cache the prepared plan for 1 hour
			h.planCache.SetWithTTL(operationID, prepared, 1, time.Hour)
			return prepared, nil
		})
		if err != nil {
			var reportErr ReportError
			if errors.As(err, &reportErr) {
				w.WriteHeader(http.StatusBadRequest)
				writeRequestErrorsFromReport(reportErr.Report(), w, requestLogger)
			} else {
				requestLogger.Error("prepare plan failed", zap.Error(err))
				w.WriteHeader(http.StatusInternalServerError)
				writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			}
			return
		}

		preparedPlan, ok = sharedPreparedPlan.(planWithMetaData)
		if !ok {
			requestLogger.Error("unexpected prepared plan type")
			w.WriteHeader(http.StatusInternalServerError)
			writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}
	}

	if h.gqlMetricsExporter != nil {
		fieldUsageInfos := make([]*graphqlmetricsv1.TypeFieldUsageInfo, len(preparedPlan.schemaUsageInfo.TypeFields))

		for i := range preparedPlan.schemaUsageInfo.TypeFields {
			fieldUsageInfos[i] = &graphqlmetricsv1.TypeFieldUsageInfo{
				Count:     1,
				Path:      preparedPlan.schemaUsageInfo.TypeFields[i].Path,
				TypeNames: preparedPlan.schemaUsageInfo.TypeFields[i].TypeNames,
				SourceIDs: preparedPlan.schemaUsageInfo.TypeFields[i].Source.IDs,
			}
		}

		h.gqlMetricsExporter.Record(&graphqlmetricsv1.SchemaUsageInfo{
			OperationDocument: operationContext.content,
			TypeFieldMetrics:  fieldUsageInfos,
			OperationInfo: &graphqlmetricsv1.OperationInfo{
				OperationType: operationContext.opType,
				OperationHash: operationID,
				OperationName: operationContext.name,
			},
			RequestInfo: &graphqlmetricsv1.RequestInfo{
				RouterConfigVersion: h.routerConfigVersion,
			},
			Attributes: map[string]string{
				"client_name":    operationContext.client.name,
				"client_version": operationContext.client.version,
			},
		})
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

func (h *GraphQLHandler) preparePlan(requestOperationName []byte, requestOperationContent string) (planWithMetaData, error) {
	doc, report := astparser.ParseGraphqlDocumentString(requestOperationContent)
	if report.HasErrors() {
		return planWithMetaData{}, &reportError{report: &report}
	}

	validation := astvalidation.DefaultOperationValidator()

	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&doc, h.executor.Definition, &report)

	// validate the document before planning
	state := validation.Validate(&doc, h.executor.Definition, &report)
	if state != astvalidation.Valid {
		return planWithMetaData{}, &reportError{report: &report}
	}

	planner := plan.NewPlanner(context.Background(), h.executor.PlanConfig)

	// create and postprocess the plan
	preparedPlan := planner.Plan(&doc, h.executor.Definition, unsafebytes.BytesToString(requestOperationName), &report)
	if report.HasErrors() {
		return planWithMetaData{}, fmt.Errorf(ErrMsgOperationParseFailed, report)
	}
	post := postprocess.DefaultProcessor()
	post.Process(preparedPlan)

	extractedVariables := make([]byte, len(doc.Input.Variables))
	copy(extractedVariables, doc.Input.Variables)

	schemaUsageInfo := plan.GetSchemaUsageInfo(preparedPlan)

	return planWithMetaData{
		preparedPlan:    preparedPlan,
		variables:       extractedVariables,
		schemaUsageInfo: schemaUsageInfo,
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
