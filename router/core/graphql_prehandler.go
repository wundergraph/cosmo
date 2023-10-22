package core

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/dgraph-io/ristretto"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"golang.org/x/sync/singleflight"

	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/pool"

	"github.com/go-chi/chi/middleware"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
)

type PreHandlerOptions struct {
	Logger                *zap.Logger
	Executor              *Executor
	RequestMetrics        *metric.Metrics
	Cache                 *ristretto.Cache
	Parser                *OperationParser
	GqlMetricsExporter    *graphqlmetrics.Exporter
	RouterConfigVersion   string
	MaxRequestSizeInBytes int64
}

type PreHandler struct {
	log                   *zap.Logger
	executor              *Executor
	requestMetrics        *metric.Metrics
	planCache             *ristretto.Cache
	parser                *OperationParser
	sf                    *singleflight.Group
	gqlMetricsExporter    *graphqlmetrics.Exporter
	routerConfigVersion   string
	maxRequestSizeInBytes int64
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:                   opts.Logger,
		executor:              opts.Executor,
		requestMetrics:        opts.RequestMetrics,
		sf:                    &singleflight.Group{},
		planCache:             opts.Cache,
		gqlMetricsExporter:    opts.GqlMetricsExporter,
		routerConfigVersion:   opts.RouterConfigVersion,
		parser:                opts.Parser,
		maxRequestSizeInBytes: opts.MaxRequestSizeInBytes,
	}
}

func (h *PreHandler) preparePlan(requestOperationName []byte, requestOperationContent string) (planWithMetaData, error) {
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

func (h *PreHandler) Handler(next http.Handler) http.Handler {

	fn := func(w http.ResponseWriter, r *http.Request) {
		requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		var statusCode int
		var writtenBytes int
		var metrics *OperationMetrics

		clientInfo := NewClientInfoFromRequest(r)

		if h.requestMetrics != nil {
			metrics = StartOperationMetrics(r.Context(), h.requestMetrics, r.ContentLength)

			defer func() {
				metrics.Finish(r.Context(), statusCode, int64(writtenBytes))
				// TODO
				// h.exportSchemaUsageInfo(opContext, graphqlmetrics.Attributes{
				// 	graphqlmetrics.HTTPStatusCodeAttribute: strconv.Itoa(statusCode),
				// })
			}()

			metrics.AddClientInfo(r.Context(), clientInfo)
		}

		limitedReader := &io.LimitedReader{R: r.Body, N: h.maxRequestSizeInBytes}
		buf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(buf)

		copiedBytes, err := io.Copy(buf, limitedReader)
		if err != nil {
			statusCode = http.StatusInternalServerError
			requestLogger.Error("failed to read request body", zap.Error(err))
			w.WriteHeader(statusCode)
			writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}

		// If the request body is larger than the limit, limit reader will truncate the body
		// We check here if it was truncated and return an error
		if copiedBytes < r.ContentLength {
			statusCode = http.StatusRequestEntityTooLarge
			requestLogger.Error("request body too large")
			w.WriteHeader(statusCode)
			writeRequestErrors(graphql.RequestErrorsFromError(errors.New("request body too large")), w, requestLogger)
			return
		}

		operation, err := h.parser.Parse(buf.Bytes())
		if err != nil {
			var reportErr ReportError
			var inputErr InputError
			switch {
			case errors.As(err, &inputErr):
				statusCode = http.StatusBadRequest
				requestLogger.Error(inputErr.Error())
				w.WriteHeader(statusCode)
				w.Write([]byte(inputErr.Error()))
			case errors.As(err, &reportErr):
				report := reportErr.Report()
				// according to the graphql-over-http spec, internal errors should
				// use a 500 as status code, while external errors should use 200.
				// If we have both, we use 500.
				if len(report.InternalErrors) == 0 {
					statusCode = http.StatusOK
				} else {
					statusCode = http.StatusInternalServerError
				}
				logInternalErrors(report, requestLogger)
				w.WriteHeader(statusCode)
				writeRequestErrorsFromReport(report, w, requestLogger)
			default:
				statusCode = http.StatusInternalServerError
				requestLogger.Error(err.Error())
				w.WriteHeader(statusCode)
				writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			}
			return
		}

		if metrics != nil {
			metrics.AddOperation(r.Context(), operation, OperationProtocolHTTP)
		}

		ctxWithOperation := withOperationContext(r.Context(), operation, clientInfo)
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		// try to get a prepared plan for this operation ID from the cache
		cachedPlan, ok := h.planCache.Get(operationID)
		if ok && cachedPlan != nil {
			// re-use a prepared plan
			opContext.preparedPlan = cachedPlan.(planWithMetaData)
		} else {
			// prepare a new plan using single flight
			// this ensures that we only prepare the plan once for this operation ID
			sharedPreparedPlan, err, _ := h.sf.Do(operationIDStr, func() (interface{}, error) {
				prepared, err := h.preparePlan(requestOperationNameBytes, opContext.Content())
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

			opContext.preparedPlan, ok = sharedPreparedPlan.(planWithMetaData)
			if !ok {
				requestLogger.Error("unexpected prepared plan type")
				w.WriteHeader(http.StatusInternalServerError)
				writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
				return
			}
		}

		newReq := r.WithContext(withOperationContext(r.Context(), &opContext))

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(ww, newReq)

		statusCode = ww.Status()
		writtenBytes = ww.BytesWritten()
	}

	return http.HandlerFunc(fn)
}

func (h *PreHandler) exportSchemaUsageInfo(operationContext operationContext, attributes graphqlmetrics.Attributes) {
	if h.gqlMetricsExporter == nil {
		return
	}

	fieldUsageInfos := make([]*graphqlmetricsv1.TypeFieldUsageInfo, len(operationContext.preparedPlan.schemaUsageInfo.TypeFields))

	for i := range operationContext.preparedPlan.schemaUsageInfo.TypeFields {
		fieldUsageInfos[i] = &graphqlmetricsv1.TypeFieldUsageInfo{
			Count:       1,
			Path:        operationContext.preparedPlan.schemaUsageInfo.TypeFields[i].Path,
			TypeNames:   operationContext.preparedPlan.schemaUsageInfo.TypeFields[i].TypeNames,
			SubgraphIDs: operationContext.preparedPlan.schemaUsageInfo.TypeFields[i].Source.IDs,
		}
	}

	var opType graphqlmetricsv1.OperationType
	switch operationContext.opType {
	case "query":
		opType = graphqlmetricsv1.OperationType_QUERY
	case "mutation":
		opType = graphqlmetricsv1.OperationType_MUTATION
	case "subscription":
		opType = graphqlmetricsv1.OperationType_SUBSCRIPTION
	}

	// Non-blocking
	h.gqlMetricsExporter.Record(&graphqlmetricsv1.SchemaUsageInfo{
		RequestDocument:  operationContext.content,
		TypeFieldMetrics: fieldUsageInfos,
		OperationInfo: &graphqlmetricsv1.OperationInfo{
			Type: opType,
			Hash: strconv.FormatUint(operationContext.hash, 10),
			Name: operationContext.name,
		},
		SchemaInfo: &graphqlmetricsv1.SchemaInfo{
			Version: h.routerConfigVersion,
		},
		ClientInfo: &graphqlmetricsv1.ClientInfo{
			Name:    operationContext.client.name,
			Version: operationContext.client.version,
		},
		Attributes: attributes,
	})
}
