package core

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/wundergraph/cosmo/router/pkg/art"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/pkg/errors"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PreHandlerOptions struct {
	Logger             *zap.Logger
	Executor           *Executor
	Metrics            RouterMetrics
	OperationProcessor *OperationProcessor
	Planner            *OperationPlanner
	AccessController   *AccessController
	OperationBlocker   *OperationBlocker
	RouterPublicKey    *ecdsa.PublicKey
	TracerProvider     *sdktrace.TracerProvider
	MaxUploadFiles     int
	MaxUploadFileSize  int

	FlushTelemetryAfterResponse bool
	FileUploadEnabled           bool
	TraceExportVariables        bool
	DevelopmentMode             bool
	EnableRequestTracing        bool
	AlwaysIncludeQueryPlan      bool
	AlwaysSkipLoader            bool
	QueryPlansEnabled           bool
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
	queryPlansEnabled           bool
	routerPublicKey             *ecdsa.PublicKey
	enableRequestTracing        bool
	tracerProvider              *sdktrace.TracerProvider
	flushTelemetryAfterResponse bool
	tracer                      trace.Tracer
	traceExportVariables        bool
	fileUploadEnabled           bool
	maxUploadFiles              int
	maxUploadFileSize           int
	bodyReadBuffers             *sync.Pool
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
		fileUploadEnabled:      opts.FileUploadEnabled,
		maxUploadFiles:         opts.MaxUploadFiles,
		maxUploadFileSize:      opts.MaxUploadFileSize,
		bodyReadBuffers:        &sync.Pool{},
		alwaysIncludeQueryPlan: opts.AlwaysIncludeQueryPlan,
		alwaysSkipLoader:       opts.AlwaysSkipLoader,
		queryPlansEnabled:      opts.QueryPlansEnabled,
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
		requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		var (
			// In GraphQL the statusCode does not always express the error state of the request
			// we use this flag to determine if we have an error for the request metrics
			finalErr     error
			writtenBytes int
			statusCode   = http.StatusOK
			traceTimings *art.TraceTimings
		)

		routerSpan := trace.SpanFromContext(r.Context())

		clientInfo := NewClientInfoFromRequest(r)
		attributes := []attribute.KeyValue{
			otel.WgClientName.String(clientInfo.Name),
			otel.WgClientVersion.String(clientInfo.Version),
			otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
		}

		executionOptions, traceOptions, err := h.parseRequestOptions(r, clientInfo, requestLogger)
		if err != nil {
			finalErr = err
			writeRequestErrors(r, w, http.StatusBadRequest, graphqlerrors.RequestErrorsFromError(err), requestLogger)
			return
		}

		if traceOptions.Enable {
			r = r.WithContext(resolve.SetTraceStart(r.Context(), traceOptions.EnablePredictableDebugTimings))
			traceTimings = art.NewTraceTimings(r.Context())
		}

		var commonAttributes []attribute.KeyValue
		if attributes := baseAttributesFromContext(r.Context()); attributes != nil {
			commonAttributes = append(commonAttributes, attributes...)
		}

		metrics := h.metrics.StartOperation(clientInfo, requestLogger, r.ContentLength, append(commonAttributes, attributes...))

		routerSpan.SetAttributes(attributes...)

		if h.flushTelemetryAfterResponse {
			defer h.flushMetrics(r.Context(), requestLogger)
		}

		defer func() {
			metrics.Finish(finalErr, statusCode, writtenBytes)
		}()

		var body []byte
		var files []httpclient.File
		// XXX: This buffer needs to be returned to the pool only
		// AFTER we're done with body (retrieved from parser.ReadBody())
		buf := h.getBodyReadBuffer(r.ContentLength)

		if strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
			if !h.fileUploadEnabled {
				finalErr = &inputError{
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

			// Cleanup all files. Must happen in here, so it is run after response is sent.
			defer func() {
				if err := multipartParser.RemoveAll(); err != nil {
					requestLogger.Error("failed to remove files after multipart request", zap.Error(err))
				}
			}()
		} else {
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

		/**
		 * Load and Parse the operation. Optionally, we will fetch the persisted operation from the CDN
		 */

		operationKit, err := h.operationProcessor.NewKit(body, files)
		if err != nil {
			finalErr = err

			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			writeOperationError(r, w, requestLogger, err)
			h.releaseBodyReadBuffer(buf)
			return
		}

		if err := operationKit.UnmarshalOperation(); err != nil {
			// the kit must be freed before we're doing io operations
			// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
			operationKit.Free()
			operationKit = nil
			finalErr = err

			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			writeOperationError(r, w, requestLogger, err)
			h.releaseBodyReadBuffer(buf)
			return
		}

		var skipParse bool

		if operationKit.parsedOperation.IsPersistedOperation {
			skipParse, err = operationKit.FetchPersistedOperation(r.Context(), clientInfo, commonAttributes)
			if err != nil {
				// the kit must be freed before we're doing io operations
				// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
				operationKit.Free()
				operationKit = nil
				finalErr = err

				// Mark the root span of the router as failed, so we can easily identify failed requests
				rtrace.AttachErrToSpan(routerSpan, err)

				writeOperationError(r, w, requestLogger, err)
				h.releaseBodyReadBuffer(buf)
				return
			}
		}

		// If the persistent operation is already in the cache, we skip the parse step
		// because the operation was already parsed. This is a performance optimization, and we
		// can do it because we know that the persisted operation is immutable (identified by the hash)
		if !skipParse {
			_, engineParseSpan := h.tracer.Start(r.Context(), "Operation - Parse",
				trace.WithSpanKind(trace.SpanKindInternal),
				trace.WithAttributes(commonAttributes...),
				trace.WithAttributes(attributes...),
			)

			traceTimings.StartParse()

			err = operationKit.Parse()
			if err != nil {
				// the kit must be freed before we're doing io operations
				// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
				operationKit.Free()
				operationKit = nil
				finalErr = err

				rtrace.AttachErrToSpan(engineParseSpan, err)
				// Mark the root span of the router as failed, so we can easily identify failed requests
				rtrace.AttachErrToSpan(routerSpan, err)

				engineParseSpan.End()

				writeOperationError(r, w, requestLogger, err)
				h.releaseBodyReadBuffer(buf)
				return
			}

			traceTimings.EndParse()
			engineParseSpan.End()
		}

		h.releaseBodyReadBuffer(buf)

		// Set the router span name after we have the operation name
		routerSpan.SetName(GetSpanName(operationKit.parsedOperation.Request.OperationName, operationKit.parsedOperation.Type))

		if blockedErr := h.operationBlocker.OperationIsBlocked(operationKit.parsedOperation); blockedErr != nil {
			// the kit must be freed before we're doing io operations
			// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
			operationKit.Free()
			operationKit = nil
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, blockedErr)

			writeRequestErrors(r, w, http.StatusOK, graphqlerrors.RequestErrorsFromError(blockedErr), requestLogger)
			return
		}

		attributes = []attribute.KeyValue{
			otel.WgOperationName.String(operationKit.parsedOperation.Request.OperationName),
			otel.WgOperationType.String(operationKit.parsedOperation.Type),
		}
		if operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery != nil &&
			operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash != "" {
			attributes = append(attributes, otel.WgOperationPersistedID.String(operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash))
		}

		routerSpan.SetAttributes(attributes...)
		metrics.AddAttributes(attributes...)

		/**
		* Normalize the operation
		 */

		traceTimings.StartNormalize()

		_, engineNormalizeSpan := h.tracer.Start(r.Context(), "Operation - Normalize",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(commonAttributes...),
			trace.WithAttributes(attributes...),
		)

		cached, err := operationKit.NormalizeOperation()
		if err != nil {
			// the kit must be freed before we're doing io operations
			// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
			operationKit.Free()
			operationKit = nil
			finalErr = err

			rtrace.AttachErrToSpan(engineNormalizeSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			engineNormalizeSpan.End()

			writeOperationError(r, w, requestLogger, err)
			return
		}

		err = operationKit.NormalizeVariables()
		if err != nil {
			// the kit must be freed before we're doing io operations
			// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
			operationKit.Free()
			operationKit = nil
			finalErr = err

			rtrace.AttachErrToSpan(engineNormalizeSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			engineNormalizeSpan.End()

			writeOperationError(r, w, requestLogger, err)
			return
		}

		engineNormalizeSpan.SetAttributes(otel.WgNormalizationCacheHit.Bool(cached))

		if operationKit.parsedOperation.IsPersistedOperation {
			engineNormalizeSpan.SetAttributes(otel.WgEnginePersistedOperationCacheHit.Bool(operationKit.parsedOperation.PersistedOperationCacheHit))
		}

		engineNormalizeSpan.End()
		traceTimings.EndNormalize()

		if h.traceExportVariables {
			// At this stage the variables are normalized
			routerSpan.SetAttributes(otel.WgOperationVariables.String(string(operationKit.parsedOperation.Request.Variables)))
		}

		attributes = []attribute.KeyValue{
			otel.WgOperationHash.String(strconv.FormatUint(operationKit.parsedOperation.ID, 10)),
		}

		// Set the normalized operation as soon as we have it
		routerSpan.SetAttributes(otel.WgOperationContent.String(operationKit.parsedOperation.NormalizedRepresentation))
		routerSpan.SetAttributes(attributes...)

		metrics.AddAttributes(attributes...)

		/**
		* Validate the operation
		 */

		traceTimings.StartValidate()

		_, engineValidateSpan := h.tracer.Start(r.Context(), "Operation - Validate",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(commonAttributes...),
		)
		validationCached, err := operationKit.Validate(executionOptions.SkipLoader)
		if err != nil {
			// the kit must be freed before we're doing io operations
			// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
			operationKit.Free()
			operationKit = nil
			finalErr = err

			rtrace.AttachErrToSpan(engineValidateSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			engineValidateSpan.End()

			writeOperationError(r, w, requestLogger, err)
			return
		}
		engineValidateSpan.SetAttributes(otel.WgValidationCacheHit.Bool(validationCached))
		if executionOptions.SkipLoader {
			// In case we're skipping the loader, which means that we won't execute the operation
			// we skip the validation of variables as we're not using them
			// this allows us to generate query plans without having to provide variables
			engineValidateSpan.SetAttributes(otel.WgVariablesValidationSkipped.Bool(true))
		}
		engineValidateSpan.End()

		traceTimings.EndValidate()

		/**
		* Plan the operation
		 */

		// If the request has a query parameter wg_trace=true we skip the cache
		// and always plan the operation
		// this allows us to "write" to the plan
		traceTimings.StartPlanning()

		_, enginePlanSpan := h.tracer.Start(r.Context(), "Operation - Plan",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(otel.WgEngineRequestTracingEnabled.Bool(traceOptions.Enable)),
			trace.WithAttributes(commonAttributes...),
		)

		planOptions := PlanOptions{
			Protocol:         OperationProtocolHTTP,
			ClientInfo:       *clientInfo,
			TraceOptions:     traceOptions,
			ExecutionOptions: executionOptions,
		}

		opContext, err := h.planner.Plan(operationKit.parsedOperation, planOptions)
		if err != nil {
			// the kit must be freed before we're doing io operations
			// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
			operationKit.Free()
			operationKit = nil
			finalErr = err

			rtrace.AttachErrToSpan(enginePlanSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			enginePlanSpan.End()

			requestLogger.Error("failed to plan operation", zap.Error(err))
			writeOperationError(r, w, requestLogger, err)
			return
		}

		enginePlanSpan.SetAttributes(otel.WgEnginePlanCacheHit.Bool(opContext.planCacheHit))

		enginePlanSpan.End()

		traceTimings.EndPlanning()

		// If we have authenticators, we try to authenticate the request
		if len(h.accessController.authenticators) > 0 {
			_, authenticateSpan := h.tracer.Start(r.Context(), "Authenticate",
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(commonAttributes...),
			)

			validatedReq, err := h.accessController.Access(w, r)
			if err != nil {
				// the kit must be freed before we're doing io operations
				// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
				operationKit.Free()
				operationKit = nil
				finalErr = err
				requestLogger.Error("failed to authenticate request", zap.Error(err))

				// Mark the root span of the router as failed, so we can easily identify failed requests
				rtrace.AttachErrToSpan(routerSpan, err)
				rtrace.AttachErrToSpan(authenticateSpan, err)

				authenticateSpan.End()

				writeRequestErrors(r, w, http.StatusUnauthorized, graphqlerrors.RequestErrorsFromError(err), requestLogger)
				return
			}

			authenticateSpan.End()

			r = validatedReq
		}

		// the kit must be freed before we're doing io operations
		// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
		operationKit.Free()
		operationKit = nil

		art.SetRequestTracingStats(r.Context(), traceOptions, traceTimings)

		requestContext := buildRequestContext(w, r, opContext, requestLogger)
		metrics.AddOperationContext(opContext)

		ctxWithRequest := withRequestContext(r.Context(), requestContext)
		ctxWithOperation := withOperationContext(ctxWithRequest, opContext)
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		newReq := r.WithContext(ctxWithOperation)

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(ww, newReq)

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

// flushMetrics flushes all metrics to the respective exporters
// only used for serverless router build
func (h *PreHandler) flushMetrics(ctx context.Context, requestLogger *zap.Logger) {
	requestLogger.Debug("Flushing metrics ...")

	now := time.Now()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := h.metrics.GqlMetricsExporter().ForceFlush(ctx); err != nil {
			requestLogger.Error("Failed to flush schema usage metrics", zap.Error(err))
		}
	}()

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
	if h.developmentMode {
		return h.parseRequestExecutionOptions(r), h.parseRequestTraceOptions(r), nil
	}
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
