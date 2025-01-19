package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/buger/jsonparser"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/gorilla/websocket"
	"github.com/tidwall/gjson"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"golang.org/x/sync/semaphore"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/netpoll"

	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
)

var (
	errClientTerminatedConnection = errors.New("client terminated connection")
)

type WebsocketMiddlewareOptions struct {
	OperationProcessor *OperationProcessor
	OperationBlocker   *OperationBlocker
	Planner            *OperationPlanner
	GraphQLHandler     *GraphQLHandler
	PreHandler         *PreHandler
	Metrics            RouterMetrics
	AccessController   *AccessController
	Logger             *zap.Logger
	Stats              statistics.EngineStatistics
	ReadTimeout        time.Duration

	EnableNetPoll         bool
	NetPollTimeout        time.Duration
	NetPollConnBufferSize int

	WebSocketConfiguration *config.WebSocketConfiguration
	ClientHeader           config.ClientHeader
	Attributes             []attribute.KeyValue
}

func NewWebsocketMiddleware(ctx context.Context, opts WebsocketMiddlewareOptions) func(http.Handler) http.Handler {

	handler := &WebsocketHandler{
		ctx:                ctx,
		operationProcessor: opts.OperationProcessor,
		operationBlocker:   opts.OperationBlocker,
		planner:            opts.Planner,
		graphqlHandler:     opts.GraphQLHandler,
		preHandler:         opts.PreHandler,
		metrics:            opts.Metrics,
		accessController:   opts.AccessController,
		logger:             opts.Logger,
		stats:              opts.Stats,
		readTimeout:        opts.ReadTimeout,
		config:             opts.WebSocketConfiguration,
		clientHeader:       opts.ClientHeader,
		handlerSem:         semaphore.NewWeighted(128),
		attributes:         opts.Attributes,
	}
	if opts.WebSocketConfiguration != nil && opts.WebSocketConfiguration.AbsintheProtocol.Enabled {
		handler.absintheHandlerEnabled = true
		handler.absintheHandlerPath = opts.WebSocketConfiguration.AbsintheProtocol.HandlerPath
	}
	if opts.WebSocketConfiguration.ForwardUpgradeHeaders.Enabled {
		handler.forwardUpgradeHeadersConfig.enabled = true
		for _, str := range opts.WebSocketConfiguration.ForwardUpgradeHeaders.AllowList {
			if detectNonRegex.MatchString(str) {
				canonicalHeaderKey := http.CanonicalHeaderKey(str)
				handler.forwardUpgradeHeadersConfig.staticAllowList = append(handler.forwardUpgradeHeadersConfig.staticAllowList, canonicalHeaderKey)
			} else {
				re, err := regexp.Compile(str)
				if err != nil {
					opts.Logger.Warn("Invalid regex in forward upgrade headers allow list", zap.String("regex", str), zap.Error(err))
					continue
				}
				handler.forwardUpgradeHeadersConfig.regexAllowList = append(handler.forwardUpgradeHeadersConfig.regexAllowList, re)
			}
		}
		handler.forwardUpgradeHeadersConfig.withStaticAllowList = len(handler.forwardUpgradeHeadersConfig.staticAllowList) > 0
		handler.forwardUpgradeHeadersConfig.withRegexAllowList = len(handler.forwardUpgradeHeadersConfig.regexAllowList) > 0
	}
	if opts.WebSocketConfiguration.ForwardUpgradeQueryParams.Enabled {
		handler.forwardQueryParamsConfig.enabled = true
		for _, str := range opts.WebSocketConfiguration.ForwardUpgradeQueryParams.AllowList {
			if detectNonRegex.MatchString(str) {
				handler.forwardQueryParamsConfig.staticAllowList = append(handler.forwardQueryParamsConfig.staticAllowList, str)
			} else {
				re, err := regexp.Compile(str)
				if err != nil {
					opts.Logger.Warn("Invalid regex in forward upgrade query params allow list", zap.String("regex", str), zap.Error(err))
					continue
				}
				handler.forwardQueryParamsConfig.regexAllowList = append(handler.forwardQueryParamsConfig.regexAllowList, re)
			}
		}
		handler.forwardQueryParamsConfig.withStaticAllowList = len(handler.forwardQueryParamsConfig.staticAllowList) > 0
		handler.forwardQueryParamsConfig.withRegexAllowList = len(handler.forwardQueryParamsConfig.regexAllowList) > 0
	}
	if opts.EnableNetPoll {
		poller, err := netpoll.NewPoller(opts.NetPollConnBufferSize, opts.NetPollTimeout)
		if err == nil {
			opts.Logger.Debug("Net poller is available")

			handler.netPoll = poller
			handler.connections = make(map[int]*WebSocketConnectionHandler)
			go handler.runPoller()
		}

	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !websocket.IsWebSocketUpgrade(r) {
				next.ServeHTTP(w, r)
				return
			}
			handler.handleUpgradeRequest(w, r)
		})
	}
}

// wsConnectionWrapper is a wrapper around websocket.Conn that allows
// writing from multiple goroutines
type wsConnectionWrapper struct {
	conn net.Conn
	mu   sync.Mutex
}

func newWSConnectionWrapper(conn net.Conn) *wsConnectionWrapper {
	return &wsConnectionWrapper{
		conn: conn,
	}
}

func (c *wsConnectionWrapper) ReadJSON(v interface{}) error {
	text, err := wsutil.ReadClientText(c.conn)
	if err != nil {
		return err
	}
	return json.Unmarshal(text, v)
}

func (c *wsConnectionWrapper) WriteText(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return wsutil.WriteServerText(c.conn, []byte(text))
}

func (c *wsConnectionWrapper) WriteJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return wsutil.WriteServerText(c.conn, data)
}

func (c *wsConnectionWrapper) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.Close()
}

type WebsocketHandler struct {
	ctx                context.Context
	config             *config.WebSocketConfiguration
	operationProcessor *OperationProcessor
	operationBlocker   *OperationBlocker
	planner            *OperationPlanner
	graphqlHandler     *GraphQLHandler
	preHandler         *PreHandler
	metrics            RouterMetrics
	accessController   *AccessController
	logger             *zap.Logger

	netPoll       netpoll.Poller
	connections   map[int]*WebSocketConnectionHandler
	connectionsMu sync.RWMutex

	handlerSem    *semaphore.Weighted
	connectionIDs atomic.Int64

	stats      statistics.EngineStatistics
	attributes []attribute.KeyValue

	readTimeout time.Duration

	absintheHandlerEnabled bool
	absintheHandlerPath    string

	forwardUpgradeHeadersConfig forwardConfig
	forwardQueryParamsConfig    forwardConfig
	clientHeader                config.ClientHeader
}

func (h *WebsocketHandler) handleUpgradeRequest(w http.ResponseWriter, r *http.Request) {
	var (
		subProtocol string
	)

	requestID := middleware.GetReqID(r.Context())
	requestContext := getRequestContext(r.Context())

	requestLogger := h.logger.With(logging.WithRequestID(requestID), logging.WithTraceID(rtrace.GetTraceID(r.Context())))
	clientInfo := NewClientInfoFromRequest(r, h.clientHeader)

	if h.accessController != nil && !h.config.Authentication.FromInitialPayload.Enabled {
		// Check access control before upgrading the connection
		validatedReq, err := h.accessController.Access(w, r)
		if err != nil {
			statusCode := http.StatusForbidden
			if errors.Is(err, ErrUnauthorized) {
				statusCode = http.StatusUnauthorized
			}
			http.Error(w, http.StatusText(statusCode), statusCode)
			return
		}
		r = validatedReq

		requestContext.expressionContext.Request.Auth = expr.LoadAuth(r.Context())
	}

	upgrader := ws.HTTPUpgrader{
		Timeout: time.Second * 5,
		Protocol: func(s string) bool {
			if wsproto.IsSupportedSubprotocol(s) {
				subProtocol = s
				return true
			}
			return false
		},
	}
	c, _, _, err := upgrader.Upgrade(r, w)
	if err != nil {
		requestLogger.Warn("Websocket upgrade", zap.Error(err))
		_ = c.Close()
		return
	}

	// legacy absinthe clients don't set the Sec-WebSocket-Protocol header (Subprotocol)
	// so we need to check the path to determine if it's an absinthe client and set the subprotocol manually
	if subProtocol == "" && h.absintheHandlerEnabled && r.URL.Path == h.absintheHandlerPath {
		subProtocol = wsproto.AbsintheWSSubProtocol
	}

	// After successful upgrade, we can't write to the response writer anymore
	// because it's hijacked by the websocket connection

	conn := newWSConnectionWrapper(c)
	protocol, err := wsproto.NewProtocol(subProtocol, conn)
	if err != nil {
		requestLogger.Error("Create websocket protocol", zap.Error(err))
		_ = c.Close()
		return
	}

	// We can parse the request options before creating the handler
	// this avoids touching the client request across goroutines

	executionOptions, traceOptions, err := h.preHandler.parseRequestOptions(r, clientInfo, requestLogger)
	if err != nil {
		requestLogger.Error("Parse request options", zap.Error(err))
		_ = c.Close()
		return
	}

	planOptions := PlanOptions{
		ClientInfo:           clientInfo,
		TraceOptions:         traceOptions,
		ExecutionOptions:     executionOptions,
		TrackSchemaUsageInfo: h.preHandler.trackSchemaUsageInfo,
	}

	handler := NewWebsocketConnectionHandler(h.ctx, WebSocketConnectionHandlerOptions{
		OperationProcessor:    h.operationProcessor,
		OperationBlocker:      h.operationBlocker,
		Planner:               h.planner,
		GraphQLHandler:        h.graphqlHandler,
		PreHandler:            h.preHandler,
		Metrics:               h.metrics,
		PlanOptions:           planOptions,
		ResponseWriter:        w,
		Request:               r,
		Connection:            conn,
		Protocol:              protocol,
		Logger:                requestLogger,
		Stats:                 h.stats,
		ConnectionID:          h.connectionIDs.Inc(),
		ClientInfo:            clientInfo,
		InitRequestID:         requestID,
		Config:                h.config,
		ForwardUpgradeHeaders: h.forwardUpgradeHeadersConfig,
		ForwardQueryParams:    h.forwardQueryParamsConfig,
		Attributes:            h.attributes,
	})
	err = handler.Initialize()
	if err != nil {

		// Don't produce errors logs here because it can only be client side errors
		// e.g. slow client, aborted connection, invalid JSON, etc.
		// We log it as debug because it's not a server side error

		requestLogger.Debug("Initializing websocket connection", zap.Error(err))

		handler.Close()
		return
	}

	// Authenticate the connection using the initial payload
	fromInitialPayloadConfig := h.config.Authentication.FromInitialPayload
	if fromInitialPayloadConfig.Enabled {
		// Setting the initialPayload in the context to be used by the websocketInitialPayloadAuthenticator
		r = r.WithContext(authentication.WithWebsocketInitialPayloadContextKey(r.Context(), handler.initialPayload))

		// Later check access control after initial payload is read and set into the context
		if h.accessController != nil {
			handler.request, err = h.accessController.Access(w, r)
			if err != nil {
				statusCode := http.StatusForbidden
				if errors.Is(err, ErrUnauthorized) {
					statusCode = http.StatusUnauthorized
				}
				http.Error(handler.w, http.StatusText(statusCode), statusCode)
				_ = handler.writeErrorMessage(requestID, err)
				handler.Close()
				return
			}
		}

		// Export the token from the initial payload to the request header
		if fromInitialPayloadConfig.ExportToken.Enabled {
			var initialPayloadMap map[string]interface{}
			err := json.Unmarshal(handler.initialPayload, &initialPayloadMap)
			if err != nil {
				requestLogger.Error("Error parsing initial payload: %v", zap.Error(err))
				_ = handler.writeErrorMessage(requestID, err)
				handler.Close()
				return
			}
			jwtToken, ok := initialPayloadMap[fromInitialPayloadConfig.Key].(string)
			if !ok {
				err := fmt.Errorf("invalid JWT token in initial payload: JWT token is not a string")
				requestLogger.Error(err.Error())
				_ = handler.writeErrorMessage(requestID, err)
				handler.Close()
				return
			}
			handler.request.Header.Set(fromInitialPayloadConfig.ExportToken.HeaderKey, jwtToken)
		}

		requestContext.expressionContext.Request.Auth = expr.LoadAuth(handler.request.Context())
	}

	// Only when epoll/kqueue is available. On Windows, epoll is not available
	if h.netPoll != nil {
		err = h.addConnection(c, handler)
		if err != nil {
			requestLogger.Error("Adding connection to net poller", zap.Error(err))
			handler.Close()
		}
		return
	}

	// Handle messages sync when net poller implementation is not available

	go h.handleConnectionSync(handler)
}

func (h *WebsocketHandler) handleConnectionSync(handler *WebSocketConnectionHandler) {
	h.stats.ConnectionsInc()
	defer h.stats.ConnectionsDec()
	serverDone := h.ctx.Done()
	defer handler.Close()

	for {
		select {
		case <-serverDone:
			return
		default:
			// It's important to set the ReadDeadline
			// Otherwise, the following "ReadMessage" call will block forever
			err := handler.conn.conn.SetReadDeadline(time.Now().Add(h.readTimeout))
			if err != nil {
				h.logger.Debug("Setting read deadline", zap.Error(err))
				return
			}
			msg, err := handler.protocol.ReadMessage()
			if err != nil {
				if isReadTimeout(err) {
					continue
				}
				h.logger.Debug("Client closed connection")
				return
			}
			err = h.HandleMessage(handler, msg)
			if err != nil {
				h.logger.Debug("Handling websocket message", zap.Error(err))
				if errors.Is(err, errClientTerminatedConnection) {
					return
				}
			}
		}
	}
}

func (h *WebsocketHandler) addConnection(conn net.Conn, handler *WebSocketConnectionHandler) error {
	h.stats.ConnectionsInc()
	h.connectionsMu.Lock()
	defer h.connectionsMu.Unlock()
	fd := socketFd(conn)
	if fd == 0 {
		return fmt.Errorf("unable to get socket fd for conn: %d", handler.connectionID)
	}
	h.connections[fd] = handler
	return h.netPoll.Add(conn)
}

func (h *WebsocketHandler) removeConnection(conn net.Conn, handler *WebSocketConnectionHandler, fd int) {
	h.stats.ConnectionsDec()
	h.connectionsMu.Lock()
	delete(h.connections, fd)
	h.connectionsMu.Unlock()
	err := h.netPoll.Remove(conn)
	if err != nil {
		h.logger.Warn("Removing connection from net poller", zap.Error(err))
	}
	handler.Close()
}

func socketFd(conn net.Conn) int {
	if con, ok := conn.(syscall.Conn); ok {
		raw, err := con.SyscallConn()
		if err != nil {
			return 0
		}
		sfd := 0
		_ = raw.Control(func(fd uintptr) {
			sfd = int(fd)
		})
		return sfd
	}
	if con, ok := conn.(netpoll.ConnImpl); ok {
		return con.GetFD()
	}
	return 0
}

func isReadTimeout(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return netErr.Timeout()
	}
	return false
}

func (h *WebsocketHandler) runPoller() {
	done := h.ctx.Done()
	defer func() {
		h.connectionsMu.Lock()
		_ = h.netPoll.Close(true)
		h.connectionsMu.Unlock()
	}()
	for {
		select {
		case <-done:
			return
		default:
			connections, err := h.netPoll.Wait(128)
			if err != nil {
				h.logger.Warn("Net Poller wait", zap.Error(err))
				continue
			}
			for i := 0; i < len(connections); i++ {
				if connections[i] == nil {
					continue
				}
				conn := connections[i].(netpoll.ConnImpl)
				// check if the connection is still valid
				fd := socketFd(conn)
				h.connectionsMu.RLock()
				handler, exists := h.connections[fd]
				h.connectionsMu.RUnlock()

				if !exists {
					continue
				}

				if fd == 0 {
					h.logger.Debug("Invalid socket fd", zap.Int("fd", fd))
					h.removeConnection(conn, handler, fd)
					continue
				}

				err = handler.conn.conn.SetReadDeadline(time.Now().Add(h.readTimeout))
				if err != nil {
					h.logger.Debug("Setting read deadline", zap.Error(err))
					h.removeConnection(conn, handler, fd)
					continue
				}

				msg, err := handler.protocol.ReadMessage()
				if err != nil {
					h.logger.Debug("Client closed connection")
					h.removeConnection(conn, handler, fd)
					continue
				}
				err = h.HandleMessage(handler, msg)
				if err != nil {
					h.logger.Debug("Handling websocket message", zap.Error(err))
					if errors.Is(err, errClientTerminatedConnection) {
						h.removeConnection(conn, handler, fd)
						continue
					}
				}
			}
		}
	}
}

type websocketResponseWriter struct {
	id              string
	protocol        wsproto.Proto
	header          http.Header
	buf             bytes.Buffer
	writtenBytes    int
	logger          *zap.Logger
	stats           statistics.EngineStatistics
	propagateErrors bool
}

var _ http.ResponseWriter = (*websocketResponseWriter)(nil)
var _ resolve.SubscriptionResponseWriter = (*websocketResponseWriter)(nil)

func newWebsocketResponseWriter(id string, protocol wsproto.Proto, propagateErrors bool, logger *zap.Logger, stats statistics.EngineStatistics) *websocketResponseWriter {
	return &websocketResponseWriter{
		id:              id,
		protocol:        protocol,
		header:          make(http.Header),
		logger:          logger.With(zap.String("subscription_id", id)),
		stats:           stats,
		propagateErrors: propagateErrors,
	}
}

func (rw *websocketResponseWriter) Header() http.Header {
	return rw.header
}

func (rw *websocketResponseWriter) WriteHeader(statusCode int) {
	rw.logger.Debug("Response status code", zap.Int("status_code", statusCode))
}

func (rw *websocketResponseWriter) Complete() {
	err := rw.protocol.Done(rw.id)
	if err != nil {
		rw.logger.Debug("Sending complete message", zap.Error(err))
	}
}

func (rw *websocketResponseWriter) Write(data []byte) (int, error) {
	rw.writtenBytes += len(data)
	return rw.buf.Write(data)
}

func (rw *websocketResponseWriter) Flush() error {
	if rw.buf.Len() > 0 {
		rw.logger.Debug("flushing", zap.Int("bytes", rw.buf.Len()))
		payload := rw.buf.Bytes()
		var extensions []byte
		var err error
		if len(rw.header) > 0 {
			extensions, err = json.Marshal(map[string]any{
				"response_headers": rw.header,
			})
			if err != nil {
				rw.logger.Warn("Serializing response headers", zap.Error(err))
				return err
			}
		}

		// Check if the result is an error
		errorsResult := gjson.GetBytes(payload, "errors")
		if errorsResult.Type == gjson.JSON {
			if rw.propagateErrors {
				err = rw.protocol.WriteGraphQLErrors(rw.id, json.RawMessage(errorsResult.Raw), extensions)
			} else {
				err = rw.protocol.WriteGraphQLErrors(rw.id, json.RawMessage(`[{"message":"Unable to subscribe"}]`), extensions)
			}
		} else {
			err = rw.protocol.WriteGraphQLData(rw.id, payload, extensions)
		}
		rw.buf.Reset()
		if err != nil {
			return err
		}
	}
	return nil
}

func (rw *websocketResponseWriter) SubscriptionResponseWriter() resolve.SubscriptionResponseWriter {
	return rw
}

type graphqlError struct {
	Message    string      `json:"message"`
	Extensions *Extensions `json:"extensions,omitempty"`
}

type WebSocketConnectionHandlerOptions struct {
	Config                *config.WebSocketConfiguration
	OperationProcessor    *OperationProcessor
	OperationBlocker      *OperationBlocker
	Planner               *OperationPlanner
	GraphQLHandler        *GraphQLHandler
	PreHandler            *PreHandler
	Metrics               RouterMetrics
	ResponseWriter        http.ResponseWriter
	Request               *http.Request
	Connection            *wsConnectionWrapper
	Protocol              wsproto.Proto
	Logger                *zap.Logger
	Stats                 statistics.EngineStatistics
	PlanOptions           PlanOptions
	ConnectionID          int64
	ClientInfo            *ClientInfo
	InitRequestID         string
	ForwardUpgradeHeaders forwardConfig
	ForwardQueryParams    forwardConfig
	Attributes            []attribute.KeyValue
}

type WebSocketConnectionHandler struct {
	ctx                context.Context
	operationProcessor *OperationProcessor
	operationBlocker   *OperationBlocker
	planner            *OperationPlanner
	graphqlHandler     *GraphQLHandler
	plannerOptions     PlanOptions
	preHandler         *PreHandler
	metrics            RouterMetrics
	w                  http.ResponseWriter
	// request is the original client request. It is not safe for concurrent use.
	// You have to clone it before using it in a goroutine.
	request    *http.Request
	conn       *wsConnectionWrapper
	protocol   wsproto.Proto
	clientInfo *ClientInfo
	logger     *zap.Logger

	initialPayload            json.RawMessage
	upgradeRequestHeaders     json.RawMessage
	upgradeRequestQueryParams json.RawMessage

	initRequestID   string
	connectionID    int64
	subscriptionIDs atomic.Int64
	subscriptions   sync.Map
	stats           statistics.EngineStatistics

	attributes []attribute.KeyValue

	forwardInitialPayload bool

	forwardUpgradeHeaders *forwardConfig
	forwardQueryParams    *forwardConfig
}

type forwardConfig struct {
	enabled             bool
	withStaticAllowList bool
	staticAllowList     []string
	withRegexAllowList  bool
	regexAllowList      []*regexp.Regexp
}

var (
	detectNonRegex = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

func NewWebsocketConnectionHandler(ctx context.Context, opts WebSocketConnectionHandlerOptions) *WebSocketConnectionHandler {

	return &WebSocketConnectionHandler{
		ctx:                   ctx,
		operationProcessor:    opts.OperationProcessor,
		operationBlocker:      opts.OperationBlocker,
		planner:               opts.Planner,
		graphqlHandler:        opts.GraphQLHandler,
		preHandler:            opts.PreHandler,
		metrics:               opts.Metrics,
		w:                     opts.ResponseWriter,
		request:               opts.Request,
		conn:                  opts.Connection,
		protocol:              opts.Protocol,
		logger:                opts.Logger,
		connectionID:          opts.ConnectionID,
		stats:                 opts.Stats,
		clientInfo:            opts.ClientInfo,
		initRequestID:         opts.InitRequestID,
		forwardUpgradeHeaders: &opts.ForwardUpgradeHeaders,
		forwardQueryParams:    &opts.ForwardQueryParams,
		forwardInitialPayload: opts.Config != nil && opts.Config.ForwardInitialPayload,
		plannerOptions:        opts.PlanOptions,
		attributes:            opts.Attributes,
	}
}

func (h *WebSocketConnectionHandler) requestError(err error) error {
	if errors.As(err, &wsutil.ClosedError{}) {
		h.logger.Debug("Client closed connection")
		return err
	}
	h.logger.Warn("Handling websocket connection", zap.Error(err))
	return h.conn.WriteText(err.Error())
}

func (h *WebSocketConnectionHandler) writeErrorMessage(operationID string, err error) error {
	gqlErrors := []graphqlError{
		{Message: err.Error()},
	}
	payload, err := json.Marshal(gqlErrors)
	if err != nil {
		return fmt.Errorf("encoding GraphQL errors: %w", err)
	}
	return h.protocol.WriteGraphQLErrors(operationID, payload, nil)
}

func (h *WebSocketConnectionHandler) parseAndPlan(registration *SubscriptionRegistration) (*ParsedOperation, *operationContext, error) {

	operationKit, err := h.operationProcessor.NewKit()
	if err != nil {
		return nil, nil, err
	}
	defer operationKit.Free()

	opContext := &operationContext{
		clientInfo: h.plannerOptions.ClientInfo,
	}

	if err := operationKit.UnmarshalOperationFromBody(registration.msg.Payload); err != nil {
		return nil, nil, err
	}

	opContext.extensions = operationKit.parsedOperation.Request.Extensions

	var (
		skipParse bool
		isApq     bool
	)

	if operationKit.parsedOperation.IsPersistedOperation {
		skipParse, isApq, err = operationKit.FetchPersistedOperation(h.ctx, h.clientInfo)
		if err != nil {
			return nil, nil, err
		}
	}

	// If the persistent operation is already in the cache, we skip the parse step
	// because the operation was already parsed. This is a performance optimization, and we
	// can do it because we know that the persisted operation is immutable (identified by the hash)
	if !skipParse {
		startParsing := time.Now()
		if err := operationKit.Parse(); err != nil {
			opContext.parsingTime = time.Since(startParsing)
			return nil, nil, err
		}
		opContext.parsingTime = time.Since(startParsing)
	}

	opContext.name = operationKit.parsedOperation.Request.OperationName
	opContext.opType = operationKit.parsedOperation.Type

	reqCtx := getRequestContext(registration.clientRequest.Context())
	if reqCtx == nil {
		return nil, nil, fmt.Errorf("request context not found")
	}

	if blocked := h.operationBlocker.OperationIsBlocked(h.logger, reqCtx.expressionContext, operationKit.parsedOperation); blocked != nil {
		return nil, nil, blocked
	}

	startNormalization := time.Now()

	if _, err := operationKit.NormalizeOperation(h.clientInfo.Name, isApq); err != nil {
		opContext.normalizationTime = time.Since(startNormalization)
		return nil, nil, err
	}

	opContext.normalizationCacheHit = operationKit.parsedOperation.NormalizationCacheHit

	if err := operationKit.NormalizeVariables(); err != nil {
		opContext.normalizationTime = time.Since(startNormalization)
		return nil, nil, err
	}

	if err := operationKit.RemapVariables(); err != nil {
		opContext.normalizationTime = time.Since(startNormalization)
		return nil, nil, err
	}

	opContext.hash = operationKit.parsedOperation.ID
	opContext.internalHash = operationKit.parsedOperation.InternalID
	opContext.remapVariables = operationKit.parsedOperation.RemapVariables

	opContext.normalizationTime = time.Since(startNormalization)
	opContext.content = operationKit.parsedOperation.NormalizedRepresentation
	opContext.variables, err = astjson.ParseBytes(operationKit.parsedOperation.Request.Variables)
	if err != nil {
		return nil, nil, err
	}

	startValidation := time.Now()

	if _, err := operationKit.Validate(h.plannerOptions.ExecutionOptions.SkipLoader, opContext.remapVariables); err != nil {
		opContext.validationTime = time.Since(startValidation)
		return nil, nil, err
	}

	opContext.validationTime = time.Since(startValidation)

	startPlanning := time.Now()

	err = h.planner.plan(opContext, h.plannerOptions)
	if err != nil {
		opContext.planningTime = time.Since(startPlanning)
		return operationKit.parsedOperation, nil, err
	}

	opContext.planningTime = time.Since(startPlanning)

	opContext.initialPayload = h.initialPayload

	return operationKit.parsedOperation, opContext, nil
}

func (h *WebSocketConnectionHandler) executeSubscription(registration *SubscriptionRegistration) {

	rw := newWebsocketResponseWriter(registration.msg.ID, h.protocol, h.graphqlHandler.subgraphErrorPropagation.Enabled, h.logger, h.stats)

	_, operationCtx, err := h.parseAndPlan(registration)
	if err != nil {
		wErr := h.writeErrorMessage(registration.msg.ID, err)
		if wErr != nil {
			h.logger.Warn("writing error message", zap.Error(wErr))
		}
		return
	}

	if h.forwardUpgradeHeaders.enabled && h.upgradeRequestHeaders != nil {
		if operationCtx.extensions == nil {
			operationCtx.extensions = json.RawMessage("{}")
		}
		operationCtx.extensions, err = jsonparser.Set(operationCtx.extensions, h.upgradeRequestHeaders, "upgradeHeaders")
		if err != nil {
			h.logger.Warn("Setting upgrade request data", zap.Error(err))
			_ = h.writeErrorMessage(registration.msg.ID, err)
			return
		}
	}
	if h.forwardQueryParams.enabled && h.upgradeRequestQueryParams != nil {
		if operationCtx.extensions == nil {
			operationCtx.extensions = json.RawMessage("{}")
		}
		operationCtx.extensions, err = jsonparser.Set(operationCtx.extensions, h.upgradeRequestQueryParams, "upgradeQueryParams")
		if err != nil {
			h.logger.Warn("Setting upgrade request data", zap.Error(err))
			_ = h.writeErrorMessage(registration.msg.ID, err)
			return
		}

	}
	if h.forwardInitialPayload && operationCtx.initialPayload != nil {
		if operationCtx.extensions == nil {
			operationCtx.extensions = json.RawMessage("{}")
		}
		operationCtx.extensions, err = jsonparser.Set(operationCtx.extensions, operationCtx.initialPayload, "initialPayload")
		if err != nil {
			h.logger.Warn("Setting initial payload", zap.Error(err))
			_ = h.writeErrorMessage(registration.msg.ID, err)
			return
		}
	}
	resolveCtx := &resolve.Context{
		Variables: operationCtx.Variables(),
		Request: resolve.Request{
			Header: registration.clientRequest.Header,
			ID:     h.initRequestID,
		},
		RenameTypeNames: h.graphqlHandler.executor.RenameTypeNames,
		RemapVariables:  operationCtx.remapVariables,
		TracingOptions:  operationCtx.traceOptions,
		Extensions:      operationCtx.extensions,
	}
	if h.forwardInitialPayload && operationCtx.initialPayload != nil {
		resolveCtx.InitialPayload = operationCtx.initialPayload
	}

	reqContext := buildRequestContext(requestContextOptions{
		operationContext:    operationCtx,
		requestLogger:       h.logger,
		metricSetAttributes: nil,
		w:                   nil,
		r:                   registration.clientRequest,
	})
	resolveCtx = resolveCtx.WithContext(withRequestContext(h.ctx, reqContext))
	if h.graphqlHandler.authorizer != nil {
		resolveCtx = WithAuthorizationExtension(resolveCtx)
		resolveCtx.SetAuthorizer(h.graphqlHandler.authorizer)
	}
	resolveCtx = h.graphqlHandler.configureRateLimiting(resolveCtx)

	// Put in a closure to evaluate err after defer
	defer func() {
		// StatusCode has no meaning here. We set it to 0 but set the error.
		h.metrics.ExportSchemaUsageInfo(operationCtx, 0, err != nil, false)
	}()

	switch p := operationCtx.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		_, err = h.graphqlHandler.executor.Resolver.ResolveGraphQLResponse(resolveCtx, p.Response, nil, rw)
		if err != nil {
			h.logger.Warn("Resolving GraphQL response", zap.Error(err))
			h.graphqlHandler.WriteError(resolveCtx, err, p.Response, rw)
		}
		_ = rw.Flush()
		rw.Complete()
	case *plan.SubscriptionResponsePlan:
		err = h.graphqlHandler.executor.Resolver.AsyncResolveGraphQLSubscription(resolveCtx, p.Response, rw.SubscriptionResponseWriter(), registration.id)
		if err != nil {
			h.logger.Warn("Resolving GraphQL subscription", zap.Error(err))
			h.graphqlHandler.WriteError(resolveCtx, err, p.Response.Response, rw)
			return
		}
	}
}

type SubscriptionRegistration struct {
	id            resolve.SubscriptionIdentifier
	msg           *wsproto.Message
	clientRequest *http.Request
}

// registerSubscription registers a new subscription with the given message. This method is not safe for concurrent use.
func (h *WebSocketConnectionHandler) registerSubscription(msg *wsproto.Message) (*SubscriptionRegistration, error) {
	if msg.ID == "" {
		return nil, fmt.Errorf("missing id in subscribe")
	}
	_, exists := h.subscriptions.Load(msg.ID)
	if exists {
		return nil, fmt.Errorf("subscription with id %q already exists", msg.ID)
	}

	subscriptionID := h.subscriptionIDs.Inc()
	h.subscriptions.Store(msg.ID, subscriptionID)

	registration := &SubscriptionRegistration{
		id: resolve.SubscriptionIdentifier{
			ConnectionID:   h.connectionID,
			SubscriptionID: subscriptionID,
		},
		msg: msg,
		// executeSubscription is running on a worker pool, so we have to clone the request
		// before passing it to the worker pool. The original request is not safe for concurrent use and
		// is needed later to construct the operation context and to clone the resolver context.
		clientRequest: h.request.Clone(h.request.Context()),
	}

	return registration, nil
}

func (h *WebSocketConnectionHandler) handleComplete(msg *wsproto.Message) error {
	value, exists := h.subscriptions.Load(msg.ID)
	if !exists {
		return h.requestError(fmt.Errorf("no subscription was registered for ID %q", msg.ID))
	}
	h.subscriptions.Delete(msg.ID)
	subscriptionID, ok := value.(int64)
	if !ok {
		return h.requestError(fmt.Errorf("invalid subscription state for ID %q", msg.ID))
	}
	id := resolve.SubscriptionIdentifier{
		ConnectionID:   h.connectionID,
		SubscriptionID: subscriptionID,
	}
	return h.graphqlHandler.executor.Resolver.AsyncUnsubscribeSubscription(id)
}

func (h *WebsocketHandler) HandleMessage(handler *WebSocketConnectionHandler, msg *wsproto.Message) (err error) {

	switch msg.Type {
	case wsproto.MessageTypeTerminate:
		return errClientTerminatedConnection
	case wsproto.MessageTypePing:
		_ = handler.protocol.Pong(msg)
	case wsproto.MessageTypePong:
		// "Furthermore, the Pong message may even be sent unsolicited as a unidirectional heartbeat"
		return nil
	case wsproto.MessageTypeSubscribe:
		registration, err := handler.registerSubscription(msg)
		if err != nil {
			h.logger.Warn("Handling subscription registration", zap.Error(err))
			return handler.requestError(fmt.Errorf("error registering subscription id: %s", msg.ID))
		}
		if err := h.handlerSem.Acquire(handler.ctx, 1); err != nil {
			return err
		}
		defer h.handlerSem.Release(1)
		handler.executeSubscription(registration)
	case wsproto.MessageTypeComplete:
		err = handler.handleComplete(msg)
		if err != nil {
			h.logger.Warn("Handling complete", zap.Error(err))
		}
	default:
		return handler.requestError(fmt.Errorf("unsupported message type %d", msg.Type))
	}
	return nil
}

func (h *WebSocketConnectionHandler) Initialize() (err error) {
	h.logger.Debug("Websocket connection", zap.String("protocol", h.protocol.Subprotocol()))
	h.initialPayload, err = h.protocol.Initialize()
	if err != nil {
		_ = h.requestError(fmt.Errorf("error initializing session"))
		return err
	}
	if h.forwardQueryParams.enabled {
		query := h.request.URL.Query()
		params := make(map[string]string, len(query))
		for k := range query {
			if !h.ignoreQueryParameter(k) {
				params[k] = query.Get(k)
			}
		}
		if len(params) != 0 {
			h.upgradeRequestQueryParams, err = json.Marshal(params)
			if err != nil {
				return err
			}
		}
	}
	if h.forwardUpgradeHeaders.enabled {
		header := make(map[string]string, len(h.request.Header))
		for k := range h.request.Header {
			if h.ignoreHeader(k) {
				continue
			}
			header[k] = h.request.Header.Get(k)
		}
		if len(header) > 0 {
			h.upgradeRequestHeaders, err = json.Marshal(header)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (h *WebSocketConnectionHandler) ignoreQueryParameter(k string) bool {
	if h.forwardQueryParams.withStaticAllowList {
		if slices.Contains(h.forwardQueryParams.staticAllowList, k) {
			return false
		}
	}
	if h.forwardQueryParams.withRegexAllowList {
		for _, re := range h.forwardQueryParams.regexAllowList {
			if re.MatchString(k) {
				return false
			}
		}
	}
	return h.forwardQueryParams.withStaticAllowList || h.forwardQueryParams.withRegexAllowList
}

func (h *WebSocketConnectionHandler) ignoreHeader(k string) bool {
	if h.forwardUpgradeHeaders.withStaticAllowList {
		if slices.Contains(h.forwardUpgradeHeaders.staticAllowList, k) {
			return false
		}
	}
	if h.forwardUpgradeHeaders.withRegexAllowList {
		for _, re := range h.forwardUpgradeHeaders.regexAllowList {
			if re.MatchString(k) {
				return false
			}
		}
	}
	return h.forwardUpgradeHeaders.withStaticAllowList || h.forwardUpgradeHeaders.withRegexAllowList
}

func (h *WebSocketConnectionHandler) Complete(rw *websocketResponseWriter) {
	h.subscriptions.Delete(rw.id)
	err := rw.protocol.Done(rw.id)
	if err != nil {
		return
	}
	_ = rw.Flush()
}

func (h *WebSocketConnectionHandler) Close() {
	// Remove any pending IDs associated with this connection
	err := h.graphqlHandler.executor.Resolver.AsyncUnsubscribeClient(h.connectionID)
	if err != nil {
		h.logger.Debug("Unsubscribing client", zap.Error(err))
	}
	err = h.conn.Close()
	if err != nil {
		h.logger.Debug("Closing websocket connection", zap.Error(err))
	}
}
