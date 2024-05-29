package core

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"io"
	"net/http"
	"os"
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
	"github.com/mazrean/formstream"
	httpform "github.com/mazrean/formstream/http"
	"github.com/pkg/errors"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/pool"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	MaxSupportedFilesUpload = 10
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
	SpanAttributesMapper        func(r *http.Request) []attribute.KeyValue
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
	spanAttributesMapper        func(r *http.Request) []attribute.KeyValue
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
		spanAttributesMapper:        opts.SpanAttributesMapper,
		tracer: opts.TracerProvider.Tracer(
			"wundergraph/cosmo/router/pre_handler",
			trace.WithInstrumentationVersion("0.0.1"),
		),
	}
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
		attributes := []attribute.KeyValue{
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
					requestLogger.Error(fmt.Sprintf("failed to parse request token: %s", err.Error()))
					writeRequestErrors(r, w, http.StatusForbidden, graphqlerrors.RequestErrorsFromError(err), requestLogger)
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

		var commonAttributes []attribute.KeyValue
		if h.spanAttributesMapper != nil {
			commonAttributes = append(commonAttributes, h.spanAttributesMapper(r)...)
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
		var err error
		// XXX: This buffer needs to be returned to the pool only
		// AFTER we're done with body (retrieved from parser.ReadBody())
		buf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(buf)
		if r.Header.Get("Content-Type") == "" || r.Header.Get("Content-Type") == "application/json" {
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
				return
			}
		} else if strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
			parser, err := httpform.NewParser(r)
			if err != nil {
				writeOperationError(r, w, requestLogger, err)
				return
			}

			err = parser.Register("operations", func(reader io.Reader, header formstream.Header) error {
				body, err = h.operationProcessor.ReadBody(buf, reader)
				if err != nil {
					return err
				}
				return nil
			}, formstream.WithRequiredPart("operations"), formstream.WithRequiredPart("map"))
			if err != nil {
				writeOperationError(r, w, requestLogger, err)
				return
			}

			// We will register a handler for each file in the request. AFAIK, we can't know how many files we have
			// before parsing the request, so we will support 10 files max.
			for i := 0; i < MaxSupportedFilesUpload; i++ {
				fileKey := fmt.Sprintf("%d", i)
				err = parser.Register(fileKey, func(reader io.Reader, header formstream.Header) error {
					// Create and open a temporary file to store the file content
					// This file will be deleted after the request is done
					file, err := os.CreateTemp("", "tempfile-")
					if err != nil {
						return err
					}
					defer file.Close()
					_, err = io.Copy(file, reader)
					if err != nil {
						return err
					}
					files = append(files, httpclient.NewFile(file.Name(), header.FileName()))

					return nil
				}, formstream.WithRequiredPart(fileKey))
				if err != nil {
					writeOperationError(r, w, requestLogger, err)
					return
				}
			}

			err = parser.Parse()
			if err != nil {
				writeOperationError(r, w, requestLogger, err)
				return
			}
		}

		/**
		 * Parse the operation
		 */

		if !traceOptions.ExcludeParseStats {
			traceTimings.StartParse()
		}

		_, engineParseSpan := h.tracer.Start(r.Context(), "Operation - Parse",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(commonAttributes...),
			trace.WithAttributes(attributes...),
		)

		operationKit, err := h.operationProcessor.NewKit(body, files)
		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineParseSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			engineParseSpan.End()

			writeOperationError(r, w, requestLogger, err)
			return
		}
		defer operationKit.Free()

		err = operationKit.Parse(r.Context(), clientInfo, requestLogger)
		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineParseSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			engineParseSpan.End()

			writeOperationError(r, w, requestLogger, err)
			return
		}

		engineParseSpan.End()

		if !traceOptions.ExcludeParseStats {
			traceTimings.EndParse()
		}

		if blockedErr := h.operationBlocker.OperationIsBlocked(operationKit.parsedOperation); blockedErr != nil {
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, blockedErr)

			writeRequestErrors(r, w, http.StatusOK, graphqlerrors.RequestErrorsFromError(blockedErr), requestLogger)
			return
		}

		// Set the router span name after we have the operation name
		routerSpan.SetName(GetSpanName(operationKit.parsedOperation.Name, operationKit.parsedOperation.Type))

		attributes = []attribute.KeyValue{
			otel.WgOperationName.String(operationKit.parsedOperation.Name),
			otel.WgOperationType.String(operationKit.parsedOperation.Type),
		}
		if operationKit.parsedOperation.PersistedID != "" {
			attributes = append(attributes, otel.WgOperationPersistedID.String(operationKit.parsedOperation.PersistedID))
		}

		routerSpan.SetAttributes(attributes...)
		metrics.AddAttributes(attributes...)

		/**
		* Normalize the operation
		 */

		if !traceOptions.ExcludeNormalizeStats {
			traceTimings.StartNormalize()
		}

		_, engineNormalizeSpan := h.tracer.Start(r.Context(), "Operation - Normalize",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(commonAttributes...),
			trace.WithAttributes(attributes...),
		)

		err = operationKit.Normalize()
		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineNormalizeSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			engineNormalizeSpan.End()

			writeOperationError(r, w, requestLogger, err)
			return
		}

		engineNormalizeSpan.End()

		if !traceOptions.ExcludeNormalizeStats {
			traceTimings.EndNormalize()
		}

		if h.traceExportVariables {
			// At this stage the variables are normalized
			routerSpan.SetAttributes(otel.WgOperationVariables.String(string(operationKit.parsedOperation.Variables)))
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

		if !traceOptions.ExcludeValidateStats {
			traceTimings.StartValidate()
		}

		_, engineValidateSpan := h.tracer.Start(r.Context(), "Operation - Validate",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(commonAttributes...),
		)
		err = operationKit.Validate()
		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineValidateSpan, err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			engineValidateSpan.End()

			writeOperationError(r, w, requestLogger, err)
			return
		}

		engineValidateSpan.End()

		if !traceOptions.ExcludeValidateStats {
			traceTimings.EndValidate()
		}

		/**
		* Plan the operation
		 */

		// If the request has a query parameter wg_trace=true we skip the cache
		// and always plan the operation
		// this allows us to "write" to the plan
		if !traceOptions.ExcludePlannerStats {
			traceTimings.StartPlanning()
		}

		_, enginePlanSpan := h.tracer.Start(r.Context(), "Operation - Plan",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(otel.WgEngineRequestTracingEnabled.Bool(traceOptions.Enable)),
			trace.WithAttributes(commonAttributes...),
		)

		opContext, err := h.planner.Plan(operationKit.parsedOperation, clientInfo, OperationProtocolHTTP, traceOptions)

		if err != nil {
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

		if !traceOptions.ExcludePlannerStats {
			traceTimings.EndPlanning()
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

				writeRequestErrors(r, w, http.StatusUnauthorized, graphqlerrors.RequestErrorsFromError(err), requestLogger)
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
		routerSpan = trace.SpanFromContext(newReq.Context())
		if finalErr != nil {
			rtrace.AttachErrToSpan(routerSpan, finalErr)
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
