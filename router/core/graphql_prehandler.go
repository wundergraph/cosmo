package core

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
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
	Logger                      *zap.Logger
	Executor                    *Executor
	Metrics                     RouterMetrics
	OperationProcessor          *OperationProcessor
	Planner                     *OperationPlanner
	AccessController            *AccessController
	OperationBlocker            *OperationBlocker
	DevelopmentMode             bool
	RouterPublicKey             *ecdsa.PublicKey
	EnableRequestTracing        bool
	TracerProvider              *sdktrace.TracerProvider
	FlushTelemetryAfterResponse bool
	TraceExportVariables        bool
	FileUploadEnabled           bool
	MaxUploadFiles              int
	MaxUploadFileSize           int
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

type httpOperation struct {
	body             []byte
	files            []httpclient.File
	requestLogger    *zap.Logger
	attributes       []attribute.KeyValue
	clientInfo       *ClientInfo
	routerSpan       trace.Span
	operationMetrics *OperationMetrics
	traceOptions     resolve.TraceOptions
	traceTimings     *art.TraceTimings
}

type OperationProcessorResult struct {
	operation *ParsedOperation
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
		fileUploadEnabled: opts.FileUploadEnabled,
		maxUploadFiles:    opts.MaxUploadFiles,
		maxUploadFileSize: opts.MaxUploadFileSize,
		bodyReadBuffers:   &sync.Pool{},
	}
}

func (p *PreHandler) getBodyReadBuffer(preferredSize int64) *bytes.Buffer {
	if preferredSize <= 0 {
		preferredSize = 1024
	} else if preferredSize > p.operationProcessor.maxOperationSizeInBytes {
		preferredSize = p.operationProcessor.maxOperationSizeInBytes
	}
	buf := p.bodyReadBuffers.Get()
	if buf == nil {
		return bytes.NewBuffer(make([]byte, 0, preferredSize))
	}
	return buf.(*bytes.Buffer)
}

func (p *PreHandler) releaseBodyReadBuffer(buf *bytes.Buffer) {
	buf.Reset()
	p.bodyReadBuffers.Put(buf)
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
			traceOptions = resolve.TraceOptions{}
		)

		routerSpan := trace.SpanFromContext(r.Context())

		clientInfo := NewClientInfoFromRequest(r)
		commonAttributes := []attribute.KeyValue{
			otel.WgClientName.String(clientInfo.Name),
			otel.WgClientVersion.String(clientInfo.Version),
			otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
		}

		if h.enableRequestTracing {
			if clientInfo.WGRequestToken != "" && h.routerPublicKey != nil {
				_, err := jwt.Parse(clientInfo.WGRequestToken, func(token *jwt.Token) (interface{}, error) {
					return h.routerPublicKey, nil
				}, jwt.WithValidMethods([]string{jwt.SigningMethodES256.Name}))
				if err != nil {
					err := errors.New("invalid request token. Router version 0.42.1 or above is required to use request tracing in production")
					finalErr = err
					requestLogger.Error("failed to parse request token", zap.Error(err))
					writeOperationError(r, w, requestLogger, &httpGraphqlError{
						message:    "invalid request token",
						statusCode: http.StatusForbidden,
					})
					return
				}

				// Enable ART after successful request token validation
				traceOptions = ParseRequestTraceOptions(r)
			} else if h.developmentMode {
				// In development, without request signing, we enable ART
				traceOptions = ParseRequestTraceOptions(r)
			} else {
				// In production, without request signing, we disable ART because it's not safe to use
				traceOptions.DisableAll()
			}
		}

		if traceOptions.Enable {
			r = r.WithContext(resolve.SetTraceStart(r.Context(), traceOptions.EnablePredictableDebugTimings))
		}

		traceTimings := art.NewTraceTimings(r.Context())

		if baseAttributes := baseAttributesFromContext(r.Context()); baseAttributes != nil {
			commonAttributes = append(commonAttributes, baseAttributes...)
		}

		metrics := h.metrics.StartOperation(clientInfo, requestLogger, r.ContentLength, commonAttributes)

		routerSpan.SetAttributes(commonAttributes...)

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

		opContext, err := h.handleOperation(r, buf, &httpOperation{
			requestLogger:    requestLogger,
			attributes:       commonAttributes,
			clientInfo:       clientInfo,
			routerSpan:       routerSpan,
			operationMetrics: metrics,
			traceOptions:     traceOptions,
			traceTimings:     traceTimings,
			files:            files,
			body:             body,
		})
		if err != nil {
			finalErr = err
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			writeOperationError(r, w, requestLogger, err)
			return
		}

		// If we have authenticators, we try to authenticate the request
		if len(h.accessController.authenticators) > 0 {
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

func (h *PreHandler) handleOperation(req *http.Request, buf *bytes.Buffer, httpOperation *httpOperation) (*operationContext, error) {

	operationKit, err := h.operationProcessor.NewKit(httpOperation.body, httpOperation.files)
	defer func() {
		// the kit must be freed before we're doing io operations
		// the kit is bound to the number of CPUs, and we must not hold onto it while doing IO operations
		// it needs to be called inside a defer to ensure it is called in panic situations as well

		if operationKit != nil {
			operationKit.Free()
			operationKit = nil
		}
	}()

	if err != nil {
		return nil, err
	}

	if err := operationKit.UnmarshalOperation(); err != nil {
		return nil, err
	}

	var skipParse bool

	if operationKit.parsedOperation.IsPersistedOperation {
		skipParse, err = operationKit.FetchPersistedOperation(req.Context(), httpOperation.clientInfo, httpOperation.attributes)
		if err != nil {
			return nil, err
		}
	}

	// If the persistent operation is already in the cache, we skip the parse step
	// because the operation was already parsed. This is a performance optimization, and we
	// can do it because we know that the persisted operation is immutable (identified by the hash)
	if !skipParse {
		_, engineParseSpan := h.tracer.Start(req.Context(), "Operation - Parse",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(httpOperation.attributes...),
		)

		if !httpOperation.traceOptions.ExcludeParseStats {
			httpOperation.traceTimings.StartParse()
		}

		err = operationKit.Parse()
		if err != nil {
			rtrace.AttachErrToSpan(engineParseSpan, err)

			engineParseSpan.End()

			return nil, err
		}

		if !httpOperation.traceOptions.ExcludeParseStats {
			httpOperation.traceTimings.EndParse()
		}

		engineParseSpan.End()
	}

	// Give the buffer back to the pool as soon as we're done with it
	h.releaseBodyReadBuffer(buf)

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

	if !httpOperation.traceOptions.ExcludeNormalizeStats {
		httpOperation.traceTimings.StartNormalize()
	}

	_, engineNormalizeSpan := h.tracer.Start(req.Context(), "Operation - Normalize",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attributes...),
	)

	cached, err := operationKit.NormalizeOperation()
	if err != nil {
		rtrace.AttachErrToSpan(engineNormalizeSpan, err)

		engineNormalizeSpan.End()

		return nil, err
	}

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

		engineNormalizeSpan.End()

		return nil, err
	}

	engineNormalizeSpan.SetAttributes(otel.WgNormalizationCacheHit.Bool(cached))

	if operationKit.parsedOperation.IsPersistedOperation {
		engineNormalizeSpan.SetAttributes(otel.WgEnginePersistedOperationCacheHit.Bool(operationKit.parsedOperation.PersistedOperationCacheHit))
	}

	engineNormalizeSpan.End()

	if !httpOperation.traceOptions.ExcludeNormalizeStats {
		httpOperation.traceTimings.EndNormalize()
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

	if !httpOperation.traceOptions.ExcludeValidateStats {
		httpOperation.traceTimings.StartValidate()
	}

	_, engineValidateSpan := h.tracer.Start(req.Context(), "Operation - Validate",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attributes...),
	)
	validationCached, err := operationKit.Validate()
	if err != nil {
		rtrace.AttachErrToSpan(engineValidateSpan, err)

		engineValidateSpan.End()

		return nil, err
	}

	engineValidateSpan.SetAttributes(otel.WgValidationCacheHit.Bool(validationCached))
	engineValidateSpan.End()

	if !httpOperation.traceOptions.ExcludeValidateStats {
		httpOperation.traceTimings.EndValidate()
	}

	/**
	* Plan the operation
	 */

	// If the request has a query parameter wg_trace=true we skip the cache
	// and always plan the operation
	// this allows us to "write" to the plan
	if !httpOperation.traceOptions.ExcludePlannerStats {
		httpOperation.traceTimings.StartPlanning()
	}

	_, enginePlanSpan := h.tracer.Start(req.Context(), "Operation - Plan",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(otel.WgEngineRequestTracingEnabled.Bool(httpOperation.traceOptions.Enable)),
		trace.WithAttributes(attributes...),
	)

	opContext, err := h.planner.plan(operationKit.parsedOperation, httpOperation.clientInfo, OperationProtocolHTTP, httpOperation.traceOptions)
	if err != nil {

		rtrace.AttachErrToSpan(enginePlanSpan, err)

		enginePlanSpan.End()

		httpOperation.requestLogger.Error("failed to plan operation", zap.Error(err))

		return nil, err
	}

	enginePlanSpan.SetAttributes(otel.WgEnginePlanCacheHit.Bool(opContext.planCacheHit))

	enginePlanSpan.End()

	if !httpOperation.traceOptions.ExcludePlannerStats {
		httpOperation.traceTimings.EndPlanning()
	}

	return opContext, nil
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
