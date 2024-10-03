package core

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pkg/errors"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/art"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
)

type PreHandlerOptions struct {
	Logger                *zap.Logger
	Executor              *Executor
	Metrics               RouterMetrics
	OperationProcessor    *OperationProcessor
	Planner               *OperationPlanner
	AccessController      *AccessController
	OperationBlocker      *OperationBlocker
	RouterPublicKey       *ecdsa.PublicKey
	TracerProvider        *sdktrace.TracerProvider
	MaxUploadFiles        int
	MaxUploadFileSize     int
	QueryDepthEnabled     bool
	QueryDepthLimit       int
	QueryIgnorePersistent bool

	FlushTelemetryAfterResponse bool
	FileUploadEnabled           bool
	TraceExportVariables        bool
	DevelopmentMode             bool
	EnableRequestTracing        bool
	AlwaysIncludeQueryPlan      bool
	AlwaysSkipLoader            bool
	QueryPlansEnabled           bool
	QueryPlansLoggingEnabled    bool
	TrackSchemaUsageInfo        bool
	ClientHeader                config.ClientHeader
	ComputeOperationSha256      bool
}

type PreHandler struct {
	log                         *zap.Logger
	executor                    *Executor
	metrics                     RouterMetrics
	operationProcessor          *OperationProcessor
	planner                     *OperationPlanner
	accessController            *AccessController
	operationBlocker            *OperationBlocker
	developmentMode             bool
	alwaysIncludeQueryPlan      bool
	alwaysSkipLoader            bool
	queryPlansEnabled           bool // queryPlansEnabled is a flag to enable query plans output in the extensions
	queryPlansLoggingEnabled    bool // queryPlansLoggingEnabled is a flag to enable logging of query plans
	routerPublicKey             *ecdsa.PublicKey
	enableRequestTracing        bool
	tracerProvider              *sdktrace.TracerProvider
	flushTelemetryAfterResponse bool
	tracer                      trace.Tracer
	traceExportVariables        bool
	fileUploadEnabled           bool
	maxUploadFiles              int
	maxUploadFileSize           int
	queryDepthEnabled           bool
	queryDepthLimit             int
	queryIgnorePersistent       bool
	bodyReadBuffers             *sync.Pool
	trackSchemaUsageInfo        bool
	clientHeader                config.ClientHeader
	computeOperationSha256      bool
}

type httpOperation struct {
	requestContext   *requestContext
	body             []byte
	files            []httpclient.File
	requestLogger    *zap.Logger
	attributes       []attribute.KeyValue
	routerSpan       trace.Span
	operationMetrics *OperationMetrics
	traceTimings     *art.TraceTimings
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:                         opts.Logger,
		executor:                    opts.Executor,
		metrics:                     opts.Metrics,
		operationProcessor:          opts.OperationProcessor,
		planner:                     opts.Planner,
		accessController:            opts.AccessController,
		operationBlocker:            opts.OperationBlocker,
		routerPublicKey:             opts.RouterPublicKey,
		developmentMode:             opts.DevelopmentMode,
		enableRequestTracing:        opts.EnableRequestTracing,
		flushTelemetryAfterResponse: opts.FlushTelemetryAfterResponse,
		tracerProvider:              opts.TracerProvider,
		traceExportVariables:        opts.TraceExportVariables,
		tracer: opts.TracerProvider.Tracer(
			"wundergraph/cosmo/router/pre_handler",
			trace.WithInstrumentationVersion("0.0.1"),
		),
		fileUploadEnabled:        opts.FileUploadEnabled,
		maxUploadFiles:           opts.MaxUploadFiles,
		maxUploadFileSize:        opts.MaxUploadFileSize,
		queryDepthEnabled:        opts.QueryDepthEnabled,
		queryDepthLimit:          opts.QueryDepthLimit,
		queryIgnorePersistent:    opts.QueryIgnorePersistent,
		bodyReadBuffers:          &sync.Pool{},
		alwaysIncludeQueryPlan:   opts.AlwaysIncludeQueryPlan,
		alwaysSkipLoader:         opts.AlwaysSkipLoader,
		queryPlansEnabled:        opts.QueryPlansEnabled,
		queryPlansLoggingEnabled: opts.QueryPlansLoggingEnabled,
		trackSchemaUsageInfo:     opts.TrackSchemaUsageInfo,
		clientHeader:             opts.ClientHeader,
		computeOperationSha256:   opts.ComputeOperationSha256,
	}
}

func (h *PreHandler) getBodyReadBuffer(preferredSize int64) *bytes.Buffer {
	if preferredSize <= 0 {
		preferredSize = 1024
	} else if preferredSize > h.operationProcessor.maxOperationSizeInBytes {
		preferredSize = h.operationProcessor.maxOperationSizeInBytes
	}
	buf := h.bodyReadBuffers.Get()
	if buf == nil {
		return bytes.NewBuffer(make([]byte, 0, preferredSize))
	}
	return buf.(*bytes.Buffer)
}

func (h *PreHandler) releaseBodyReadBuffer(buf *bytes.Buffer) {
	buf.Reset()
	h.bodyReadBuffers.Put(buf)
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

func (h *PreHandler) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		var (
			// In GraphQL the statusCode does not always express the error state of the request
			// we use this flag to determine if we have an error for the request metrics
			finalErr     error
			writtenBytes int
			statusCode   = http.StatusOK
			traceTimings *art.TraceTimings
		)

		requestContext := getRequestContext(r.Context())
		requestLogger := requestContext.logger

		routerSpan := trace.SpanFromContext(r.Context())

		clientInfo := NewClientInfoFromRequest(r, h.clientHeader)
		commonAttributes := []attribute.KeyValue{
			otel.WgClientName.String(clientInfo.Name),
			otel.WgClientVersion.String(clientInfo.Version),
			otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
		}

		requestContext.operation = &operationContext{
			clientInfo: clientInfo,
		}

		executionOptions, traceOptions, err := h.parseRequestOptions(r, clientInfo, requestLogger)
		if err != nil {
			finalErr = err
			writeRequestErrors(r, w, http.StatusBadRequest, graphqlerrors.RequestErrorsFromError(err), requestLogger)
			return
		}

		requestContext.operation.protocol = OperationProtocolHTTP
		requestContext.operation.executionOptions = executionOptions
		requestContext.operation.traceOptions = traceOptions

		if traceOptions.Enable {
			r = r.WithContext(resolve.SetTraceStart(r.Context(), traceOptions.EnablePredictableDebugTimings))
			traceTimings = art.NewTraceTimings(r.Context())
		}

		if baseAttributes := baseAttributesFromContext(r.Context()); baseAttributes != nil {
			commonAttributes = append(commonAttributes, baseAttributes...)
		}

		metrics := h.metrics.StartOperation(clientInfo, requestLogger, r.ContentLength, commonAttributes)

		routerSpan.SetAttributes(commonAttributes...)

		defer func() {
			metrics.Finish(finalErr, statusCode, writtenBytes, h.flushTelemetryAfterResponse)
			if h.flushTelemetryAfterResponse {
				h.flushMetrics(r.Context(), requestLogger)
			}
		}()

		var body []byte
		var files []httpclient.File
		// XXX: This buffer needs to be returned to the pool only
		// AFTER we're done with body (retrieved from parser.ReadBody())
		buf := h.getBodyReadBuffer(r.ContentLength)

		if strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
			if !h.fileUploadEnabled {
				finalErr = &httpGraphqlError{
					message:    "file upload disabled",
					statusCode: http.StatusOK,
				}
				writeOperationError(r, w, requestLogger, finalErr)
				h.releaseBodyReadBuffer(buf)
				return
			}

			_, readMultiPartSpan := h.tracer.Start(r.Context(), "HTTP - Read Multipart",
				trace.WithSpanKind(trace.SpanKindInternal),
				trace.WithAttributes(commonAttributes...),
			)

			multipartParser := NewMultipartParser(h.operationProcessor, h.maxUploadFiles, h.maxUploadFileSize)

			var err error
			body, files, err = multipartParser.Parse(r, buf)
			if err != nil {
				finalErr = err
				writeOperationError(r, w, requestLogger, finalErr)
				h.releaseBodyReadBuffer(buf)
				readMultiPartSpan.End()
				return
			}

			readMultiPartSpan.SetAttributes(
				otel.HTTPRequestUploadFileCount.Int(len(files)),
			)

			readMultiPartSpan.End()

			// Cleanup all files. Needs to be called in the pre_handler function to ensure that the
			// defer is called after the response is written
			defer func() {
				if err := multipartParser.RemoveAll(); err != nil {
					requestLogger.Error("failed to remove files after multipart request", zap.Error(err))
				}
			}()
		} else if r.Method == http.MethodPost {
			_, readOperationBodySpan := h.tracer.Start(r.Context(), "HTTP - Read Body",
				trace.WithSpanKind(trace.SpanKindInternal),
				trace.WithAttributes(commonAttributes...),
			)

			var err error
			body, err = h.operationProcessor.ReadBody(buf, r.Body)
			if err != nil {
				finalErr = err

				// This error is expected e.g. when the client defines (Content-Length) and aborts the request before
				// It means that EOF was encountered in the middle of reading the body. This is not a server error.
				if errors.Is(err, io.ErrUnexpectedEOF) {
					requestLogger.Debug("unexpected EOF while reading request body", zap.Error(err))
				} else {
					requestLogger.Error("failed to read request body", zap.Error(err))
				}

				writeOperationError(r, w, requestLogger, err)
				h.releaseBodyReadBuffer(buf)
				readOperationBodySpan.End()
				return
			}

			readOperationBodySpan.End()
		}

		opContext, err := h.handleOperation(r, buf, &httpOperation{
			requestContext:   requestContext,
			requestLogger:    requestLogger,
			attributes:       commonAttributes,
			routerSpan:       routerSpan,
			operationMetrics: metrics,
			traceTimings:     traceTimings,
			files:            files,
			body:             body,
		})
		if err != nil {
			finalErr = err
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			writeOperationError(r, w, requestLogger, err)
			h.releaseBodyReadBuffer(buf)
			return
		}

		// If we have authenticators, we try to authenticate the request
		if h.accessController != nil {
			_, authenticateSpan := h.tracer.Start(r.Context(), "Authenticate",
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(commonAttributes...),
			)

			validatedReq, err := h.accessController.Access(w, r)
			if err != nil {
				finalErr = err
				requestLogger.Error("failed to authenticate request", zap.Error(err))

				// Mark the root span of the router as failed, so we can easily identify failed requests
				rtrace.AttachErrToSpan(routerSpan, err)
				rtrace.AttachErrToSpan(authenticateSpan, err)

				authenticateSpan.End()

				writeOperationError(r, w, requestLogger, &httpGraphqlError{
					message:    err.Error(),
					statusCode: http.StatusUnauthorized,
				})
				return
			}

			authenticateSpan.End()

			r = validatedReq
		}

		art.SetRequestTracingStats(r.Context(), traceOptions, traceTimings)
		metrics.AddOperationContext(opContext)

		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		// The request context needs to be updated with the latest request to ensure that the context is up to date
		requestContext.request = r

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(ww, r)

		statusCode = ww.Status()
		writtenBytes = ww.BytesWritten()

		// Evaluate the request after the request has been handled by the engine handler
		finalErr = requestContext.error

		// Mark the root span of the router as failed, so we can easily identify failed requests
		if finalErr != nil {
			rtrace.AttachErrToSpan(trace.SpanFromContext(r.Context()), finalErr)
		}
	})
}

func (h *PreHandler) handleOperation(req *http.Request, buf *bytes.Buffer, httpOperation *httpOperation) (*operationContext, error) {
	operationKit, err := h.operationProcessor.NewKit()
	if err != nil {
		return nil, err
	}

	defer func() {
		// the kit must be freed before we're doing io operations
		// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
		// it needs to be called inside a defer to ensure it is called in panic situations as well

		if operationKit != nil {
			operationKit.Free()
		}

	}()

	requestContext := httpOperation.requestContext

	// Handle the case when operation information are provided as GET parameters
	if req.Method == http.MethodGet {
		if err := operationKit.UnmarshalOperationFromURL(req.URL); err != nil {
			return nil, &httpGraphqlError{
				message:    fmt.Sprintf("error parsing request query params: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
	} else if req.Method == http.MethodPost {
		if err := operationKit.UnmarshalOperationFromBody(httpOperation.body); err != nil {
			return nil, &httpGraphqlError{
				message:    fmt.Sprintf("error parsing request body: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		// If we have files, we need to set them on the parsed operation
		if len(httpOperation.files) > 0 {
			operationKit.parsedOperation.Files = httpOperation.files
			requestContext.operation.files = httpOperation.files
		}
	}

	// Compute the operation sha256 hash as soon as possible for observability reasons
	if h.computeOperationSha256 {
		if err := operationKit.ComputeOperationSha256(); err != nil {
			return nil, &httpGraphqlError{
				message:    fmt.Sprintf("error hashing operation: %s", err),
				statusCode: http.StatusInternalServerError,
			}
		}
		requestContext.operation.sha256Hash = operationKit.parsedOperation.Sha256Hash
	}

	requestContext.operation.extensions = operationKit.parsedOperation.Request.Extensions
	requestContext.operation.variables = operationKit.parsedOperation.Request.Variables

	var skipParse bool

	if operationKit.parsedOperation.IsPersistedOperation {
		requestContext.operation.persistedID = operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash
		skipParse, err = operationKit.FetchPersistedOperation(req.Context(), requestContext.operation.clientInfo, httpOperation.attributes)
		if err != nil {
			return nil, err
		}
		requestContext.operation.persistedOperationCacheHit = operationKit.parsedOperation.PersistedOperationCacheHit
	}

	// If the persistent operation is already in the cache, we skip the parse step
	// because the operation was already parsed. This is a performance optimization, and we
	// can do it because we know that the persisted operation is immutable (identified by the hash)
	if !skipParse {
		_, engineParseSpan := h.tracer.Start(req.Context(), "Operation - Parse",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(httpOperation.attributes...),
		)

		httpOperation.traceTimings.StartParse()
		startParsing := time.Now()

		err = operationKit.Parse()
		if err != nil {
			rtrace.AttachErrToSpan(engineParseSpan, err)

			requestContext.operation.parsingTime = time.Since(startParsing)
			if !requestContext.operation.traceOptions.ExcludeParseStats {
				httpOperation.traceTimings.EndParse()
			}

			engineParseSpan.End()

			return nil, err
		}

		requestContext.operation.parsingTime = time.Since(startParsing)
		if !requestContext.operation.traceOptions.ExcludeParseStats {
			httpOperation.traceTimings.EndParse()
		}

		engineParseSpan.End()
	}

	requestContext.operation.name = operationKit.parsedOperation.Request.OperationName
	requestContext.operation.opType = operationKit.parsedOperation.Type

	// Give the buffer back to the pool as soon as we're done with it
	h.releaseBodyReadBuffer(buf)

	if req.Method == http.MethodGet && operationKit.parsedOperation.Type == "mutation" {
		return nil, &httpGraphqlError{
			message:    "Mutations can only be sent over HTTP POST",
			statusCode: http.StatusMethodNotAllowed,
		}
	}

	attributes := []attribute.KeyValue{
		otel.WgOperationName.String(operationKit.parsedOperation.Request.OperationName),
		otel.WgOperationType.String(operationKit.parsedOperation.Type),
	}
	attributes = append(attributes, httpOperation.attributes...)

	// Set the router span name after we have the operation name
	httpOperation.routerSpan.SetName(GetSpanName(operationKit.parsedOperation.Request.OperationName, operationKit.parsedOperation.Type))

	// Set the operation name and type to the operation metrics and the router span as early as possible
	httpOperation.routerSpan.SetAttributes(attributes...)
	httpOperation.operationMetrics.AddAttributes(attributes...)

	if err := h.operationBlocker.OperationIsBlocked(operationKit.parsedOperation); err != nil {
		return nil, &httpGraphqlError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}

	if operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery != nil &&
		operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash != "" {
		persistedIDAttribute := otel.WgOperationPersistedID.String(operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash)
		attributes = append(attributes, persistedIDAttribute)
		httpOperation.routerSpan.SetAttributes(persistedIDAttribute)
		httpOperation.operationMetrics.AddAttributes(persistedIDAttribute)
	}

	/**
	* Normalize the operation
	 */

	if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
		httpOperation.traceTimings.StartNormalize()
	}

	startNormalization := time.Now()

	_, engineNormalizeSpan := h.tracer.Start(req.Context(), "Operation - Normalize",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attributes...),
	)

	cached, err := operationKit.NormalizeOperation()
	if err != nil {
		rtrace.AttachErrToSpan(engineNormalizeSpan, err)

		requestContext.operation.normalizationTime = time.Since(startNormalization)
		if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
			httpOperation.traceTimings.EndNormalize()
		}

		engineNormalizeSpan.End()

		return nil, err
	}

	engineNormalizeSpan.SetAttributes(otel.WgNormalizationCacheHit.Bool(cached))

	requestContext.operation.hash = operationKit.parsedOperation.ID
	requestContext.operation.normalizationCacheHit = operationKit.parsedOperation.NormalizationCacheHit

	operationHashAttribute := otel.WgOperationHash.String(strconv.FormatUint(operationKit.parsedOperation.ID, 10))
	attributes = append(attributes, operationHashAttribute)

	httpOperation.routerSpan.SetAttributes(operationHashAttribute)
	httpOperation.operationMetrics.AddAttributes(operationHashAttribute)

	/**
	* Normalize the variables
	 */

	err = operationKit.NormalizeVariables()
	if err != nil {
		rtrace.AttachErrToSpan(engineNormalizeSpan, err)

		requestContext.operation.normalizationTime = time.Since(startNormalization)
		if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
			httpOperation.traceTimings.EndNormalize()
		}

		engineNormalizeSpan.End()

		return nil, err
	}

	requestContext.operation.content = operationKit.parsedOperation.NormalizedRepresentation
	requestContext.operation.variables = operationKit.parsedOperation.Request.Variables
	requestContext.operation.normalizationTime = time.Since(startNormalization)

	if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
		httpOperation.traceTimings.EndNormalize()
	}

	engineNormalizeSpan.End()

	if operationKit.parsedOperation.IsPersistedOperation {
		engineNormalizeSpan.SetAttributes(otel.WgEnginePersistedOperationCacheHit.Bool(operationKit.parsedOperation.PersistedOperationCacheHit))
	}

	if h.traceExportVariables {
		// At this stage the variables are normalized
		httpOperation.routerSpan.SetAttributes(otel.WgOperationVariables.String(string(operationKit.parsedOperation.Request.Variables)))
	}

	// Set the normalized operation only on the root span
	operationContentAttribute := otel.WgOperationContent.String(operationKit.parsedOperation.NormalizedRepresentation)
	httpOperation.routerSpan.SetAttributes(operationContentAttribute)

	/**
	* Validate the operation
	 */

	if !requestContext.operation.traceOptions.ExcludeValidateStats {
		httpOperation.traceTimings.StartValidate()
	}

	startValidation := time.Now()

	_, engineValidateSpan := h.tracer.Start(req.Context(), "Operation - Validate",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attributes...),
	)
	validationCached, err := operationKit.Validate(requestContext.operation.executionOptions.SkipLoader)
	if err != nil {
		rtrace.AttachErrToSpan(engineValidateSpan, err)

		requestContext.operation.validationTime = time.Since(startValidation)

		if !requestContext.operation.traceOptions.ExcludeValidateStats {
			httpOperation.traceTimings.EndValidate()
		}

		engineValidateSpan.End()

		return nil, err
	}

	engineValidateSpan.SetAttributes(otel.WgValidationCacheHit.Bool(validationCached))
	if requestContext.operation.executionOptions.SkipLoader {
		// In case we're skipping the loader, which means that we won't execute the operation
		// we skip the validation of variables as we're not using them
		// this allows us to generate query plans without having to provide variables
		engineValidateSpan.SetAttributes(otel.WgVariablesValidationSkipped.Bool(true))
	}

	// Validate that the planned query doesn't exceed the maximum query depth configured
	// This check runs if they've configured a max query depth, and it can optionally be turned off for persisted operations
	if h.queryDepthEnabled && h.queryDepthLimit > 0 && (!operationKit.parsedOperation.IsPersistedOperation || operationKit.parsedOperation.IsPersistedOperation && !h.queryIgnorePersistent) {
		cacheHit, depth, queryDepthErr := operationKit.ValidateQueryDepth(h.queryDepthLimit, operationKit.kit.doc, h.executor.RouterSchema)
		engineValidateSpan.SetAttributes(otel.WgQueryDepth.Int(depth))
		engineValidateSpan.SetAttributes(otel.WgQueryDepthCacheHit.Bool(cacheHit))
		if queryDepthErr != nil {
			rtrace.AttachErrToSpan(engineValidateSpan, err)

			requestContext.operation.validationTime = time.Since(startValidation)
			httpOperation.traceTimings.EndValidate()

			engineValidateSpan.End()

			return nil, queryDepthErr
		}
	}

	requestContext.operation.validationTime = time.Since(startValidation)
	httpOperation.traceTimings.EndValidate()

	engineValidateSpan.End()

	/**
	* Plan the operation
	 */

	// If the request has a query parameter wg_trace=true we skip the cache
	// and always plan the operation
	// this allows us to "write" to the plan
	if !requestContext.operation.traceOptions.ExcludePlannerStats {
		httpOperation.traceTimings.StartPlanning()
	}
	startPlanning := time.Now()

	_, enginePlanSpan := h.tracer.Start(req.Context(), "Operation - Plan",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(otel.WgEngineRequestTracingEnabled.Bool(requestContext.operation.traceOptions.Enable)),
		trace.WithAttributes(attributes...),
	)

	planOptions := PlanOptions{
		Protocol:             OperationProtocolHTTP,
		ClientInfo:           requestContext.operation.clientInfo,
		TraceOptions:         requestContext.operation.traceOptions,
		ExecutionOptions:     requestContext.operation.executionOptions,
		TrackSchemaUsageInfo: h.trackSchemaUsageInfo,
	}

	requestContext.operation.setAttributes()

	err = h.planner.plan(requestContext.operation, planOptions)
	if err != nil {

		httpOperation.requestLogger.Error("failed to plan operation", zap.Error(err))
		rtrace.AttachErrToSpan(enginePlanSpan, err)

		requestContext.operation.planningTime = time.Since(startPlanning)
		if !requestContext.operation.traceOptions.ExcludePlannerStats {
			httpOperation.traceTimings.EndPlanning()
		}

		enginePlanSpan.End()

		return nil, err
	}

	enginePlanSpan.SetAttributes(otel.WgEnginePlanCacheHit.Bool(requestContext.operation.planCacheHit))

	requestContext.operation.planningTime = time.Since(startPlanning)
	httpOperation.traceTimings.EndPlanning()

	enginePlanSpan.End()

	// we could log the query plan only if query plans are calculated
	if (h.queryPlansEnabled && requestContext.operation.executionOptions.IncludeQueryPlanInResponse) ||
		h.alwaysIncludeQueryPlan {

		if h.queryPlansLoggingEnabled {
			switch p := requestContext.operation.preparedPlan.preparedPlan.(type) {
			case *plan.SynchronousResponsePlan:
				printedPlan := p.Response.Fetches.QueryPlan().PrettyPrint()

				if h.developmentMode {
					h.log.Sugar().Debugf("Query Plan:\n%s", printedPlan)
				} else {
					h.log.Debug("Query Plan", zap.String("query_plan", printedPlan))
				}
			}
		}
	}

	return requestContext.operation, nil
}

// flushMetrics flushes all metrics to the respective exporters
// only used for serverless router build
func (h *PreHandler) flushMetrics(ctx context.Context, requestLogger *zap.Logger) {
	requestLogger.Debug("Flushing metrics ...")

	now := time.Now()

	wg := &sync.WaitGroup{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := h.metrics.MetricStore().Flush(ctx); err != nil {
			requestLogger.Error("Failed to flush OTEL metrics", zap.Error(err))
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := h.tracerProvider.ForceFlush(ctx); err != nil {
			requestLogger.Error("Failed to flush OTEL tracer", zap.Error(err))
		}
	}()

	wg.Wait()

	requestLogger.Debug("Metrics flushed", zap.Duration("duration", time.Since(now)))
}

func (h *PreHandler) parseRequestOptions(r *http.Request, clientInfo *ClientInfo, requestLogger *zap.Logger) (resolve.ExecutionOptions, resolve.TraceOptions, error) {
	ex, tr, err := h.internalParseRequestOptions(r, clientInfo, requestLogger)
	if err != nil {
		return ex, tr, err
	}
	if h.alwaysIncludeQueryPlan {
		ex.IncludeQueryPlanInResponse = true
	}
	if h.alwaysSkipLoader {
		ex.SkipLoader = true
	}
	if !h.queryPlansEnabled {
		ex.IncludeQueryPlanInResponse = false
	}
	return ex, tr, nil
}

func (h *PreHandler) internalParseRequestOptions(r *http.Request, clientInfo *ClientInfo, requestLogger *zap.Logger) (resolve.ExecutionOptions, resolve.TraceOptions, error) {
	// Determine if we should enable request tracing / query plans at all
	if h.enableRequestTracing {
		// In dev mode we always allow to enable tracing / query plans
		if h.developmentMode {
			return h.parseRequestExecutionOptions(r), h.parseRequestTraceOptions(r), nil
		}
		// If the client has a valid request token, and we have a public key from the controlplane
		if clientInfo.WGRequestToken != "" && h.routerPublicKey != nil {
			_, err := jwt.Parse(clientInfo.WGRequestToken, func(token *jwt.Token) (interface{}, error) {
				return h.routerPublicKey, nil
			}, jwt.WithValidMethods([]string{jwt.SigningMethodES256.Name}))
			if err != nil {
				requestLogger.Error(fmt.Sprintf("failed to parse request token: %s", err.Error()))
				return resolve.ExecutionOptions{}, resolve.TraceOptions{}, err
			}
			return h.parseRequestExecutionOptions(r), h.parseRequestTraceOptions(r), nil
		}
	}

	// Disable tracing / query plans for all other cases
	traceOptions := resolve.TraceOptions{}
	traceOptions.DisableAll()
	return resolve.ExecutionOptions{
		SkipLoader:                 false,
		IncludeQueryPlanInResponse: false,
	}, traceOptions, nil
}

func (h *PreHandler) parseRequestExecutionOptions(r *http.Request) resolve.ExecutionOptions {
	options := resolve.ExecutionOptions{
		SkipLoader:                 false,
		IncludeQueryPlanInResponse: false,
	}
	if r.Header.Get("X-WG-Skip-Loader") != "" {
		options.SkipLoader = true
	}
	if r.URL.Query().Has("wg_skip_loader") {
		options.SkipLoader = true
	}
	if r.Header.Get("X-WG-Include-Query-Plan") != "" {
		options.IncludeQueryPlanInResponse = true
	}
	if r.URL.Query().Has("wg_include_query_plan") {
		options.IncludeQueryPlanInResponse = true
	}
	return options
}
