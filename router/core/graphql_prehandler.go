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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	otelmetric "go.opentelemetry.io/otel/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/astjson"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/pkg/art"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization/uploads"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"
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

	FlushTelemetryAfterResponse            bool
	FileUploadEnabled                      bool
	TraceExportVariables                   bool
	DevelopmentMode                        bool
	ForceUnauthenticatedRequestTracing     bool
	EnableRequestTracing                   bool
	AlwaysIncludeQueryPlan                 bool
	AlwaysSkipLoader                       bool
	QueryPlansEnabled                      bool
	QueryPlansLoggingEnabled               bool
	TrackSchemaUsageInfo                   bool
	ClientHeader                           config.ClientHeader
	ComputeOperationSha256                 bool
	ApolloCompatibilityFlags               *config.ApolloCompatibilityFlags
	DisableVariablesRemapping              bool
	ExprManager                            *expr.Manager
	OmitBatchExtensions                    bool
	OperationContentAttributes             bool
	EnableRequestDeduplication             bool
	ForceEnableRequestDeduplication        bool
	HasPreOriginHandlers                   bool
	EnableInboundRequestDeduplication      bool
	ForceEnableInboundRequestDeduplication bool
	HeaderPropagation                      *HeaderPropagation
	SpanNameFormatter                      SpanNameFormatterFunc

	// WaitForCacheWrites is set when Debug.SynchronousCacheWrites is enabled; it blocks until pending async operation-cache writes are applied.
	WaitForCacheWrites func()
}

type PreHandler struct {
	log                                    *zap.Logger
	executor                               *Executor
	metrics                                RouterMetrics
	operationProcessor                     *OperationProcessor
	planner                                *OperationPlanner
	accessController                       *AccessController
	operationBlocker                       *OperationBlocker
	headerPropagation                      *HeaderPropagation
	developmentMode                        bool
	forceUnauthenticatedRequestTracing     bool
	alwaysIncludeQueryPlan                 bool
	alwaysSkipLoader                       bool
	queryPlansEnabled                      bool // queryPlansEnabled is a flag to enable query plans output in the extensions
	queryPlansLoggingEnabled               bool // queryPlansLoggingEnabled is a flag to enable logging of query plans
	routerPublicKey                        *ecdsa.PublicKey
	enableRequestTracing                   bool
	tracerProvider                         *sdktrace.TracerProvider
	flushTelemetryAfterResponse            bool
	tracer                                 trace.Tracer
	traceExportVariables                   bool
	fileUploadEnabled                      bool
	maxUploadFiles                         int
	maxUploadFileSize                      int
	complexityLimits                       *config.ComplexityLimits
	trackSchemaUsageInfo                   bool
	clientHeader                           config.ClientHeader
	computeOperationSha256                 bool
	apolloCompatibilityFlags               *config.ApolloCompatibilityFlags
	disableVariablesRemapping              bool
	exprManager                            *expr.Manager
	omitBatchExtensions                    bool
	operationContentAttributes             bool
	enableRequestDeduplication             bool
	forceEnableRequestDeduplication        bool
	hasPreOriginHandlers                   bool
	enableInboundRequestDeduplication      bool
	forceEnableInboundRequestDeduplication bool
	spanNameFormatter                      SpanNameFormatterFunc
	waitForCacheWrites                     func()
}

// handlerScope holds the state of a single request while it passes through the pre handler.
// The PreHandler only holds the configuration and dependencies shared by all requests.
type handlerScope struct {
	h *PreHandler

	// r is the current request. It is replaced whenever its context changes,
	// e.g. after authentication.
	r                *http.Request
	ww               middleware.WrapResponseWriter
	requestContext   *requestContext
	requestLogger    *zap.Logger
	routerSpan       trace.Span
	operationMetrics *OperationMetrics
	traceTimings     *art.TraceTimings

	// Set while the request passes through the pre handler
	body               []byte
	files              []*httpclient.FileUpload
	authenticationPass authenticationPass

	scopeEndFuncs []func()
}

func (h *PreHandler) newHandlerScope(w http.ResponseWriter, r *http.Request) *handlerScope {
	requestContext := getRequestContext(r.Context())

	return &handlerScope{
		h: h,
		r: r,
		// Wrap the response writer early so that all paths (including early returns
		// for auth failures, bad requests, etc.) have the actual HTTP status code
		ww:             middleware.NewWrapResponseWriter(w, r.ProtoMajor),
		requestContext: requestContext,
		requestLogger:  requestContext.logger,
		routerSpan:     trace.SpanFromContext(r.Context()),
	}
}

// deferToScopeEnd registers f to run when the scope ends, e.g. after the response is written.
func (s *handlerScope) deferToScopeEnd(f func()) {
	s.scopeEndFuncs = append(s.scopeEndFuncs, f)
}

// end runs the functions registered with deferToScopeEnd. Like defer, they run in reverse order.
func (s *handlerScope) end() {
	for _, f := range slices.Backward(s.scopeEndFuncs) {
		f()
	}
}

type authenticationPass int

const (
	authenticationPassNone authenticationPass = iota
	authenticationPassNormal
	authenticationPassIntrospectionSecret
	authenticationPassSkip
)

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	spanNameFormatter := opts.SpanNameFormatter
	if spanNameFormatter == nil {
		spanNameFormatter = DefaultSpanNameFormatter
	}
	return &PreHandler{
		log:                                opts.Logger,
		executor:                           opts.Executor,
		metrics:                            opts.Metrics,
		operationProcessor:                 opts.OperationProcessor,
		planner:                            opts.Planner,
		accessController:                   opts.AccessController,
		operationBlocker:                   opts.OperationBlocker,
		routerPublicKey:                    opts.RouterPublicKey,
		developmentMode:                    opts.DevelopmentMode,
		enableRequestTracing:               opts.EnableRequestTracing,
		forceUnauthenticatedRequestTracing: opts.ForceUnauthenticatedRequestTracing,
		flushTelemetryAfterResponse:        opts.FlushTelemetryAfterResponse,
		tracerProvider:                     opts.TracerProvider,
		traceExportVariables:               opts.TraceExportVariables,
		tracer: opts.TracerProvider.Tracer(
			"wundergraph/cosmo/router/pre_handler",
			trace.WithInstrumentationVersion("0.0.1"),
		),
		fileUploadEnabled:                      opts.FileUploadEnabled,
		maxUploadFiles:                         opts.MaxUploadFiles,
		maxUploadFileSize:                      opts.MaxUploadFileSize,
		complexityLimits:                       opts.ComplexityLimits,
		alwaysIncludeQueryPlan:                 opts.AlwaysIncludeQueryPlan,
		alwaysSkipLoader:                       opts.AlwaysSkipLoader,
		queryPlansEnabled:                      opts.QueryPlansEnabled,
		queryPlansLoggingEnabled:               opts.QueryPlansLoggingEnabled,
		trackSchemaUsageInfo:                   opts.TrackSchemaUsageInfo,
		clientHeader:                           opts.ClientHeader,
		computeOperationSha256:                 opts.ComputeOperationSha256,
		apolloCompatibilityFlags:               opts.ApolloCompatibilityFlags,
		disableVariablesRemapping:              opts.DisableVariablesRemapping,
		exprManager:                            opts.ExprManager,
		omitBatchExtensions:                    opts.OmitBatchExtensions,
		operationContentAttributes:             opts.OperationContentAttributes,
		enableRequestDeduplication:             opts.EnableRequestDeduplication,
		forceEnableRequestDeduplication:        opts.ForceEnableRequestDeduplication,
		hasPreOriginHandlers:                   opts.HasPreOriginHandlers,
		enableInboundRequestDeduplication:      opts.EnableInboundRequestDeduplication,
		forceEnableInboundRequestDeduplication: opts.ForceEnableInboundRequestDeduplication,
		headerPropagation:                      opts.HeaderPropagation,
		spanNameFormatter:                      spanNameFormatter,
		waitForCacheWrites:                     opts.WaitForCacheWrites,
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
		s := h.newHandlerScope(w, r)
		defer s.end()

		s.startOperation()

		if err := s.setRequestOptions(); err != nil {
			s.requestContext.SetError(err)
			writeRequestErrors(writeRequestErrorsParams{
				request:           s.r,
				writer:            s.ww,
				statusCode:        http.StatusBadRequest,
				requestErrors:     graphqlerrors.RequestErrorsFromError(err),
				logger:            s.requestLogger,
				headerPropagation: h.headerPropagation,
			})
			return
		}

		if err := s.readRequestBody(); err != nil {
			s.requestContext.SetError(err)
			// Don't produce error logs here because these are client side errors
			// e.g. too large body, slow client, aborted connection etc.
			// The error is logged as debug log in the writeOperationError function
			writeOperationError(s.r, s.ww, s.requestLogger, err, h.headerPropagation)
			return
		}

		if !s.authenticate() {
			return
		}

		setTelemetryAttributes(s.r.Context(), s.requestContext, expr.BucketAuth)

		if err := s.handleOperation(); err != nil {
			s.writeHandleOperationError(err)
			return
		}

		// The raw body is not needed anymore once the operation is handled. Release it, because
		// the scope lives until the request ends, which can take hours for subscriptions.
		s.body = nil

		s.prepareRequestForExecution()

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(s.ww, s.r)

		if s.requestContext.error != nil {
			recordSpanError(trace.SpanFromContext(s.r.Context()), s.requestContext.error)
		}
	})
}

// startOperation adds the client attributes to the telemetry and starts the operation metrics.
// The metrics are finished when the scope ends.
func (s *handlerScope) startOperation() {
	requestContext := s.requestContext
	clientInfo := NewClientInfoFromRequest(s.r, s.h.clientHeader)

	requestContext.telemetry.addCommonAttribute(
		otel.WgClientName.String(clientInfo.Name),
		otel.WgClientVersion.String(clientInfo.Version),
		otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
	)

	startAttrs := *requestContext.telemetry.AcquireAttributes()
	startAttrs = append(startAttrs, requestContext.telemetry.metricAttrs...)

	s.operationMetrics = s.h.metrics.StartOperation(
		s.requestLogger,
		s.r.ContentLength,
		requestContext.telemetry.metricSliceAttrs,
		otelmetric.WithAttributeSet(attribute.NewSet(startAttrs...)),
	)

	requestContext.telemetry.ReleaseAttributes(&startAttrs)

	s.routerSpan.SetAttributes(requestContext.telemetry.traceAttrs...)

	setTelemetryAttributes(s.r.Context(), requestContext, expr.BucketDefault)

	requestContext.operation = &operationContext{
		clientInfo: clientInfo,
	}

	s.deferToScopeEnd(s.finishOperation)
}

// finishOperation records the final attributes and finishes the operation metrics.
// It runs after the response is written.
func (s *handlerScope) finishOperation() {
	requestContext := s.requestContext

	requestContext.telemetry.AddCustomMetricStringSliceAttr(ContextFieldGraphQLErrorServices, requestContext.graphQLErrorServices)
	requestContext.telemetry.AddCustomMetricStringSliceAttr(ContextFieldOperationServices, requestContext.dataSourceNames)
	requestContext.telemetry.AddCustomMetricStringSliceAttr(ContextFieldGraphQLErrorCodes, requestContext.graphQLErrorCodes)

	if cacheStatus, ok := requestContext.responseCacheStatus(); ok {
		s.routerSpan.SetAttributes(otel.WgOperationResponseCacheStatus.String(cacheStatus.String()))
		requestContext.expressionContext.Response.Cache.Status = cacheStatus.String()
	}

	// Read the actual status code from the wrapped response writer.
	// This captures the correct status code for all paths, including early returns.
	s.operationMetrics.Finish(
		requestContext,
		s.ww.Status(),
		s.ww.BytesWritten(),
		s.h.flushTelemetryAfterResponse,
	)

	if s.h.flushTelemetryAfterResponse {
		s.h.flushMetrics(s.r.Context(), s.requestLogger)
	}
}

// setRequestOptions parses the execution and trace options of the request.
func (s *handlerScope) setRequestOptions() error {
	operation := s.requestContext.operation

	executionOptions, traceOptions, err := s.h.parseExecutionAndTraceOptions(s.r, operation.clientInfo, s.requestLogger)
	if err != nil {
		return err
	}

	operation.protocol = OperationProtocolHTTP
	operation.executionOptions = executionOptions
	operation.traceOptions = traceOptions
	s.requestContext.cacheControl = parseRequestCacheControl(s.r.Header)

	if traceOptions.Enable {
		s.r = s.r.WithContext(resolve.SetTraceStart(s.r.Context(), traceOptions.EnablePredictableDebugTimings))
		s.traceTimings = art.NewTraceTimings(s.r.Context())
	}

	return nil
}

// readRequestBody reads the GraphQL request body. Multipart requests also set the uploaded
// files, which are removed when the scope ends.
func (s *handlerScope) readRequestBody() error {
	if strings.Contains(s.r.Header.Get("Content-Type"), "multipart/form-data") {
		if !s.h.fileUploadEnabled {
			return &httpGraphqlError{
				message:    "file upload disabled",
				statusCode: http.StatusOK,
			}
		}
		return s.readMultipartBody()
	}

	if s.r.Method != http.MethodPost {
		return nil
	}

	_, readOperationBodySpan := s.h.tracer.Start(s.r.Context(), "HTTP - Read Body",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(s.requestContext.telemetry.traceAttrs...),
	)
	defer readOperationBodySpan.End()

	body, err := s.h.operationProcessor.ReadBody(s.r.Body, s.h.getBodyReadBuffer(s.r.ContentLength))
	s.setExpressionRequestBody(body)
	if err != nil {
		return err
	}

	s.body = body
	return nil
}

func (s *handlerScope) readMultipartBody() error {
	_, readMultiPartSpan := s.h.tracer.Start(s.r.Context(), "HTTP - Read Multipart",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(s.requestContext.telemetry.traceAttrs...),
	)
	defer readMultiPartSpan.End()

	multipartParser := NewMultipartParser(s.h.operationProcessor, s.h.maxUploadFiles, s.h.maxUploadFileSize)

	// Uploaded files are removed when the scope ends to ensure that
	// this runs after the response is written. It is registered before
	// parsing, so files written before a parse error are removed as well.
	s.deferToScopeEnd(func() {
		if err := multipartParser.RemoveAll(); err != nil {
			s.requestLogger.Error("Failed to remove files after multipart request", zap.Error(err))
		}
	})

	body, files, err := multipartParser.Parse(s.r, s.h.getBodyReadBuffer(s.r.ContentLength))
	s.setExpressionRequestBody(body)
	if err != nil {
		return err
	}

	readMultiPartSpan.SetAttributes(
		otel.HTTPRequestUploadFileCount.Int(len(files)),
	)

	s.body = body
	s.files = files
	return nil
}

// setExpressionRequestBody is called before the read error is checked, so that users
// can log the body if it exists in case of an error.
func (s *handlerScope) setExpressionRequestBody(body []byte) {
	if s.h.exprManager.VisitorManager.IsRequestBodyUsedInExpressions() {
		s.requestContext.expressionContext.Request.Body.Raw = string(body)
	}
}

// authenticate runs the access controller and sets the authentication pass.
// It returns false when authentication failed and the error response is already written.
func (s *handlerScope) authenticate() bool {
	accessController := s.h.accessController
	if accessController == nil {
		s.authenticationPass = authenticationPassNone
		return true
	}

	_, authenticateSpan := s.h.tracer.Start(s.r.Context(), "Authenticate",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(s.requestContext.telemetry.traceAttrs...),
	)
	defer authenticateSpan.End()

	validatedReq, err := accessController.Access(s.ww, s.r)
	if err == nil {
		s.r = validatedReq
		s.requestContext.expressionContext.Request.Auth = expr.LoadAuth(s.r.Context())
		s.authenticationPass = authenticationPassNormal
		return true
	}

	// Auth failed but introspection queries might be allowed to skip auth.
	// At this early stage we don't know whether this query is an introspection query or not.
	// We verify if the operation is allowed to skip auth, remember the result in the authentication pass and continue.
	// At a later stage, when we know the operation type, we recall this decision, to either reject or allow
	// the operation based on whether this is an introspection query or not.

	if !accessController.skipIntrospectionQueries {
		// Skipping auth for introspection queries is not allowed,
		// so it does not matter whether this is an introspection query or not.
		s.h.handleAuthenticationFailure(s.requestContext, s.requestLogger, err, s.routerSpan, authenticateSpan, s.r, s.ww)
		return false
	}

	if !accessController.IntrospectionSecretConfigured() {
		s.authenticationPass = authenticationPassSkip
		return true
	}

	if !accessController.IntrospectionAccess(s.r, s.body) {
		s.h.handleAuthenticationFailure(s.requestContext, s.requestLogger, err, s.routerSpan, authenticateSpan, s.r, s.ww)
		return false
	}

	s.authenticationPass = authenticationPassIntrospectionSecret
	return true
}

// writeHandleOperationError records an error returned by handleOperation and writes it as the response.
func (s *handlerScope) writeHandleOperationError(err error) {
	requestContext := s.requestContext

	requestContext.SetError(err)
	recordSpanError(s.routerSpan, err)

	// Report the estimated cost in case of errors.
	// The actual cost is only available for successful requests.
	costControl := s.h.operationProcessor.costControl
	if !errors.Is(err, context.Canceled) &&
		costControl != nil && costControl.ExposeHeaders &&
		requestContext.operation != nil && requestContext.operation.costEstimatedSet {
		s.ww.Header().Set(CostEstimatedHeader, strconv.Itoa(requestContext.operation.costEstimated))
	}

	writeOperationError(s.r, s.ww, s.requestLogger, err, s.h.headerPropagation)
}

// prepareRequestForExecution sets the request that is passed to the next handler
// and stores it in the request context.
func (s *handlerScope) prepareRequestForExecution() {
	requestContext := s.requestContext
	traceOptions := requestContext.operation.traceOptions

	if s.h.waitForCacheWrites != nil {
		s.h.waitForCacheWrites()
	}

	art.SetRequestTracingStats(s.r.Context(), traceOptions, s.traceTimings)

	if traceOptions.Enable {
		reqData := &resolve.RequestData{
			Method:  s.r.Method,
			URL:     s.r.URL.String(),
			Headers: s.r.Header,
			Body: resolve.BodyData{
				Query:         requestContext.operation.rawContent,
				OperationName: requestContext.operation.name,
				Variables:     json.RawMessage(requestContext.operation.variables.String()),
			},
		}
		s.r = s.r.WithContext(resolve.SetRequest(s.r.Context(), reqData))
	}

	// The request context needs to be updated with the latest request to ensure that the context is up to date
	requestContext.request = s.r
	requestContext.responseWriter = s.ww
}

// recordSpanError marks the span as failed, so we can easily identify failed requests.
// Client disconnections are not server-side errors, so they are only recorded
// without setting the span status to ERROR.
func recordSpanError(span trace.Span, err error) {
	if errors.Is(err, context.Canceled) {
		span.RecordError(err)
		return
	}
	rtrace.AttachErrToSpan(span, err)
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

	// APQ requests with a body must match their supplied hash.
	if operationKit.persistedQueryHashMustMatchQuery() {
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

// handleOperation reads, parses, normalizes, validates and plans the operation of the request.
func (s *handlerScope) handleOperation() error {
	operationKit, err := s.h.operationProcessor.NewKit()
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

	if err := s.unmarshalOperation(operationKit); err != nil {
		return err
	}

	if err := s.setOperationSha256(operationKit); err != nil {
		return err
	}

	if err := s.setRequestVariables(operationKit); err != nil {
		return err
	}

	skipParse, isApq, err := s.loadPersistedOperation(operationKit)
	if err != nil {
		return err
	}

	// If the persistent operation is already in the cache, we skip the parse step
	// because the operation was already parsed. This is a performance optimization, and we
	// can do it because manifest cache entries are scoped to the captured revision.
	// Operations outside a manifest must remain immutable within their storage scope.
	if !skipParse {
		if err := s.parseOperation(operationKit); err != nil {
			return err
		}
	}

	if err := s.authorizeIntrospection(operationKit); err != nil {
		return err
	}

	if err := s.identifyOperation(operationKit); err != nil {
		return err
	}

	validation, err := s.normalizeOperation(operationKit, isApq)
	if err != nil {
		return err
	}

	if err := s.validateOperation(operationKit, validation); err != nil {
		return err
	}

	if err := s.planOperation(operationKit); err != nil {
		return err
	}

	return s.checkDeferAccept()
}

// stageKind is one of the stages of handling an operation that are measured with a span,
// the trace timings and a duration in the request context.
type stageKind int

const (
	stageParse stageKind = iota
	stageNormalize
	stageValidate
	stagePlan
)

var stageSpanNames = [...]string{
	stageParse:     "Operation - Parse",
	stageNormalize: "Operation - Normalize",
	stageValidate:  "Operation - Validate",
	stagePlan:      "Operation - Plan",
}

// operationStage measures one stage. It is started with startStage and must be ended with end.
type operationStage struct {
	s     *handlerScope
	kind  stageKind
	ctx   context.Context
	span  trace.Span
	start time.Time
}

// startStage starts a span for the stage and its trace timings, and starts measuring its
// duration. The returned stage must be ended with end, or with recordDuration followed by
// ending its span. spanOptions are added to the default options of the span.
func (s *handlerScope) startStage(kind stageKind, spanOptions ...trace.SpanStartOption) operationStage {
	spanOptions = append(spanOptions,
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(s.requestContext.telemetry.traceAttrs...),
	)
	ctx, span := s.h.tracer.Start(s.r.Context(), stageSpanNames[kind], spanOptions...)

	// The trace timings are always recorded. Excluded stats are left out
	// when they are reported, see art.SetRequestTracingStats.
	switch kind {
	case stageParse:
		s.traceTimings.StartParse()
	case stageNormalize:
		s.traceTimings.StartNormalize()
	case stageValidate:
		s.traceTimings.StartValidate()
	case stagePlan:
		s.traceTimings.StartPlanning()
	}

	return operationStage{s: s, kind: kind, ctx: ctx, span: span, start: time.Now()}
}

// end records the duration of the stage and ends its span. A non-nil err is attached to the span.
func (st operationStage) end(err error) {
	st.recordDuration(err)
	st.span.End()
}

// recordDuration records the duration of the stage without ending its span, for stages
// that set attributes on the span which depend on the duration being recorded.
// A non-nil err is attached to the span.
func (st operationStage) recordDuration(err error) {
	if err != nil {
		rtrace.AttachErrToSpan(st.span, err)
	}

	duration := time.Since(st.start)
	requestContext := st.s.requestContext
	exprOperation := &requestContext.expressionContext.Request.Operation

	switch st.kind {
	case stageParse:
		requestContext.operation.parsingTime = duration
		exprOperation.ParsingTime = duration
		setTelemetryAttributes(st.ctx, requestContext, expr.BucketParsingTime)
		st.s.traceTimings.EndParse()
	case stageNormalize:
		requestContext.operation.normalizationTime = duration
		exprOperation.NormalizationTime = duration
		setTelemetryAttributes(st.ctx, requestContext, expr.BucketNormalizationTime)
		st.s.traceTimings.EndNormalize()
	case stageValidate:
		requestContext.operation.validationTime = duration
		exprOperation.ValidationTime = duration
		setTelemetryAttributes(st.ctx, requestContext, expr.BucketValidationTime)
		st.s.traceTimings.EndValidate()
	case stagePlan:
		requestContext.operation.planningTime = duration
		exprOperation.PlanningTime = duration
		setTelemetryAttributes(st.ctx, requestContext, expr.BucketPlanningTime)
		st.s.traceTimings.EndPlanning()
	}
}

// unmarshalOperation reads the operation from the GET parameters or the POST body.
func (s *handlerScope) unmarshalOperation(operationKit *OperationKit) error {
	switch s.r.Method {
	case http.MethodGet:
		if err := operationKit.UnmarshalOperationFromURL(s.r.URL); err != nil {
			return &httpGraphqlError{
				message:    fmt.Sprintf("invalid GET request: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
	case http.MethodPost:
		if err := operationKit.UnmarshalOperationFromBody(s.body); err != nil {
			return &httpGraphqlError{
				message:    fmt.Sprintf("invalid request body: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		// If we have files, we need to set them on the parsed operation
		if len(s.files) > 0 {
			s.requestContext.operation.files = s.files
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

	return nil
}

// setOperationSha256 populates the operation telemetry with the sha256 hash before
// persisted operations are resolved, and checks that APQ hashes match the query.
func (s *handlerScope) setOperationSha256(operationKit *OperationKit) error {
	requestContext := s.requestContext

	if s.h.shouldComputeOperationSha256(operationKit, requestContext) {
		if operationKit.hasCustomPersistedOperationID() ||
			(operationKit.parsedOperation.Request.Query == "" && operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash()) {
			// Preserve the supplied persisted ID in telemetry, including custom IDs.
			requestContext.operation.sha256Hash = operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash
			requestContext.expressionContext.Request.Operation.Sha256Hash = requestContext.operation.sha256Hash

			setTelemetryAttributes(s.r.Context(), requestContext, expr.BucketSha256)

			requestContext.telemetry.addCustomMetricStringAttr(ContextFieldOperationSha256, requestContext.operation.sha256Hash)
		} else {
			if err := operationKit.ComputeOperationSha256(); err != nil {
				return &httpGraphqlError{
					message:    fmt.Sprintf("error hashing operation: %s", err),
					statusCode: http.StatusInternalServerError,
				}
			}
			requestContext.operation.sha256Hash = operationKit.parsedOperation.Sha256Hash
			requestContext.expressionContext.Request.Operation.Sha256Hash = operationKit.parsedOperation.Sha256Hash

			setTelemetryAttributes(s.r.Context(), requestContext, expr.BucketSha256)

			requestContext.telemetry.addCustomMetricStringAttr(ContextFieldOperationSha256, requestContext.operation.sha256Hash)
			if s.h.operationBlocker.safelistEnabled || s.h.operationBlocker.logUnknownOperationsEnabled {
				if !operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash() {
					// Set the request hash to the parsed hash, to see if it matches a persisted operation
					operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{
						Sha256Hash: operationKit.parsedOperation.Sha256Hash,
					}
				}
			}
		}
	}

	// APQ IDs must match the supplied query body.
	if operationKit.persistedQueryHashMustMatchQuery() {
		if operationKit.parsedOperation.Sha256Hash != operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash {
			return &httpGraphqlError{
				message:    "persistedQuery sha256 hash does not match query body",
				statusCode: http.StatusBadRequest,
			}
		}
	}

	return nil
}

// setRequestVariables parses the variables of the request into the request context.
func (s *handlerScope) setRequestVariables(operationKit *OperationKit) error {
	requestContext := s.requestContext

	var err error
	requestContext.operation.extensions = operationKit.parsedOperation.Request.Extensions
	requestContext.operation.variablesHash = operationKit.parsedOperation.VariablesHash
	requestContext.operation.variables, err = astjson.ParseBytes(operationKit.parsedOperation.Request.Variables)
	// Expose the variables JSON to expressions as early as possible so it is available for access logs
	// even if a later stage fails. It is only serialized when an expression references
	// request.operation.variables, to avoid the (potentially large) serialization cost on every request.
	// The value can contain sensitive data, so it should be logged with care.
	if s.h.exprManager.VisitorManager.IsRequestOperationVariablesUsedInExpressions() {
		requestContext.expressionContext.Request.Operation.Variables = string(operationKit.parsedOperation.Request.Variables)
	}
	if err != nil {
		return &httpGraphqlError{
			message:    fmt.Sprintf("error parsing variables: %s", err),
			statusCode: http.StatusBadRequest,
		}
	}

	return nil
}

// loadPersistedOperation loads the persisted operation, when the request references one
// or when safelisting or logging unknown operations requires checking it.
func (s *handlerScope) loadPersistedOperation(operationKit *OperationKit) (skipParse bool, isApq bool, err error) {
	if !s.h.shouldFetchPersistedOperation(operationKit) {
		return false, false, nil
	}

	requestContext := s.requestContext

	ctx, span := s.h.tracer.Start(s.r.Context(), "Load Persisted Operation",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(requestContext.telemetry.traceAttrs...),
	)
	defer span.End()

	skipParse, isApq, err = operationKit.FetchPersistedOperation(ctx, requestContext.operation.clientInfo)
	span.SetAttributes(otel.WgEnginePersistedOperationCacheHit.Bool(operationKit.parsedOperation.PersistedOperationCacheHit))
	if err != nil {
		span.RecordError(err)
		if !errors.Is(err, context.Canceled) {
			rtrace.SetSanitizedSpanStatus(span, codes.Error, err.Error())
		}

		var poNotFoundErr *persistedoperation.PersistentOperationNotFoundError
		if s.h.operationBlocker.logUnknownOperationsEnabled && errors.As(err, &poNotFoundErr) {
			requestContext.logger.Warn("Unknown persisted operation found", zap.String("query", operationKit.parsedOperation.Request.Query), zap.String("sha256Hash", poNotFoundErr.Sha256Hash))
			// When log_unknown is enabled, ad-hoc queries whose hash doesn't match a
			// persisted operation are logged above. We only allow execution to continue
			// when the request includes a query body (the ad-hoc query to run) and
			// safelist is not enforced. Hash-only requests without a body have nothing
			// to execute, so we always return the not-found error in that case. Custom
			// IDs don't identify their body, so an unknown custom ID is always rejected.
			if !s.h.operationBlocker.safelistEnabled && operationKit.parsedOperation.Request.Query != "" && !operationKit.hasCustomPersistedOperationID() {
				err = nil
			}
		}
		if err != nil {
			return false, false, err
		}
	}

	requestContext.operation.persistedOperationCacheHit = operationKit.parsedOperation.PersistedOperationCacheHit
	requestContext.expressionContext.Request.Operation.PersistedOperationCacheHit = operationKit.parsedOperation.PersistedOperationCacheHit

	return skipParse, isApq, nil
}

func (s *handlerScope) parseOperation(operationKit *OperationKit) error {
	stage := s.startStage(stageParse)

	// Set the original operation on the parse span
	if s.h.operationContentAttributes {
		stage.span.SetAttributes(otel.WgOperationOriginalContent.String(operationKit.parsedOperation.Request.Query))
	}

	err := operationKit.Parse()
	stage.end(err)

	return err
}

// authorizeIntrospection decides, based on the authentication result, the introspection
// config and whether this is an introspection query, if the request is aborted.
func (s *handlerScope) authorizeIntrospection(operationKit *OperationKit) error {
	if s.h.accessController == nil {
		return nil
	}

	isIntrospection, err := operationKit.isIntrospectionQuery()
	if err != nil {
		s.requestContext.logger.Error("failed to check if operation is introspection, treat it like non-introspection operation", zap.Error(err))
		isIntrospection = false
	}

	// non-introspection queries are only allowed when authenticated via normal authentication
	if !isIntrospection && s.authenticationPass != authenticationPassNormal {
		return &httpGraphqlError{
			message:    "unauthorized",
			statusCode: http.StatusUnauthorized,
		}
	}

	// introspection queries are only allowed when authenticated normally or via dedicated token, or when auth skip is enabled
	// note: s.authenticationPass is only set when authentication is successful and the config allows such authentication.
	if isIntrospection &&
		s.authenticationPass != authenticationPassNormal &&
		s.authenticationPass != authenticationPassIntrospectionSecret &&
		s.authenticationPass != authenticationPassSkip {
		return &httpGraphqlError{
			message:    "unauthorized",
			statusCode: http.StatusUnauthorized,
		}
	}

	return nil
}

// identifyOperation sets the operation name, type and persisted ID on the request context
// and the telemetry. In between, it rejects operations that aren't allowed for this request.
func (s *handlerScope) identifyOperation(operationKit *OperationKit) error {
	requestContext := s.requestContext

	requestContext.operation.name = operationKit.parsedOperation.Request.OperationName
	requestContext.operation.opType = operationKit.parsedOperation.Type

	requestContext.expressionContext.Request.Operation.Name = requestContext.operation.name
	requestContext.expressionContext.Request.Operation.Type = requestContext.operation.opType

	setTelemetryAttributes(s.r.Context(), requestContext, expr.BucketNameOrType)

	setExpressionContextClient(requestContext)

	attributesAfterParse := []attribute.KeyValue{
		otel.WgOperationName.String(operationKit.parsedOperation.Request.OperationName),
		otel.WgOperationType.String(operationKit.parsedOperation.Type),
	}

	// Add the batched operation index even if we error out later
	var batchedOperationIndex string
	if opIndex, ok := s.r.Context().Value(BatchedOperationId{}).(string); ok {
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
		if !s.h.omitBatchExtensions {
			unsupportedErr.extensionCode = ExtCodeErrBatchSubscriptionsUnsupported
		}
		return unsupportedErr
	}

	s.routerSpan.SetName(s.h.spanNameFormatter(s.r))

	if s.r.Method == http.MethodGet && operationKit.parsedOperation.Type == "mutation" {
		return &httpGraphqlError{
			message:    "Mutations can only be sent over HTTP POST",
			statusCode: http.StatusMethodNotAllowed,
		}
	}

	// Set the operation name and type to the operation metrics and the router span as early as possible
	s.routerSpan.SetAttributes(attributesAfterParse...)

	if err := s.h.operationBlocker.OperationIsBlocked(requestContext.logger, requestContext.expressionContext, operationKit.parsedOperation); err != nil {
		return &httpGraphqlError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}

	if operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash() {
		hash := operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash
		requestContext.operation.persistedID = hash
		requestContext.expressionContext.Request.Operation.PersistedID = hash
		setTelemetryAttributes(s.r.Context(), requestContext, expr.BucketPersistedID)

		persistedIDAttribute := otel.WgOperationPersistedID.String(hash)

		requestContext.telemetry.addCommonAttribute(persistedIDAttribute)

		s.routerSpan.SetAttributes(persistedIDAttribute)
	}

	return nil
}

// operationValidation is the result of validating the operation against the schema.
// The validation runs during normalization, but its error is reported in the validation stage.
type operationValidation struct {
	cacheHit bool
	err      error
}

// normalizeOperation normalizes the operation and its variables, and remaps the variables.
func (s *handlerScope) normalizeOperation(operationKit *OperationKit, isApq bool) (operationValidation, error) {
	requestContext := s.requestContext

	stage := s.startStage(stageNormalize)

	cached, err := operationKit.NormalizeOperation(requestContext.operation.clientInfo.Name, isApq)
	if err != nil {
		stage.end(err)
		return operationValidation{}, err
	}

	stage.span.SetAttributes(otel.WgNormalizationCacheHit.Bool(cached))
	requestContext.operation.normalizationCacheHit = operationKit.parsedOperation.NormalizationCacheHit
	requestContext.expressionContext.Request.Operation.NormalizationCacheHit = operationKit.parsedOperation.NormalizationCacheHit

	// Validate the operation against the schema BEFORE variable extraction. Extraction
	// serializes inline argument literals into JSON variables, which erases their GraphQL
	// type (e.g. an enum literal `hello` becomes the string "hello" and would wrongly
	// satisfy a String argument). The error is surfaced later, on the validation span, so
	// that the normalization span reflects only normalization.
	var validation operationValidation
	validation.cacheHit, validation.err = operationKit.ValidateOperation()

	cached, uploadsMapping, err := operationKit.NormalizeVariables()
	if err != nil {
		stage.end(err)
		return operationValidation{}, err
	}
	stage.span.SetAttributes(otel.WgVariablesNormalizationCacheHit.Bool(cached))
	requestContext.operation.variablesNormalizationCacheHit = cached
	requestContext.expressionContext.Request.Operation.VariablesNormalizationCacheHit = cached

	logInlineArguments(requestContext.logger, operationKit.parsedOperation)
	if s.h.operationProcessor.parseKitOptions.validateInlineArguments.ReturnInResponseExtensions {
		requestContext.operation.inlineArguments = inlineArgumentQualifiedNames(operationKit.parsedOperation)
	}

	s.updateNestedUploadPaths(uploadsMapping)

	// requestContext.operation.remapVariables map will contain new names as keys and
	// old names as values - to be able to extract the old values.
	// It does not rename variables in variables JSON.
	cached, err = operationKit.RemapVariables(s.h.disableVariablesRemapping)
	if err != nil {
		stage.end(err)
		return operationValidation{}, err
	}

	stage.span.SetAttributes(otel.WgVariablesRemappingCacheHit.Bool(cached))
	requestContext.operation.variablesRemappingCacheHit = cached
	requestContext.expressionContext.Request.Operation.VariablesRemappingCacheHit = cached
	requestContext.operation.hash = operationKit.parsedOperation.ID
	requestContext.operation.internalHash = operationKit.parsedOperation.InternalID
	requestContext.operation.remapVariables = operationKit.parsedOperation.RemapVariables

	operationHash := ""
	if requestContext.operation.hash != 0 {
		operationHash = requestContext.operation.HashString()
	}

	if !s.h.disableVariablesRemapping && len(uploadsMapping) > 0 {
		s.updateRemappedUploadPaths(uploadsMapping)
	}

	operationHashAttribute := otel.WgOperationHash.String(operationKit.parsedOperation.IDString())
	requestContext.telemetry.addCommonAttribute(operationHashAttribute)
	s.routerSpan.SetAttributes(operationHashAttribute)

	requestContext.operation.rawContent = operationKit.parsedOperation.Request.Query
	requestContext.operation.content = operationKit.parsedOperation.NormalizedRepresentation
	requestContext.operation.variablesHash = operationKit.parsedOperation.VariablesHash
	requestContext.operation.variables, err = astjson.ParseBytes(operationKit.parsedOperation.Request.Variables)
	if err != nil {
		stage.end(err)
		return operationValidation{}, err
	}

	// Set the normalized operation on the span
	if s.h.operationContentAttributes {
		stage.span.SetAttributes(otel.WgOperationNormalizedContent.String(operationKit.parsedOperation.NormalizedRepresentation))
	}

	if operationKit.parsedOperation.IsPersistedOperation {
		stage.span.SetAttributes(otel.WgEnginePersistedOperationCacheHit.Bool(operationKit.parsedOperation.PersistedOperationCacheHit))
	}

	// The hash attributes are evaluated after the normalization time, because expressions
	// can use both, but they still belong on the normalize span.
	stage.recordDuration(nil)

	requestContext.expressionContext.Request.Operation.Hash = operationHash
	setTelemetryAttributes(stage.ctx, requestContext, expr.BucketHash)

	requestContext.expressionContext.Request.Operation.QueryPlanHash = strconv.FormatUint(requestContext.operation.internalHash, 10)
	setTelemetryAttributes(stage.ctx, requestContext, expr.BucketQueryPlanHash)

	stage.span.End()

	if s.h.traceExportVariables {
		// At this stage the variables are normalized
		s.routerSpan.SetAttributes(otel.WgOperationVariables.String(string(operationKit.parsedOperation.Request.Variables)))
	}

	return validation, nil
}

// updateNestedUploadPaths updates the file upload paths if they were used in the nested field of the extracted variables.
func (s *handlerScope) updateNestedUploadPaths(uploadsMapping []uploads.UploadPathMapping) {
	files := s.requestContext.operation.files

	for mapping := range slices.Values(uploadsMapping) {
		// If the NewUploadPath is empty, there was no change in the path:
		// upload was directly passed to the argument. For example, "field(fileArgument: $file)"
		// will result in uploadsMapping containing such an item:
		// {VariableName: "file", OriginalUploadPath: "variables.file", NewUploadPath: ""}
		if mapping.NewUploadPath == "" {
			continue
		}

		// Look for the corresponding file that was used in the nested argument.
		idx := slices.IndexFunc(files, func(file *httpclient.FileUpload) bool {
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
		files[idx].SetVariablePath(mapping.NewUploadPath)
	}
}

// updateRemappedUploadPaths updates the file upload paths after the variables were remapped.
// The relative path of the variables has changed, but the files still reference the old upload locations.
func (s *handlerScope) updateRemappedUploadPaths(uploadsMapping []uploads.UploadPathMapping) {
	// key `to` is a new variable name
	// value `from` is an old variable name
	// we are looping through remapped variables to find a match between old variable name and variable which was holding an upload
	for to, from := range maps.All(s.requestContext.operation.remapVariables) {

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
			for file := range slices.Values(s.requestContext.operation.files) {
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

// validateOperation checks the complexity limits, the schema validation from the
// normalization stage and the variables of the operation.
func (s *handlerScope) validateOperation(operationKit *OperationKit, validation operationValidation) error {
	requestContext := s.requestContext

	stage := s.startStage(stageValidate)

	// Validate that the planned query doesn't exceed the maximum query depth configured
	// This check runs if they've configured a max query depth, and it can optionally be turned off for persisted operations
	if s.h.complexityLimits != nil {
		cacheHit, complexityCalcs, queryDepthErr := operationKit.ValidateQueryComplexity()
		requestContext.expressionContext.Request.Operation.QueryDepth = complexityCalcs.Depth
		stage.span.SetAttributes(otel.WgQueryDepth.Int(complexityCalcs.Depth))
		requestContext.expressionContext.Request.Operation.QueryTotalFields = complexityCalcs.TotalFields
		stage.span.SetAttributes(otel.WgQueryTotalFields.Int(complexityCalcs.TotalFields))
		requestContext.expressionContext.Request.Operation.QueryRootFields = complexityCalcs.RootFields
		stage.span.SetAttributes(otel.WgQueryRootFields.Int(complexityCalcs.RootFields))
		requestContext.expressionContext.Request.Operation.QueryRootFieldAliases = complexityCalcs.RootFieldAliases
		stage.span.SetAttributes(otel.WgQueryRootFieldAliases.Int(complexityCalcs.RootFieldAliases))
		requestContext.expressionContext.Request.Operation.QueryComplexityCacheHit = cacheHit
		stage.span.SetAttributes(otel.WgQueryDepthCacheHit.Bool(cacheHit))
		setTelemetryAttributes(stage.ctx, requestContext, expr.BucketQueryComplexity)

		if queryDepthErr != nil {
			stage.end(queryDepthErr)
			return queryDepthErr
		}
	}

	// Schema validation (computed before variable extraction) takes precedence over
	// variable validation, mirroring the GraphQL spec order (ValuesOfCorrectType before
	// coerced variable values). Its error is surfaced here so it appears on the
	// validation span rather than the normalization span.
	err := validation.err
	if err == nil {
		err = operationKit.ValidateOperationVariables(requestContext.operation.executionOptions.SkipLoader, requestContext.operation.remapVariables, s.h.apolloCompatibilityFlags)
	}
	if err != nil {
		requestContext.graphQLErrorCodes = append(requestContext.graphQLErrorCodes, s.h.getErrorCodes(err)...)
		stage.end(err)
		return err
	}

	stage.span.SetAttributes(otel.WgValidationCacheHit.Bool(validation.cacheHit))
	if requestContext.operation.executionOptions.SkipLoader {
		// In case we're skipping the loader, which means that we won't execute the operation
		// we skip the validation of variables as we're not using them
		// this allows us to generate query plans without having to provide variables
		stage.span.SetAttributes(otel.WgVariablesValidationSkipped.Bool(true))
	}

	stage.end(nil)

	return nil
}

// planOperation plans the operation, validates its static cost and records the planning time.
func (s *handlerScope) planOperation(operationKit *OperationKit) error {
	requestContext := s.requestContext

	// If the request has a query parameter wg_trace=true we skip the cache
	// and always plan the operation
	// this allows us to "write" to the plan
	stage := s.startStage(stagePlan,
		trace.WithAttributes(otel.WgEngineRequestTracingEnabled.Bool(requestContext.operation.traceOptions.Enable)),
	)

	planOptions := PlanOptions{
		ClientInfo:           requestContext.operation.clientInfo,
		TraceOptions:         requestContext.operation.traceOptions,
		ExecutionOptions:     requestContext.operation.executionOptions,
		TrackSchemaUsageInfo: s.h.trackSchemaUsageInfo,
	}

	if err := s.h.planner.plan(requestContext.operation, planOptions); err != nil {
		s.requestLogger.Debug("failed to plan operation", zap.Error(err))
		stage.end(err)
		return err
	}

	requestContext.expressionContext.Request.Operation.PlanCacheHit = requestContext.operation.planCacheHit
	stage.span.SetAttributes(otel.WgEnginePlanCacheHit.Bool(requestContext.operation.planCacheHit))
	stage.end(nil)

	if err := operationKit.ValidateStaticCost(requestContext.operation); err != nil {
		return err
	}

	planningAttrs := *requestContext.telemetry.AcquireAttributes()
	planningAttrs = append(planningAttrs, otel.WgEnginePlanCacheHit.Bool(requestContext.operation.planCacheHit))
	planningAttrs = append(planningAttrs, requestContext.telemetry.metricAttrs...)

	s.operationMetrics.routerMetrics.MetricStore().MeasureOperationPlanningTime(
		s.r.Context(),
		requestContext.operation.planningTime,
		requestContext.telemetry.metricSliceAttrs,
		otelmetric.WithAttributeSet(attribute.NewSet(planningAttrs...)),
	)

	requestContext.telemetry.ReleaseAttributes(&planningAttrs)

	s.exposeQueryPlan(operationKit)

	return nil
}

// exposeQueryPlan adds the normalized query to the query plan that is returned in the
// response, and logs the query plan if enabled.
func (s *handlerScope) exposeQueryPlan(operationKit *OperationKit) {
	h := s.h
	operation := s.requestContext.operation

	// we could log the query plan only if query plans are calculated
	if !(h.queryPlansEnabled && operation.executionOptions.IncludeQueryPlanInResponse) && !h.alwaysIncludeQueryPlan {
		return
	}

	switch p := operation.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		p.Response.Fetches.NormalizedQuery = operationKit.parsedOperation.NormalizedRepresentation
	case *plan.DeferResponsePlan:
		// TODO: handle ART
	}

	if !h.queryPlansLoggingEnabled {
		return
	}

	var printedPlan string
	switch p := operation.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		printedPlan = p.Response.Fetches.QueryPlan().PrettyPrint()
	case *plan.SubscriptionResponsePlan:
		printedPlan = p.Response.Response.Fetches.QueryPlan().PrettyPrint()
	case *plan.DeferResponsePlan:
		// TODO: handle
	}
	if h.developmentMode {
		h.log.Sugar().Debugf("Query Plan:\n%s", printedPlan)
	} else {
		h.log.Debug("Query Plan", zap.String("query_plan", printedPlan))
	}
}

// checkDeferAccept rejects operations with @defer that the client can't receive.
// A DeferResponsePlan is only produced when the operation contains @defer
// (and @defer support is enabled). Such operations stream incremental
// payloads as multipart/mixed, so reject the request early if the client
// does not accept that content type, or asks for a format the router does
// not produce and would otherwise lose the deferred data silently.
func (s *handlerScope) checkDeferAccept() error {
	if _, ok := s.requestContext.operation.preparedPlan.preparedPlan.(*plan.DeferResponsePlan); !ok {
		return nil
	}

	switch verdict, spec := deferAccept(s.r); verdict {
	case deferAcceptNoMultipart:
		return NewHttpGraphqlError(
			"the router received a query with the @defer directive but the client does not accept "+
				"multipart/mixed HTTP responses. To enable @defer support, add the HTTP header "+
				"'Accept: multipart/mixed'",
			ExtCodeErrDeferMultipartNotAccepted,
			http.StatusOK,
		)
	case deferAcceptUnsupportedSpec:
		return NewHttpGraphqlError(
			fmt.Sprintf("the router received a query with the @defer directive but the client requested the "+
				"incremental delivery format '%s', while the router implements 'incrementalSpec=%s'. "+
				"Use a client that supports this format, for example Apollo Client with GraphQL17Alpha9Handler",
				spec, deferIncrementalSpec),
			ExtCodeErrDeferSpecNotSupported,
			http.StatusOK,
		)
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

	graphqlErr := err
	// If the error is an unauthorized error, we want to hide details from the graphql error
	if errors.Is(err, ErrUnauthorized) {
		graphqlErr = ErrUnauthorized
	}

	writeOperationError(r, w, requestLogger, &httpGraphqlError{
		message:    graphqlErr.Error(),
		statusCode: http.StatusUnauthorized,
	}, h.headerPropagation)
}

func (h *PreHandler) flushMetrics(ctx context.Context, requestLogger *zap.Logger) {
	requestLogger.Debug("Flushing metrics ...")

	now := time.Now()

	wg := &sync.WaitGroup{}

	wg.Go(func() {
		if err := h.metrics.MetricStore().Flush(ctx); err != nil {
			requestLogger.Error("Failed to flush OTEL metrics", zap.Error(err))
		}
	})

	wg.Go(func() {
		if err := h.tracerProvider.ForceFlush(ctx); err != nil {
			requestLogger.Error("Failed to flush OTEL tracer", zap.Error(err))
		}
	})

	wg.Wait()

	requestLogger.Debug("Metrics flushed", zap.Duration("duration", time.Since(now)))
}

func (h *PreHandler) parseExecutionAndTraceOptions(r *http.Request, clientInfo *ClientInfo, requestLogger *zap.Logger) (resolve.ExecutionOptions, resolve.TraceOptions, error) {
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
	// don't change the order of
	// 1. enableRequestDeduplication
	// 2. hasPreOriginHandlers
	// 3. forceEnableRequestDeduplication

	// Disable subgraph request deduplication if request deduplication is disabled
	ex.DisableSubgraphRequestDeduplication = !h.enableRequestDeduplication
	// Disable inbound request deduplication if request deduplication is disabled
	ex.DisableInboundRequestDeduplication = !h.enableInboundRequestDeduplication
	if !h.enableRequestDeduplication {
		// DisableInboundRequestDeduplication is disabled when RequestDeduplication in general is disabled
		ex.DisableInboundRequestDeduplication = true
	}
	if h.hasPreOriginHandlers {
		// if we have pre origin handlers, we cannot guarantee that these handlers won't modify headers
		// as such, we're automatically disabling request deduplication
		ex.DisableSubgraphRequestDeduplication = true
		ex.DisableInboundRequestDeduplication = true
	}
	if h.forceEnableRequestDeduplication {
		// if the user has pre origin handlers but knows for sure that they don't affect request deduplication
		// they can make an override (via config) to force enable it
		ex.DisableSubgraphRequestDeduplication = false
	}
	if h.forceEnableInboundRequestDeduplication {
		// same as above, force enable even with PreHandlers
		ex.DisableInboundRequestDeduplication = false
	}
	return ex, tr, nil
}

func (h *PreHandler) internalParseRequestOptions(r *http.Request, clientInfo *ClientInfo, requestLogger *zap.Logger) (resolve.ExecutionOptions, resolve.TraceOptions, error) {
	// Determine if we should enable request tracing / query plans at all
	if h.enableRequestTracing {
		// In dev mode we always allow to enable tracing / query plans.
		// force_unauthenticated_request_tracing=true allows ART without dev_mode or a controlplane token.
		if h.developmentMode || h.forceUnauthenticatedRequestTracing {
			return h.parseRequestExecutionOptions(r), h.parseRequestTraceOptions(r), nil
		}
		// If the client has a valid request token, and we have a public key from the controlplane
		if clientInfo.WGRequestToken != "" && h.routerPublicKey != nil {
			_, err := jwt.Parse(clientInfo.WGRequestToken, func(token *jwt.Token) (any, error) {
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

// logInlineArguments emits a warning listing every inline argument value found in
// the operation (non-enforcing mode of ValidateInlineArguments). It is a no-op
// when there are no findings, so both the HTTP prehandler and the WebSocket
// handler can call it unconditionally after a successful normalization.
func logInlineArguments(logger *zap.Logger, operation *ParsedOperation) {
	argumentNames := inlineArgumentQualifiedNames(operation)
	if len(argumentNames) == 0 {
		return
	}
	logger.Warn("Inline argument values found in operation; use variables instead",
		zap.Int("count", len(argumentNames)),
		zap.Strings("arguments", argumentNames),
		zap.String("operation_name", operation.Request.OperationName),
		zap.Uint64("operation_hash", operation.ID),
	)
}

// inlineArgumentQualifiedNames returns the qualified names (e.g. "user.id",
// "@skip.if") of every inline argument found in the operation, or nil when there
// are none. Shared by the warning log and the response-extension reporting.
func inlineArgumentQualifiedNames(operation *ParsedOperation) []string {
	inlineArguments := operation.InlineArguments
	if len(inlineArguments) == 0 {
		return nil
	}
	argumentNames := make([]string, len(inlineArguments))
	for i, arg := range inlineArguments {
		argumentNames[i] = arg.QualifiedName()
	}
	return argumentNames
}
