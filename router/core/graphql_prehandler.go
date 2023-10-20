package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/dgraph-io/ristretto"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"golang.org/x/sync/singleflight"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"

	"github.com/buger/jsonparser"
	"github.com/go-chi/chi/middleware"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/pool"
	ctrace "github.com/wundergraph/cosmo/router/internal/trace"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
)

type PreHandlerOptions struct {
	Logger              *zap.Logger
	Executor            *Executor
	requestMetrics      *metric.Metrics
	Cache               *ristretto.Cache
	GqlMetricsExporter  *graphqlmetrics.Exporter
	RouterConfigVersion string
}

type PreHandler struct {
	log                 *zap.Logger
	executor            *Executor
	requestMetrics      *metric.Metrics
	documentPool        *sync.Pool
	planCache           *ristretto.Cache
	sf                  *singleflight.Group
	gqlMetricsExporter  *graphqlmetrics.Exporter
	routerConfigVersion string
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:                 opts.Logger,
		executor:            opts.Executor,
		requestMetrics:      opts.requestMetrics,
		sf:                  &singleflight.Group{},
		planCache:           opts.Cache,
		gqlMetricsExporter:  opts.GqlMetricsExporter,
		routerConfigVersion: opts.RouterConfigVersion,
		documentPool: &sync.Pool{
			New: func() interface{} {
				return ast.NewSmallDocument()
			},
		},
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

		var metricBaseFields []attribute.KeyValue
		var opContext operationContext
		var statusCode int
		var writtenBytes int

		if h.requestMetrics != nil {
			requestStartTime := time.Now()

			inflightMetric := h.requestMetrics.MeasureInFlight(r)

			defer func() {
				// export request metrics

				inflightMetric()

				metricBaseFields = append(metricBaseFields, semconv.HTTPStatusCode(statusCode))
				h.requestMetrics.MeasureRequestCount(r, metricBaseFields...)
				h.requestMetrics.MeasureRequestSize(r, metricBaseFields...)
				h.requestMetrics.MeasureLatency(
					r,
					requestStartTime,
					metricBaseFields...,
				)
				h.requestMetrics.MeasureResponseSize(r, int64(writtenBytes), metricBaseFields...)

				// export schema usage info

				h.exportSchemaUsageInfo(opContext, graphqlmetrics.Attributes{
					graphqlmetrics.HTTPStatusCodeAttribute: strconv.Itoa(statusCode),
				})
			}()
		}

		buf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(buf)
		_, err := io.Copy(buf, r.Body)
		if err != nil {
			statusCode = http.StatusInternalServerError
			requestLogger.Error("failed to read request body", zap.Error(err))
			writeRequestErrors(graphql.RequestErrorsFromError(errors.New("bad request")), w, requestLogger)
			w.WriteHeader(statusCode)
			return
		}

		body := buf.Bytes()

		requestQuery, _ := jsonparser.GetString(body, "query")
		requestOperationName, _ := jsonparser.GetString(body, "operationName")
		requestVariables, _, _, _ := jsonparser.Get(body, "variables")
		requestOperationType := ""

		if requestOperationName != "" {
			metricBaseFields = append(metricBaseFields, otel.WgOperationName.String(requestOperationName))
		}

		doc := h.documentPool.Get().(*ast.Document)
		doc.Reset()
		defer h.documentPool.Put(doc)
		doc.Input.ResetInputString(requestQuery)
		parser := astparser.NewParser()
		report := &operationreport.Report{}
		parser.Parse(doc, report)

		if report.HasErrors() {
			statusCode = http.StatusBadRequest
			logInternalErrors(report, requestLogger)
			w.WriteHeader(statusCode)
			writeRequestErrorsFromReport(report, w, requestLogger)
			return
		}

		// If the operationName is not set, we try to get it from the named operation in the document
		if requestOperationName == "" {
			if len(doc.OperationDefinitions) == 1 {
				requestOperationName = string(doc.OperationDefinitionNameBytes(0))
			}
		}

		// Extract the operation type from the first operation that matches the operationName
		for _, op := range doc.OperationDefinitions {
			if doc.Input.ByteSlice(op.Name).String() == requestOperationName {
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

		if requestOperationType != "" {
			metricBaseFields = append(metricBaseFields, otel.WgOperationType.String(requestOperationType))
		}

		// Add the operation to the trace span
		span := trace.SpanFromContext(r.Context())
		// Set the span name to the operation name after we figured it out
		span.SetName(GetSpanName(requestOperationName, r.Method))

		span.SetAttributes(otel.WgOperationName.String(requestOperationName))
		span.SetAttributes(otel.WgOperationType.String(requestOperationType))
		span.SetAttributes(otel.WgOperationContent.String(requestQuery))

		// If multiple operations are defined, but no operationName is set, we return an error
		if len(doc.OperationDefinitions) > 1 && requestOperationName == "" {
			statusCode = http.StatusBadRequest
			requestLogger.Error("operation name is required when multiple operations are defined")
			w.WriteHeader(statusCode)
			w.Write([]byte("operation name is required when multiple operations are defined"))
			return
		}

		// Add client info to trace span
		clientName := ctrace.GetClientInfo(r.Header, "graphql-client-name", "apollographql-client-name", "")
		clientVersion := ctrace.GetClientInfo(r.Header, "graphql-client-version", "apollographql-client-version", "")

		// Add client info to trace span attributes
		span.SetAttributes(otel.WgClientName.String(clientName))
		span.SetAttributes(otel.WgClientVersion.String(clientVersion))

		// Add client info to metrics base fields
		metricBaseFields = append(metricBaseFields, otel.WgClientName.String(clientName))
		metricBaseFields = append(metricBaseFields, otel.WgClientVersion.String(clientVersion))

		requestOperationNameBytes := unsafebytes.StringToBytes(requestOperationName)

		normalizer := astnormalization.NewNormalizer(true, false)

		if requestOperationName == "" {
			normalizer.NormalizeOperation(doc, h.executor.Definition, report)
		} else {
			normalizer.NormalizeNamedOperation(doc, h.executor.Definition, requestOperationNameBytes, report)
		}

		if report.HasErrors() {
			statusCode = http.StatusBadRequest
			logInternalErrors(report, requestLogger)
			w.WriteHeader(statusCode)
			writeRequestErrorsFromReport(report, w, requestLogger)
			return
		}

		hash := xxhash.New()

		// add the operation name to the hash
		// this is important for multi operation documents to have a different hash for each operation
		// otherwise, the prepared plan cache would return the same plan for all operations
		_, err = hash.Write(requestOperationNameBytes)
		if err != nil {
			statusCode = http.StatusInternalServerError
			requestLogger.Error("hash write failed", zap.Error(err))
			w.WriteHeader(statusCode)
			return
		}

		printer := &astprinter.Printer{}

		// create a hash of the query to use as a key for the prepared plan cache
		// in this hash, we include the printed operation
		// and the extracted variables (see below)
		err = printer.Print(doc, h.executor.Definition, hash)
		if err != nil {
			statusCode = http.StatusInternalServerError
			requestLogger.Error("unable to print document", zap.Error(err))
			w.WriteHeader(statusCode)
			writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}

		operationID := hash.Sum64() // generate the operation ID

		normalizedOperation := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(normalizedOperation)
		err = printer.Print(doc, h.executor.Definition, normalizedOperation)
		if err != nil {
			statusCode = http.StatusInternalServerError
			requestLogger.Error("unable to print document", zap.Error(err))
			w.WriteHeader(statusCode)
			writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}

		variablesCopy := make([]byte, len(requestVariables))
		copy(variablesCopy, requestVariables)

		opContext = operationContext{
			name:      requestOperationName,
			opType:    requestOperationType,
			content:   normalizedOperation.String(),
			hash:      operationID,
			variables: variablesCopy,
			client: client{
				name:    clientName,
				version: clientVersion,
			},
		}

		operationIDStr := strconv.FormatUint(operationID, 10)

		// Add the operation hash to the trace span attributes
		opHashIDAttr := otel.WgOperationHash.String(operationIDStr)
		span.SetAttributes(opHashIDAttr)

		// Add hash to metrics base fields
		metricBaseFields = append(metricBaseFields, opHashIDAttr)

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
