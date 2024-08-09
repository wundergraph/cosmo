package core

import (
	"bufio"
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

	"github.com/gorilla/websocket"

	"github.com/alitto/pond"
	"github.com/buger/jsonparser"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/router/internal/epoller"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

var (
	errClientTerminatedConnection = errors.New("client terminated connection")
)

type WebsocketMiddlewareOptions struct {
	OperationProcessor *OperationProcessor
	OperationBlocker   *OperationBlocker
	Planner            *OperationPlanner
	GraphQLHandler     *GraphQLHandler
	Metrics            RouterMetrics
	AccessController   *AccessController
	Logger             *zap.Logger
	Stats              WebSocketsStatistics
	ReadTimeout        time.Duration

	EnableWebSocketEpollKqueue bool
	EpollKqueuePollTimeout     time.Duration
	EpollKqueueConnBufferSize  int

	WebSocketConfiguration *config.WebSocketConfiguration
}

func NewWebsocketMiddleware(ctx context.Context, opts WebsocketMiddlewareOptions) func(http.Handler) http.Handler {

	handlerPool := pond.New(
		64,
		0,
		pond.Context(ctx),
		pond.IdleTimeout(time.Second*30),
		pond.Strategy(pond.Lazy()),
		pond.MinWorkers(8),
	)

	handler := &WebsocketHandler{
		ctx:                ctx,
		operationProcessor: opts.OperationProcessor,
		operationBlocker:   opts.OperationBlocker,
		planner:            opts.Planner,
		graphqlHandler:     opts.GraphQLHandler,
		metrics:            opts.Metrics,
		accessController:   opts.AccessController,
		logger:             opts.Logger,
		stats:              opts.Stats,
		readTimeout:        opts.ReadTimeout,
		config:             opts.WebSocketConfiguration,
		handlerPool:        handlerPool,
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
	if opts.EnableWebSocketEpollKqueue {
		poller, err := epoller.NewPoller(opts.EpollKqueueConnBufferSize, opts.EpollKqueuePollTimeout)
		if err == nil {
			opts.Logger.Debug("Epoll is available")

			handler.epoll = poller
			handler.connections = make(map[int]*WebSocketConnectionHandler)
			go handler.runPoller()
		} else {
			opts.Logger.Warn("Epoll is only available on Linux and MacOS. Falling back to synchronous handling.")
		}
	} else {
		opts.Logger.Debug("Epoll is disabled by configuration")
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
	rw   *bufio.ReadWriter
}

func newWSConnectionWrapper(conn net.Conn, rw *bufio.ReadWriter) *wsConnectionWrapper {
	return &wsConnectionWrapper{
		conn: conn,
		rw:   rw,
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
	err := wsutil.WriteServerText(c.rw, []byte(text))
	if err != nil {
		return err
	}
	return c.rw.Flush()
}

func (c *wsConnectionWrapper) WriteJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	err = wsutil.WriteServerText(c.rw, data)
	if err != nil {
		return err
	}
	return c.rw.Flush()
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
	metrics            RouterMetrics
	accessController   *AccessController
	logger             *zap.Logger

	epoll         epoller.Poller
	connections   map[int]*WebSocketConnectionHandler
	connectionsMu sync.RWMutex

	handlerPool   *pond.WorkerPool
	connectionIDs atomic.Int64

	stats WebSocketsStatistics

	readTimeout time.Duration

	absintheHandlerEnabled bool
	absintheHandlerPath    string

	forwardUpgradeHeadersConfig forwardConfig
	forwardQueryParamsConfig    forwardConfig
}

func (h *WebsocketHandler) handleUpgradeRequest(w http.ResponseWriter, r *http.Request) {
	var (
		subProtocol string
	)

	requestID := middleware.GetReqID(r.Context())
	requestLogger := h.logger.With(logging.WithRequestID(requestID))
	clientInfo := NewClientInfoFromRequest(r)

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
	c, rw, _, err := upgrader.Upgrade(r, w)
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

	conn := newWSConnectionWrapper(c, rw)
	protocol, err := wsproto.NewProtocol(subProtocol, conn)
	if err != nil {
		requestLogger.Error("Create websocket protocol", zap.Error(err))
		_ = c.Close()
		return
	}

	handler := NewWebsocketConnectionHandler(h.ctx, WebSocketConnectionHandlerOptions{
		OperationProcessor:    h.operationProcessor,
		OperationBlocker:      h.operationBlocker,
		Planner:               h.planner,
		GraphQLHandler:        h.graphqlHandler,
		Metrics:               h.metrics,
		ResponseWriter:        w,
		Request:               r,
		Connection:            conn,
		Protocol:              protocol,
		Logger:                h.logger,
		Stats:                 h.stats,
		ConnectionID:          h.connectionIDs.Inc(),
		ClientInfo:            clientInfo,
		InitRequestID:         requestID,
		Config:                h.config,
		ForwardUpgradeHeaders: h.forwardUpgradeHeadersConfig,
		ForwardQueryParams:    h.forwardQueryParamsConfig,
	})
	err = handler.Initialize()
	if err != nil {
		requestLogger.Error("Initializing websocket connection", zap.Error(err))
		handler.Close()
		return
	}

	// Only when epoll is available. On Windows, epoll is not available
	if h.epoll != nil {
		err = h.addConnection(c, handler)
		if err != nil {
			requestLogger.Error("Adding connection to epoll", zap.Error(err))
			handler.Close()
		}
		return
	}

	// Handle messages sync when epoll is not available

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
	h.connections[fd] = handler
	return h.epoll.Add(conn)
}

func (h *WebsocketHandler) removeConnection(conn net.Conn, handler *WebSocketConnectionHandler, fd int) {
	h.stats.ConnectionsDec()
	h.connectionsMu.Lock()
	delete(h.connections, fd)
	h.connectionsMu.Unlock()
	err := h.epoll.Remove(conn)
	if err != nil {
		h.logger.Warn("Removing connection from epoll", zap.Error(err))
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
	if con, ok := conn.(epoller.ConnImpl); ok {
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
		_ = h.epoll.Close(true)
		h.connectionsMu.Unlock()
	}()
	for {
		select {
		case <-done:
			return
		default:
			connections, err := h.epoll.Wait(128)
			if err != nil {
				h.logger.Warn("Epoll wait", zap.Error(err))
				continue
			}
			for i := 0; i < len(connections); i++ {
				if connections[i] == nil {
					continue
				}
				conn := connections[i].(epoller.ConnImpl)
				// check if the connection is still valid
				fd := socketFd(conn)
				h.connectionsMu.RLock()
				handler, exists := h.connections[fd]
				h.connectionsMu.RUnlock()
				if !exists {
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
						return
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
	stats           WebSocketsStatistics
	propagateErrors bool
}

var _ http.ResponseWriter = (*websocketResponseWriter)(nil)
var _ resolve.SubscriptionResponseWriter = (*websocketResponseWriter)(nil)

func newWebsocketResponseWriter(id string, protocol wsproto.Proto, propagateErrors bool, logger *zap.Logger, stats WebSocketsStatistics) *websocketResponseWriter {
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
	Metrics               RouterMetrics
	ResponseWriter        http.ResponseWriter
	Request               *http.Request
	Connection            *wsConnectionWrapper
	Protocol              wsproto.Proto
	Logger                *zap.Logger
	Stats                 WebSocketsStatistics
	ConnectionID          int64
	RequestContext        context.Context
	ClientInfo            *ClientInfo
	InitRequestID         string
	ForwardUpgradeHeaders forwardConfig
	ForwardQueryParams    forwardConfig
}

type WebSocketConnectionHandler struct {
	ctx                context.Context
	operationProcessor *OperationProcessor
	operationBlocker   *OperationBlocker
	planner            *OperationPlanner
	graphqlHandler     *GraphQLHandler
	metrics            RouterMetrics
	w                  http.ResponseWriter
	r                  *http.Request
	conn               *wsConnectionWrapper
	protocol           wsproto.Proto
	clientInfo         *ClientInfo
	logger             *zap.Logger

	initialPayload            json.RawMessage
	upgradeRequestHeaders     json.RawMessage
	upgradeRequestQueryParams json.RawMessage

	initRequestID   string
	connectionID    int64
	subscriptionIDs atomic.Int64
	subscriptions   sync.Map
	stats           WebSocketsStatistics

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
		metrics:               opts.Metrics,
		w:                     opts.ResponseWriter,
		r:                     opts.Request,
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

func (h *WebSocketConnectionHandler) parseAndPlan(payload []byte) (*ParsedOperation, *operationContext, error) {
	operationKit, err := h.operationProcessor.NewKit(payload, nil)
	if err != nil {
		return nil, nil, err
	}
	defer operationKit.Free()

	if err := operationKit.UnmarshalOperation(); err != nil {
		return nil, nil, err
	}

	var skipParse bool

	if operationKit.parsedOperation.IsPersistedOperation {
		skipParse, err = operationKit.FetchPersistedOperation(h.ctx, h.clientInfo, baseAttributesFromContext(h.ctx))
		if err != nil {
			return nil, nil, err
		}
	}

	// If the persistent operation is already in the cache, we skip the parse step
	// because the operation was already parsed. This is a performance optimization, and we
	// can do it because we know that the persisted operation is immutable (identified by the hash)
	if !skipParse {
		if err := operationKit.Parse(); err != nil {
			return nil, nil, err
		}
	}

	if blocked := h.operationBlocker.OperationIsBlocked(operationKit.parsedOperation); blocked != nil {
		return nil, nil, blocked
	}

	if _, err := operationKit.NormalizeOperation(); err != nil {
		return nil, nil, err
	}

	if err := operationKit.NormalizeVariables(); err != nil {
		return nil, nil, err
	}

	if _, err := operationKit.Validate(); err != nil {
		return nil, nil, err
	}

	opContext, err := h.planner.Plan(operationKit.parsedOperation, h.clientInfo, OperationProtocolWS, ParseRequestTraceOptions(h.r))
	if err != nil {
		return operationKit.parsedOperation, nil, err
	}
	opContext.initialPayload = h.initialPayload
	return operationKit.parsedOperation, opContext, nil
}

func (h *WebSocketConnectionHandler) executeSubscription(msg *wsproto.Message, id resolve.SubscriptionIdentifier) {

	rw := newWebsocketResponseWriter(msg.ID, h.protocol, h.graphqlHandler.subgraphErrorPropagation.Enabled, h.logger, h.stats)

	_, operationCtx, err := h.parseAndPlan(msg.Payload)
	if err != nil {
		wErr := h.writeErrorMessage(msg.ID, err)
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
			_ = h.writeErrorMessage(msg.ID, err)
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
			_ = h.writeErrorMessage(msg.ID, err)
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
			_ = h.writeErrorMessage(msg.ID, err)
			return
		}
	}
	resolveCtx := &resolve.Context{
		Variables: operationCtx.Variables(),
		Request: resolve.Request{
			Header: h.r.Header.Clone(),
			ID:     h.initRequestID,
		},
		RenameTypeNames: h.graphqlHandler.executor.RenameTypeNames,
		TracingOptions:  operationCtx.traceOptions,
		Extensions:      operationCtx.extensions,
	}
	if h.forwardInitialPayload && operationCtx.initialPayload != nil {
		resolveCtx.InitialPayload = operationCtx.initialPayload
	}
	resolveCtx = resolveCtx.WithContext(withRequestContext(h.ctx, buildRequestContext(nil, h.r, operationCtx, h.logger)))
	if h.graphqlHandler.authorizer != nil {
		resolveCtx = WithAuthorizationExtension(resolveCtx)
		resolveCtx.SetAuthorizer(h.graphqlHandler.authorizer)
	}
	resolveCtx = h.graphqlHandler.configureRateLimiting(resolveCtx)

	// Put in a closure to evaluate err after the defer
	defer func() {
		// StatusCode has no meaning here. We set it to 0 but set the error.
		h.metrics.ExportSchemaUsageInfo(operationCtx, 0, err != nil)
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
		err = h.graphqlHandler.executor.Resolver.AsyncResolveGraphQLSubscription(resolveCtx, p.Response, rw.SubscriptionResponseWriter(), id)
		if err != nil {
			h.logger.Warn("Resolving GraphQL subscription", zap.Error(err))
			h.graphqlHandler.WriteError(resolveCtx, err, p.Response.Response, rw)
			return
		}
	}
}

func (h *WebSocketConnectionHandler) handleSubscribe(msg *wsproto.Message) error {
	if msg.ID == "" {
		return fmt.Errorf("missing id in subscribe")
	}
	_, exists := h.subscriptions.Load(msg.ID)
	if exists {
		return fmt.Errorf("subscription with id %q already exists", msg.ID)
	}
	subscriptionID := h.subscriptionIDs.Inc()
	h.subscriptions.Store(msg.ID, subscriptionID)
	id := resolve.SubscriptionIdentifier{
		ConnectionID:   h.connectionID,
		SubscriptionID: subscriptionID,
	}
	h.executeSubscription(msg, id)
	return nil
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
		h.handlerPool.Submit(func() {
			err := handler.handleSubscribe(msg)
			if err != nil {
				h.logger.Warn("Handling subscribe", zap.Error(err))
			}
		})
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
		h.logger.Error("Initializing websocket connection", zap.Error(err))
		_ = h.requestError(fmt.Errorf("error initializing session"))
		return err
	}
	if h.forwardQueryParams.enabled {
		query := h.r.URL.Query()
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
		header := make(map[string]string, len(h.r.Header))
		for k := range h.r.Header {
			if h.ignoreHeader(k) {
				continue
			}
			header[k] = h.r.Header.Get(k)
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
