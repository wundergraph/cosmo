package core

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/codes"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/astjson"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/pkg/art"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
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
	ComplexityLimits   *config.ComplexityLimits
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
	QueryPlansLoggingEnabled    bool
	TrackSchemaUsageInfo        bool
	ClientHeader                config.ClientHeader
	ComputeOperationSha256      bool
	ApolloCompatibilityFlags    *config.ApolloCompatibilityFlags
	DisableVariablesRemapping   bool
	ExprManager                 *expr.Manager
	OmitBatchExtensions         bool

	OperationContentAttributes bool
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
	complexityLimits            *config.ComplexityLimits
	trackSchemaUsageInfo        bool
	clientHeader                config.ClientHeader
	computeOperationSha256      bool
	apolloCompatibilityFlags    *config.ApolloCompatibilityFlags
	variableParsePool           astjson.ParserPool
	disableVariablesRemapping   bool
	exprManager                 *expr.Manager
	omitBatchExtensions         bool

	operationContentAttributes bool
}

type httpOperation struct {
	requestContext     *requestContext
	body               []byte
	files              []*httpclient.FileUpload
	requestLogger      *zap.Logger
	routerSpan         trace.Span
	operationMetrics   *OperationMetrics
	traceTimings       *art.TraceTimings
	authenticationPass authenticationPass
}

type authenticationPass int

const (
	authenticationPassNone authenticationPass = iota
	authenticationPassNormal
	authenticationPassIntrospectionSecret
	authenticationPassSkip
)

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
		fileUploadEnabled:         opts.FileUploadEnabled,
		maxUploadFiles:            opts.MaxUploadFiles,
		maxUploadFileSize:         opts.MaxUploadFileSize,
		complexityLimits:          opts.ComplexityLimits,
		alwaysIncludeQueryPlan:    opts.AlwaysIncludeQueryPlan,
		alwaysSkipLoader:          opts.AlwaysSkipLoader,
		queryPlansEnabled:         opts.QueryPlansEnabled,
		queryPlansLoggingEnabled:  opts.QueryPlansLoggingEnabled,
		trackSchemaUsageInfo:      opts.TrackSchemaUsageInfo,
		clientHeader:              opts.ClientHeader,
		computeOperationSha256:    opts.ComputeOperationSha256,
		apolloCompatibilityFlags:  opts.ApolloCompatibilityFlags,
		disableVariablesRemapping: opts.DisableVariablesRemapping,
		exprManager:               opts.ExprManager,
		omitBatchExtensions:       opts.OmitBatchExtensions,

		operationContentAttributes: opts.OperationContentAttributes,
	}
}

func (h *PreHandler) getBodyReadBuffer(preferredSize int64) *bytes.Buffer {
	if preferredSize <= 0 {
		preferredSize = 1024 * 4 // 4KB
	} else if preferredSize > h.operationProcessor.maxOperationSizeInBytes {
		preferredSize = h.operationProcessor.maxOperationSizeInBytes
	}
	return bytes.NewBuffer(make([]byte, 0, preferredSize))
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
			writtenBytes int
			statusCode   = http.StatusOK
			traceTimings *art.TraceTimings
		)

		requestContext := getRequestContext(r.Context())
		requestLogger := requestContext.logger

		routerSpan := trace.SpanFromContext(r.Context())

		clientInfo := NewClientInfoFromRequest(r, h.clientHeader)

		requestContext.telemetry.addCommonAttribute(
			otel.WgClientName.String(clientInfo.Name),
			otel.WgClientVersion.String(clientInfo.Version),
			otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
		)

		startAttrs := *requestContext.telemetry.AcquireAttributes()
		startAttrs = append(startAttrs, requestContext.telemetry.metricAttrs...)

		metrics := h.metrics.StartOperation(
			requestLogger,
			r.ContentLength,
			requestContext.telemetry.metricSliceAttrs,
			otelmetric.WithAttributeSet(attribute.NewSet(startAttrs...)),
		)

		requestContext.telemetry.ReleaseAttributes(&startAttrs)

		routerSpan.SetAttributes(requestContext.telemetry.traceAttrs...)

		setTelemetryAttributes(r.Context(), requestContext, expr.BucketDefault)

		requestContext.operation = &operationContext{
			clientInfo: clientInfo,
		}

		defer func() {
			requestContext.telemetry.AddCustomMetricStringSliceAttr(ContextFieldGraphQLErrorServices, requestContext.graphQLErrorServices)
			requestContext.telemetry.AddCustomMetricStringSliceAttr(ContextFieldOperationServices, requestContext.dataSourceNames)
			requestContext.telemetry.AddCustomMetricStringSliceAttr(ContextFieldGraphQLErrorCodes, requestContext.graphQLErrorCodes)

			metrics.Finish(
				requestContext,
				statusCode,
				writtenBytes,
				h.flushTelemetryAfterResponse,
			)

			if h.flushTelemetryAfterResponse {
				h.flushMetrics(r.Context(), requestLogger)
			}
		}()

		executionOptions, traceOptions, err := h.parseRequestOptions(r, clientInfo, requestLogger)
		if err != nil {
			requestContext.SetError(err)
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

		var body []byte
		var files []*httpclient.FileUpload

		if strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
			if !h.fileUploadEnabled {
				requestContext.SetError(&httpGraphqlError{
					message:    "file upload disabled",
					statusCode: http.StatusOK,
				})
				writeOperationError(r, w, requestLogger, requestContext.error)
				return
			}

			_, readMultiPartSpan := h.tracer.Start(r.Context(), "HTTP - Read Multipart",
				trace.WithSpanKind(trace.SpanKindInternal),
				trace.WithAttributes(requestContext.telemetry.traceAttrs...),
			)

			multipartParser := NewMultipartParser(h.operationProcessor, h.maxUploadFiles, h.maxUploadFileSize)

			var err error
			body, files, err = multipartParser.Parse(r, h.getBodyReadBuffer(r.ContentLength))
			// We set it before the error so that users could log the body if it exists in case of an error
			if h.exprManager.VisitorManager.IsRequestBodyUsedInExpressions() {
				requestContext.expressionContext.Request.Body.Raw = string(body)
			}
			if err != nil {
				requestContext.SetError(err)
				writeOperationError(r, w, requestLogger, requestContext.error)
				readMultiPartSpan.End()
				return
			}

			readMultiPartSpan.SetAttributes(
				otel.HTTPRequestUploadFileCount.Int(len(files)),
			)

			readMultiPartSpan.End()

			// Cleanup all files. Needs to be called in the pre_handler function to ensure that
			// defer is called after the response is written
			defer func() {
				if err := multipartParser.RemoveAll(); err != nil {
					requestLogger.Error("Failed to remove files after multipart request", zap.Error(err))
				}
			}()
		} else if r.Method == http.MethodPost {
			_, readOperationBodySpan := h.tracer.Start(r.Context(), "HTTP - Read Body",
				trace.WithSpanKind(trace.SpanKindInternal),
				trace.WithAttributes(requestContext.telemetry.traceAttrs...),
			)

			var err error
			body, err = h.operationProcessor.ReadBody(r.Body, h.getBodyReadBuffer(r.ContentLength))
			// We set it before the error so that users could log the body if it exists in case of an error
			if h.exprManager.VisitorManager.IsRequestBodyUsedInExpressions() {
				requestContext.expressionContext.Request.Body.Raw = string(body)
			}
			if err != nil {
				requestContext.SetError(err)

				// Don't produce errors logs here because it can only be client side errors
				// e.g. too large body, slow client, aborted connection etc.
				// The error is logged as debug log in the writeOperationError function

				writeOperationError(r, w, requestLogger, err)
				readOperationBodySpan.End()
				return
			}

			readOperationBodySpan.End()
		}

		variablesParser := h.variableParsePool.Get()
		defer h.variableParsePool.Put(variablesParser)
		authenticationPass := authenticationPassNone

		if h.accessController != nil {
			_, authenticateSpan := h.tracer.Start(r.Context(), "Authenticate",
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(requestContext.telemetry.traceAttrs...),
			)

			validatedReq, err := h.accessController.Access(w, r)
			if err != nil {
				// Auth failed but introspection queries might be allowed to skip auth.
				// At this early stage we don't know wether this query is an introspection query or not.
				// We verify if the operation is allowed to skip auth, remember the result in authMode and continue.
				// At a later stage, when we know the operation type, we recall this decision, to either reject or allow
				// the operation based on wether this is an introspection query or not.

				if !h.accessController.skipIntrospectionQueries {
					// Reject the request since auth has failed
					// and skipping auth for introspection queries is not allowed,
					// so it does not matter wether this is an introspection query or not.
					h.handleAuthenticationFailure(requestContext, requestLogger, err, routerSpan, authenticateSpan, r, w)
					authenticateSpan.End()
					return
				}

				if h.accessController.IntrospectionSecretConfigured() {
					if !h.accessController.IntrospectionAccess(r, body) {
						h.handleAuthenticationFailure(requestContext, requestLogger, err, routerSpan, authenticateSpan, r, w)
						authenticateSpan.End()
						return
					}
					authenticationPass = authenticationPassIntrospectionSecret
				} else {
					authenticationPass = authenticationPassSkip
				}
			} else {
				r = validatedReq
				requestContext.expressionContext.Request.Auth = expr.LoadAuth(r.Context())
				authenticationPass = authenticationPassNormal
			}

			authenticateSpan.End()
		}

		setTelemetryAttributes(r.Context(), requestContext, expr.BucketAuth)

		err = h.handleOperation(w, r, variablesParser, &httpOperation{
			requestContext:     requestContext,
			requestLogger:      requestLogger,
			routerSpan:         routerSpan,
			operationMetrics:   metrics,
			traceTimings:       traceTimings,
			files:              files,
			body:               body,
			authenticationPass: authenticationPass,
		})
		if err != nil {
			requestContext.SetError(err)
			// Mark the root span of the router as failed, so we can easily identify failed requests
			rtrace.AttachErrToSpan(routerSpan, err)

			writeOperationError(r, w, requestLogger, err)
			return
		}

		art.SetRequestTracingStats(r.Context(), traceOptions, traceTimings)

		if traceOptions.Enable {
			reqData := &resolve.RequestData{
				Method:  r.Method,
				URL:     r.URL.String(),
				Headers: r.Header,
				Body: resolve.BodyData{
					Query:         requestContext.operation.rawContent,
					OperationName: requestContext.operation.name,
					Variables:     json.RawMessage(requestContext.operation.variables.String()),
				},
			}
			r = r.WithContext(resolve.SetRequest(r.Context(), reqData))
		}

		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		// The request context needs to be updated with the latest request to ensure that the context is up to date
		requestContext.request = r
		requestContext.responseWriter = ww

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(ww, r)

		statusCode = ww.Status()
		writtenBytes = ww.BytesWritten()

		// Mark the root span of the router as failed, so we can easily identify failed requests
		if requestContext.error != nil {
			rtrace.AttachErrToSpan(trace.SpanFromContext(r.Context()), requestContext.error)
		}
	})
}

func (h *PreHandler) shouldComputeOperationSha256(operationKit *OperationKit, reqCtx *requestContext) bool {
	// If forced, always compute the hash
	if h.computeOperationSha256 || reqCtx.forceSha256Compute {
		return true
	}

	if h.exprManager.VisitorManager.IsRequestOperationSha256UsedInExpressions() {
		return true
	}

	hasPersistedHash := operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash()

	// If it has a hash already AND a body, we need to compute the hash again to ensure it matches the persisted hash
	if hasPersistedHash && operationKit.parsedOperation.Request.Query != "" {
		return true
	}

	// If it already has a persisted hash attached to the request, then there is no need for us to compute it anew.
	// Otherwise, we only want to compute the hash (an expensive operation) if we're safelisting or logging unknown persisted operations
	if !hasPersistedHash && (h.operationBlocker.safelistEnabled || h.operationBlocker.logUnknownOperationsEnabled) {
		return true
	}

	return false
}

// shouldFetchPersistedOperation determines if we should fetch a persisted operation. The most intuitive case is if the
// operation is a persisted operation. However, we also want to fetch persisted operations if we're enabling safelisting
// and if we're logging unknown operations. This is because we want to check if the operation is already persisted in the cache
func (h *PreHandler) shouldFetchPersistedOperation(operationKit *OperationKit) bool {
	return operationKit.parsedOperation.IsPersistedOperation || h.operationBlocker.safelistEnabled || h.operationBlocker.logUnknownOperationsEnabled
}

func (h *PreHandler) handleOperation(w http.ResponseWriter, req *http.Request, variablesParser *astjson.Parser, httpOperation *httpOperation) error {
	operationKit, err := h.operationProcessor.NewKit()
	if err != nil {
		return err
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
	switch req.Method {
	case http.MethodGet:
		if err := operationKit.UnmarshalOperationFromURL(req.URL); err != nil {
			return &httpGraphqlError{
				message:    fmt.Sprintf("invalid GET request: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
	case http.MethodPost:
		if err := operationKit.UnmarshalOperationFromBody(httpOperation.body); err != nil {
			return &httpGraphqlError{
				message:    fmt.Sprintf("invalid request body: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		// If we have files, we need to set them on the parsed operation
		if len(httpOperation.files) > 0 {
			requestContext.operation.files = httpOperation.files
		}
	}

	if operationKit.isOperationNameLengthLimitExceeded(operationKit.parsedOperation.Request.OperationName) {
		return &httpGraphqlError{
			message: fmt.Sprintf("operation name of length %d exceeds max length of %d",
				len(operationKit.parsedOperation.Request.OperationName),
				operationKit.operationProcessor.operationNameLengthLimit),
			statusCode: http.StatusBadRequest,
		}
	}

	// Compute the operation sha256 hash as soon as possible for observability reasons
	if h.shouldComputeOperationSha256(operationKit, requestContext) {
		if err := operationKit.ComputeOperationSha256(); err != nil {
			return &httpGraphqlError{
				message:    fmt.Sprintf("error hashing operation: %s", err),
				statusCode: http.StatusInternalServerError,
			}
		}
		requestContext.operation.sha256Hash = operationKit.parsedOperation.Sha256Hash
		requestContext.expressionContext.Request.Operation.Sha256Hash = operationKit.parsedOperation.Sha256Hash

		setTelemetryAttributes(req.Context(), requestContext, expr.BucketSha256)

		requestContext.telemetry.addCustomMetricStringAttr(ContextFieldOperationSha256, requestContext.operation.sha256Hash)
		if h.operationBlocker.safelistEnabled || h.operationBlocker.logUnknownOperationsEnabled {
			// Set the request hash to the parsed hash, to see if it matches a persisted operation
			operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{
				Sha256Hash: operationKit.parsedOperation.Sha256Hash,
			}
		}
	}

	// Ensure if request has both hash and query, that the hash matches the query
	if operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash() && operationKit.parsedOperation.Request.Query != "" {
		if operationKit.parsedOperation.Sha256Hash != operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash {
			return &httpGraphqlError{
				message:    "persistedQuery sha256 hash does not match query body",
				statusCode: http.StatusBadRequest,
			}
		}
	}

	requestContext.operation.extensions = operationKit.parsedOperation.Request.Extensions
	requestContext.operation.variables, err = variablesParser.ParseBytes(operationKit.parsedOperation.Request.Variables)
	if err != nil {
		return &httpGraphqlError{
			message:    fmt.Sprintf("error parsing variables: %s", err),
			statusCode: http.StatusBadRequest,
		}
	}

	var (
		skipParse bool
		isApq     bool
	)

	if h.shouldFetchPersistedOperation(operationKit) {
		ctx, span := h.tracer.Start(req.Context(), "Load Persisted Operation",
			trace.WithSpanKind(trace.SpanKindClient),
			trace.WithAttributes(requestContext.telemetry.traceAttrs...),
		)

		skipParse, isApq, err = operationKit.FetchPersistedOperation(ctx, requestContext.operation.clientInfo)
		span.SetAttributes(otel.WgEnginePersistedOperationCacheHit.Bool(operationKit.parsedOperation.PersistedOperationCacheHit))
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())

			var poNotFoundErr *persistedoperation.PersistentOperationNotFoundError
			if h.operationBlocker.logUnknownOperationsEnabled && errors.As(err, &poNotFoundErr) {
				requestContext.logger.Warn("Unknown persisted operation found", zap.String("query", operationKit.parsedOperation.Request.Query), zap.String("sha256Hash", poNotFoundErr.Sha256Hash))
				if h.operationBlocker.safelistEnabled {
					span.End()
					return err
				}
			} else {
				span.End()
				return err
			}
		}

		span.End()

		requestContext.operation.persistedOperationCacheHit = operationKit.parsedOperation.PersistedOperationCacheHit
	}

	// If the persistent operation is already in the cache, we skip the parse step
	// because the operation was already parsed. This is a performance optimization, and we
	// can do it because we know that the persisted operation is immutable (identified by the hash)
	if !skipParse {
		parseCtx, engineParseSpan := h.tracer.Start(req.Context(), "Operation - Parse",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(requestContext.telemetry.traceAttrs...),
		)

		// Set the original operation on the parse span
		if h.operationContentAttributes {
			engineParseSpan.SetAttributes(otel.WgOperationOriginalContent.String(operationKit.parsedOperation.Request.Query))
		}

		httpOperation.traceTimings.StartParse()
		startParsing := time.Now()

		err = operationKit.Parse()
		if err != nil {
			rtrace.AttachErrToSpan(engineParseSpan, err)

			requestContext.operation.parsingTime = time.Since(startParsing)
			requestContext.expressionContext.Request.Operation.ParsingTime = requestContext.operation.parsingTime
			setTelemetryAttributes(parseCtx, requestContext, expr.BucketParsingTime)

			if !requestContext.operation.traceOptions.ExcludeParseStats {
				httpOperation.traceTimings.EndParse()
			}

			engineParseSpan.End()

			return err
		}

		requestContext.operation.parsingTime = time.Since(startParsing)
		requestContext.expressionContext.Request.Operation.ParsingTime = requestContext.operation.parsingTime
		setTelemetryAttributes(parseCtx, requestContext, expr.BucketParsingTime)

		if !requestContext.operation.traceOptions.ExcludeParseStats {
			httpOperation.traceTimings.EndParse()
		}

		engineParseSpan.End()
	}

	if h.accessController != nil {
		// Based on the authentication result, the introspection config,
		// and wether this is an introspection query,
		// we decide here if we need to abort the request or not.
		isIntrospection, err := operationKit.isIntrospectionQuery()
		if err != nil {
			requestContext.logger.Error("failed to check if operation is introspection, treat it like non-introspection operation", zap.Error(err))
			isIntrospection = false
		}

		// non-introspection queries are only allowed when authenticated via normal authentication
		if !isIntrospection && httpOperation.authenticationPass != authenticationPassNormal {
			return &httpGraphqlError{
				message:    "unauthorized",
				statusCode: http.StatusUnauthorized,
			}
		}

		// introspection queries are only allowed when authenticated normally or via dedicated token, or when auth skip is enabled
		// note: httpOperation.authMethod is only set when authentication is successful and the config allows such authentication.
		if isIntrospection &&
			httpOperation.authenticationPass != authenticationPassNormal &&
			httpOperation.authenticationPass != authenticationPassIntrospectionSecret &&
			httpOperation.authenticationPass != authenticationPassSkip {
			return &httpGraphqlError{
				message:    "unauthorized",
				statusCode: http.StatusUnauthorized,
			}
		}
	}

	requestContext.operation.name = operationKit.parsedOperation.Request.OperationName
	requestContext.operation.opType = operationKit.parsedOperation.Type

	requestContext.expressionContext.Request.Operation.Name = requestContext.operation.name
	requestContext.expressionContext.Request.Operation.Type = requestContext.operation.opType

	setTelemetryAttributes(req.Context(), requestContext, expr.BucketNameOrType)

	setExpressionContextClient(requestContext)

	attributesAfterParse := []attribute.KeyValue{
		otel.WgOperationName.String(operationKit.parsedOperation.Request.OperationName),
		otel.WgOperationType.String(operationKit.parsedOperation.Type),
	}

	// Add the batched operation index even if we error out later
	var batchedOperationIndex string
	if opIndex, ok := req.Context().Value(BatchedOperationId{}).(string); ok {
		batchedOperationIndex = opIndex
		attributesAfterParse = append(
			attributesAfterParse, otel.WgBatchingOperationIndex.String(batchedOperationIndex),
		)
	}

	requestContext.telemetry.addCommonAttribute(attributesAfterParse...)

	if batchedOperationIndex != "" && operationKit.parsedOperation.Type == "subscription" {
		unsupportedErr := &httpGraphqlError{
			message:    "Subscriptions aren't supported in batch operations",
			statusCode: http.StatusBadRequest,
		}
		if !h.omitBatchExtensions {
			unsupportedErr.extensionCode = ExtensionCodeBatchSubscriptionsUnsupported
		}
		return unsupportedErr
	}

	// Set the router span name after we have the operation name
	httpOperation.routerSpan.SetName(GetSpanName(operationKit.parsedOperation.Request.OperationName, operationKit.parsedOperation.Type))

	if req.Method == http.MethodGet && operationKit.parsedOperation.Type == "mutation" {
		return &httpGraphqlError{
			message:    "Mutations can only be sent over HTTP POST",
			statusCode: http.StatusMethodNotAllowed,
		}
	}

	// Set the operation name and type to the operation metrics and the router span as early as possible
	httpOperation.routerSpan.SetAttributes(attributesAfterParse...)

	if err := h.operationBlocker.OperationIsBlocked(requestContext.logger, requestContext.expressionContext, operationKit.parsedOperation); err != nil {
		return &httpGraphqlError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}

	if operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash() {
		hash := operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash
		requestContext.operation.persistedID = hash
		requestContext.expressionContext.Request.Operation.PersistedID = hash
		setTelemetryAttributes(req.Context(), requestContext, expr.BucketPersistedID)

		persistedIDAttribute := otel.WgOperationPersistedID.String(hash)

		requestContext.telemetry.addCommonAttribute(persistedIDAttribute)

		httpOperation.routerSpan.SetAttributes(persistedIDAttribute)
	}

	/**
	* Normalize the operation
	 */

	if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
		httpOperation.traceTimings.StartNormalize()
	}

	startNormalization := time.Now()

	normalizeCtx, engineNormalizeSpan := h.tracer.Start(req.Context(), "Operation - Normalize",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(requestContext.telemetry.traceAttrs...),
	)

	cached, err := operationKit.NormalizeOperation(requestContext.operation.clientInfo.Name, isApq)
	if err != nil {
		rtrace.AttachErrToSpan(engineNormalizeSpan, err)

		requestContext.operation.normalizationTime = time.Since(startNormalization)
		requestContext.expressionContext.Request.Operation.NormalizationTime = requestContext.operation.normalizationTime
		setTelemetryAttributes(normalizeCtx, requestContext, expr.BucketNormalizationTime)

		if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
			httpOperation.traceTimings.EndNormalize()
		}

		engineNormalizeSpan.End()

		return err
	}

	engineNormalizeSpan.SetAttributes(otel.WgNormalizationCacheHit.Bool(cached))
	requestContext.operation.normalizationCacheHit = operationKit.parsedOperation.NormalizationCacheHit

	/**
	* Normalize the variables
	 */

	cached, uploadsMapping, err := operationKit.NormalizeVariables()
	if err != nil {
		rtrace.AttachErrToSpan(engineNormalizeSpan, err)

		requestContext.operation.normalizationTime = time.Since(startNormalization)
		requestContext.expressionContext.Request.Operation.NormalizationTime = requestContext.operation.normalizationTime
		setTelemetryAttributes(normalizeCtx, requestContext, expr.BucketNormalizationTime)

		if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
			httpOperation.traceTimings.EndNormalize()
		}

		engineNormalizeSpan.End()
		return err
	}
	engineNormalizeSpan.SetAttributes(otel.WgVariablesNormalizationCacheHit.Bool(cached))
	requestContext.operation.variablesNormalizationCacheHit = cached

	// Update file upload paths if they were used in the nested field of the extracted variables.
	for mapping := range slices.Values(uploadsMapping) {
		// If the NewUploadPath is empty, there was no change in the path:
		// upload was directly passed to the argument. For example, "field(fileArgument: $file)"
		// will result in uploadsMapping containing such an item:
		// {VariableName: "file", OriginalUploadPath: "variables.file", NewUploadPath: ""}
		if mapping.NewUploadPath == "" {
			continue
		}

		// Look for the corresponding file that was used in the nested argument.
		idx := slices.IndexFunc(requestContext.operation.files, func(file *httpclient.FileUpload) bool {
			// Match upload path passed via slice of FileUpload with the mapping items.
			return file.VariablePath() == mapping.OriginalUploadPath
		})

		if idx == -1 {
			continue
		}

		// If NewUploadPath is not empty, the file argument was used in the nested object,
		// and we need to update the path.
		// For example, "field(arg: {file: $file})" normalized to "field(arg: $a)" will result in
		// uploadsMapping containing such an item:
		// {VariableName: "file", OriginalUploadPath: "variables.file", NewUploadPath: "variables.a.file"}
		// In short, "variables.file" should be updated to "variables.a.file".
		requestContext.operation.files[idx].SetVariablePath(uploadsMapping[idx].NewUploadPath)
	}

	// requestContext.operation.remapVariables map will contain new names as keys and
	// old names as values - to be able to extract the old values.
	// It does not rename variables in variables JSON.
	cached, err = operationKit.RemapVariables(h.disableVariablesRemapping)
	if err != nil {
		rtrace.AttachErrToSpan(engineNormalizeSpan, err)

		requestContext.operation.normalizationTime = time.Since(startNormalization)
		requestContext.expressionContext.Request.Operation.NormalizationTime = requestContext.operation.normalizationTime
		setTelemetryAttributes(normalizeCtx, requestContext, expr.BucketNormalizationTime)

		if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
			httpOperation.traceTimings.EndNormalize()
		}

		engineNormalizeSpan.End()
		return err
	}

	engineNormalizeSpan.SetAttributes(otel.WgVariablesRemappingCacheHit.Bool(cached))
	requestContext.operation.variablesRemappingCacheHit = cached
	requestContext.operation.hash = operationKit.parsedOperation.ID
	requestContext.operation.internalHash = operationKit.parsedOperation.InternalID
	requestContext.operation.remapVariables = operationKit.parsedOperation.RemapVariables

	operationHash := ""
	if requestContext.operation.hash != 0 {
		operationHash = requestContext.operation.HashString()
	}

	if !h.disableVariablesRemapping && len(uploadsMapping) > 0 {
		// after variables remapping we need to update the file uploads path because variables relative path has changed
		// but files still references the old uploads locations
		// key `to` is a new variable name
		// value `from` is an old variable name
		// we are looping through remapped variables to find a match between old variable name and variable which was holding an upload
		for to, from := range maps.All(requestContext.operation.remapVariables) {

			// loop over upload mappings to find a match between variable name and upload variable name
			for uploadMapping := range slices.Values(uploadsMapping) {
				if uploadMapping.VariableName != from {
					continue
				}

				uploadPath := uploadMapping.NewUploadPath
				// if NewUploadPath is empty it means that there was no change in the path - e.g. upload was directly passed to the argument
				if uploadPath == "" {
					uploadPath = uploadMapping.OriginalUploadPath
				}

				// next step is to compare file upload path with the original upload path from the upload mappings
				for file := range slices.Values(requestContext.operation.files) {
					if file.VariablePath() != uploadPath {
						continue
					}

					// trim old variable name prefix
					oldUploadPathPrefix := fmt.Sprintf("variables.%s.", from)
					relativeUploadPath := strings.TrimPrefix(uploadPath, oldUploadPathPrefix)

					// set new variable name prefix
					updatedPath := fmt.Sprintf("variables.%s.%s", to, relativeUploadPath)
					file.SetVariablePath(updatedPath)
				}
			}
		}
	}

	operationHashString := operationKit.parsedOperation.IDString()

	operationHashAttribute := otel.WgOperationHash.String(operationHashString)
	requestContext.telemetry.addCommonAttribute(operationHashAttribute)
	httpOperation.routerSpan.SetAttributes(operationHashAttribute)

	requestContext.operation.rawContent = operationKit.parsedOperation.Request.Query
	requestContext.operation.content = operationKit.parsedOperation.NormalizedRepresentation
	requestContext.operation.variables, err = variablesParser.ParseBytes(operationKit.parsedOperation.Request.Variables)
	if err != nil {
		rtrace.AttachErrToSpan(engineNormalizeSpan, err)
		if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
			httpOperation.traceTimings.EndNormalize()
		}
		engineNormalizeSpan.End()
		return err
	}
	requestContext.operation.normalizationTime = time.Since(startNormalization)
	requestContext.expressionContext.Request.Operation.NormalizationTime = requestContext.operation.normalizationTime
	setTelemetryAttributes(normalizeCtx, requestContext, expr.BucketNormalizationTime)

	requestContext.expressionContext.Request.Operation.Hash = operationHash
	setTelemetryAttributes(normalizeCtx, requestContext, expr.BucketHash)

	if !requestContext.operation.traceOptions.ExcludeNormalizeStats {
		httpOperation.traceTimings.EndNormalize()
	}

	// Set the normalized operation on the span
	if h.operationContentAttributes {
		engineNormalizeSpan.SetAttributes(otel.WgOperationNormalizedContent.String(operationKit.parsedOperation.NormalizedRepresentation))
	}

	if operationKit.parsedOperation.IsPersistedOperation {
		engineNormalizeSpan.SetAttributes(otel.WgEnginePersistedOperationCacheHit.Bool(operationKit.parsedOperation.PersistedOperationCacheHit))
	}

	engineNormalizeSpan.End()

	if h.traceExportVariables {
		// At this stage the variables are normalized
		httpOperation.routerSpan.SetAttributes(otel.WgOperationVariables.String(string(operationKit.parsedOperation.Request.Variables)))
	}

	/**
	* Validate the operation
	 */

	if !requestContext.operation.traceOptions.ExcludeValidateStats {
		httpOperation.traceTimings.StartValidate()
	}

	startValidation := time.Now()

	validationCtx, engineValidateSpan := h.tracer.Start(req.Context(), "Operation - Validate",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(requestContext.telemetry.traceAttrs...),
	)

	// Validate that the planned query doesn't exceed the maximum query depth configured
	// This check runs if they've configured a max query depth, and it can optionally be turned off for persisted operations
	if h.complexityLimits != nil {
		cacheHit, complexityCalcs, queryDepthErr := operationKit.ValidateQueryComplexity()
		engineValidateSpan.SetAttributes(otel.WgQueryDepth.Int(complexityCalcs.Depth))
		engineValidateSpan.SetAttributes(otel.WgQueryTotalFields.Int(complexityCalcs.TotalFields))
		engineValidateSpan.SetAttributes(otel.WgQueryRootFields.Int(complexityCalcs.RootFields))
		engineValidateSpan.SetAttributes(otel.WgQueryRootFieldAliases.Int(complexityCalcs.RootFieldAliases))
		engineValidateSpan.SetAttributes(otel.WgQueryDepthCacheHit.Bool(cacheHit))
		if queryDepthErr != nil {
			rtrace.AttachErrToSpan(engineValidateSpan, err)

			requestContext.operation.validationTime = time.Since(startValidation)
			requestContext.expressionContext.Request.Operation.ValidationTime = requestContext.operation.validationTime
			setTelemetryAttributes(validationCtx, requestContext, expr.BucketValidationTime)

			httpOperation.traceTimings.EndValidate()

			engineValidateSpan.End()

			return queryDepthErr
		}
	}

	validationCached, err := operationKit.Validate(requestContext.operation.executionOptions.SkipLoader, requestContext.operation.remapVariables, h.apolloCompatibilityFlags)
	if err != nil {
		rtrace.AttachErrToSpan(engineValidateSpan, err)

		requestContext.graphQLErrorCodes = append(requestContext.graphQLErrorCodes, h.getErrorCodes(err)...)
		requestContext.operation.validationTime = time.Since(startValidation)
		requestContext.expressionContext.Request.Operation.ValidationTime = requestContext.operation.validationTime
		setTelemetryAttributes(validationCtx, requestContext, expr.BucketValidationTime)

		if !requestContext.operation.traceOptions.ExcludeValidateStats {
			httpOperation.traceTimings.EndValidate()
		}

		engineValidateSpan.End()

		return err
	}

	engineValidateSpan.SetAttributes(otel.WgValidationCacheHit.Bool(validationCached))
	if requestContext.operation.executionOptions.SkipLoader {
		// In case we're skipping the loader, which means that we won't execute the operation
		// we skip the validation of variables as we're not using them
		// this allows us to generate query plans without having to provide variables
		engineValidateSpan.SetAttributes(otel.WgVariablesValidationSkipped.Bool(true))
	}

	requestContext.operation.validationTime = time.Since(startValidation)
	requestContext.expressionContext.Request.Operation.ValidationTime = requestContext.operation.validationTime
	setTelemetryAttributes(validationCtx, requestContext, expr.BucketValidationTime)

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

	planCtx, enginePlanSpan := h.tracer.Start(req.Context(), "Operation - Plan",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(otel.WgEngineRequestTracingEnabled.Bool(requestContext.operation.traceOptions.Enable)),
		trace.WithAttributes(requestContext.telemetry.traceAttrs...),
	)

	planOptions := PlanOptions{
		ClientInfo:           requestContext.operation.clientInfo,
		TraceOptions:         requestContext.operation.traceOptions,
		ExecutionOptions:     requestContext.operation.executionOptions,
		TrackSchemaUsageInfo: h.trackSchemaUsageInfo,
	}

	err = h.planner.plan(requestContext.operation, planOptions)
	if err != nil {
		httpOperation.requestLogger.Debug("failed to plan operation", zap.Error(err))

		if !requestContext.operation.traceOptions.ExcludePlannerStats {
			httpOperation.traceTimings.EndPlanning()
		}

		requestContext.operation.planningTime = time.Since(startPlanning)
		requestContext.expressionContext.Request.Operation.PlanningTime = requestContext.operation.planningTime
		setTelemetryAttributes(planCtx, requestContext, expr.BucketPlanningTime)

		rtrace.AttachErrToSpan(enginePlanSpan, err)
		enginePlanSpan.End()

		return err
	}

	if !requestContext.operation.traceOptions.ExcludePlannerStats {
		httpOperation.traceTimings.EndPlanning()
	}

	requestContext.operation.planningTime = time.Since(startPlanning)
	requestContext.expressionContext.Request.Operation.PlanningTime = requestContext.operation.planningTime
	setTelemetryAttributes(planCtx, requestContext, expr.BucketPlanningTime)

	enginePlanSpan.SetAttributes(otel.WgEnginePlanCacheHit.Bool(requestContext.operation.planCacheHit))
	enginePlanSpan.End()

	planningAttrs := *requestContext.telemetry.AcquireAttributes()
	planningAttrs = append(planningAttrs, otel.WgEnginePlanCacheHit.Bool(requestContext.operation.planCacheHit))
	planningAttrs = append(planningAttrs, requestContext.telemetry.metricAttrs...)

	httpOperation.operationMetrics.routerMetrics.MetricStore().MeasureOperationPlanningTime(
		req.Context(),
		requestContext.operation.planningTime,
		requestContext.telemetry.metricSliceAttrs,
		otelmetric.WithAttributeSet(attribute.NewSet(planningAttrs...)),
	)

	requestContext.telemetry.ReleaseAttributes(&planningAttrs)

	// we could log the query plan only if query plans are calculated
	if (h.queryPlansEnabled && requestContext.operation.executionOptions.IncludeQueryPlanInResponse) ||
		h.alwaysIncludeQueryPlan {

		switch p := requestContext.operation.preparedPlan.preparedPlan.(type) {
		case *plan.SynchronousResponsePlan:
			p.Response.Fetches.NormalizedQuery = operationKit.parsedOperation.NormalizedRepresentation
		}

		if h.queryPlansLoggingEnabled {
			var printedPlan string
			switch p := requestContext.operation.preparedPlan.preparedPlan.(type) {
			case *plan.SynchronousResponsePlan:
				printedPlan = p.Response.Fetches.QueryPlan().PrettyPrint()
			case *plan.SubscriptionResponsePlan:
				printedPlan = p.Response.Response.Fetches.QueryPlan().PrettyPrint()
			}
			if h.developmentMode {
				h.log.Sugar().Debugf("Query Plan:\n%s", printedPlan)
			} else {
				h.log.Debug("Query Plan", zap.String("query_plan", printedPlan))
			}
		}
	}

	return nil
}

func (h *PreHandler) getErrorCodes(err error) []string {
	errorCodes := make([]string, 0)

	var reportErr *reportError
	if errors.As(err, &reportErr) {
		for _, extError := range reportErr.Report().ExternalErrors {
			if extError.ExtensionCode != "" {
				errorCodes = append(errorCodes, extError.ExtensionCode)
			}
		}
	}

	// If "skipLoader" was passed as false to the Validate function, an httpGraphqlError with
	// an extension code could be returned
	var httpGqlError *httpGraphqlError
	if errors.As(err, &httpGqlError) {
		extensionCode := httpGqlError.ExtensionCode()
		if extensionCode != "" {
			errorCodes = append(errorCodes, extensionCode)
		}
	}

	return errorCodes
}

// flushMetrics flushes all metrics to the respective exporters
// only used for serverless router build
func (h *PreHandler) handleAuthenticationFailure(requestContext *requestContext, requestLogger *zap.Logger, err error, routerSpan trace.Span, authenticateSpan trace.Span, r *http.Request, w http.ResponseWriter) {
	requestContext.SetError(err)
	requestLogger.Debug("Failed to authenticate request", zap.Error(err))

	// Mark the root span of the router as failed, so we can easily identify failed requests
	rtrace.AttachErrToSpan(routerSpan, err)
	rtrace.AttachErrToSpan(authenticateSpan, err)

	writeOperationError(r, w, requestLogger, &httpGraphqlError{
		message:    err.Error(),
		statusCode: http.StatusUnauthorized,
	})
}

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
				requestLogger.Debug(fmt.Sprintf("failed to parse request token: %s", err.Error()))
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

func setExpressionContextClient(requestContext *requestContext) {
	clientName := requestContext.operation.clientInfo.Name
	if clientName == "unknown" {
		clientName = ""
	}

	clientVersion := requestContext.operation.clientInfo.Version
	if clientVersion == "missing" {
		clientVersion = ""
	}

	if clientName != "" || clientVersion != "" {
		requestContext.expressionContext.Request.Client.Name = clientName
		requestContext.expressionContext.Request.Client.Version = clientVersion
	}
}
