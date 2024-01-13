package core

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/epoller"
	"net"
	"net/http"
	"sync"
	"syscall"
	"time"

	"github.com/alitto/pond"
	"github.com/go-chi/chi/middleware"
	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/gorilla/websocket"
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

var (
	errClientTerminatedConnection = errors.New("client terminated connection")
)

type WebsocketMiddlewareOptions struct {
	Parser                     *OperationParser
	Planner                    *OperationPlanner
	GraphQLHandler             *GraphQLHandler
	Metrics                    *RouterMetrics
	AccessController           *AccessController
	Logger                     *zap.Logger
	Stats                      WebSocketsStatistics
	EnableWebSocketEpollKqueue bool
	ReadTimeout                time.Duration
}

func NewWebsocketMiddleware(ctx context.Context, opts WebsocketMiddlewareOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		handler := &WebsocketHandler{
			ctx:              ctx,
			next:             next,
			parser:           opts.Parser,
			planner:          opts.Planner,
			graphqlHandler:   opts.GraphQLHandler,
			metrics:          opts.Metrics,
			accessController: opts.AccessController,
			logger:           opts.Logger,
			stats:            opts.Stats,
			readTimeout:      opts.ReadTimeout,
		}
		handler.handlerPool = pond.New(
			64,
			0,
			pond.Context(ctx),
			pond.IdleTimeout(time.Second*30),
			pond.Strategy(pond.Lazy()),
			pond.MinWorkers(8),
		)
		if opts.EnableWebSocketEpollKqueue {
			poller, err := epoller.NewPoller(128)
			if err == nil {
				handler.epoll = poller
				handler.connections = make(map[int]*WebSocketConnectionHandler)
				go handler.runPoller()
			}
		}

		return handler
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
	text, err := wsutil.ReadClientText(c.rw)
	if err != nil {
		return err
	}
	return json.Unmarshal(text, v)
}

func (c *wsConnectionWrapper) WriteText(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return wsutil.WriteServerText(c.conn, unsafebytes.StringToBytes(text))
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
	ctx              context.Context
	next             http.Handler
	parser           *OperationParser
	planner          *OperationPlanner
	graphqlHandler   *GraphQLHandler
	metrics          *RouterMetrics
	accessController *AccessController
	logger           *zap.Logger

	epoll         epoller.Poller
	connections   map[int]*WebSocketConnectionHandler
	connectionsMu sync.RWMutex

	handlerPool   *pond.WorkerPool
	connectionIDs atomic.Int64

	stats WebSocketsStatistics

	readTimeout time.Duration
}

func (h *WebsocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !websocket.IsWebSocketUpgrade(r) {
		h.next.ServeHTTP(w, r)
		return
	}

	var (
		subProtocol string
		hasErrored  bool
		statusCode  = 0
	)

	clientInfo := NewClientInfoFromRequest(r)

	/**
	* Track request and schema usage metrics
	 */
	metrics := h.metrics.StartOperation(clientInfo, h.logger, r.ContentLength)
	defer func() {
		metrics.Finish(hasErrored, statusCode, 0)
	}()

	// Check access control before upgrading the connection
	validatedReq, err := h.accessController.Access(w, r)
	if err != nil {
		hasErrored = true
		statusCode = http.StatusForbidden
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
		h.logger.Warn("Websocket upgrade", zap.Error(err))

		hasErrored = true
		_ = c.Close()
		return
	}

	// After successful upgrade, we can't write to the response writer anymore
	// because it's hijacked by the websocket connection

	conn := newWSConnectionWrapper(c, rw)
	protocol, err := wsproto.NewProtocol(subProtocol, conn)
	if err != nil {
		h.logger.Error("Create websocket protocol", zap.Error(err))

		hasErrored = true
		_ = c.Close()
		return
	}

	handler := NewWebsocketConnectionHandler(h.ctx, WebSocketConnectionHandlerOptions{
		Parser:         h.parser,
		Planner:        h.planner,
		GraphQLHandler: h.graphqlHandler,
		Metrics:        h.metrics,
		ResponseWriter: w,
		Request:        r,
		Connection:     conn,
		Protocol:       protocol,
		Logger:         h.logger,
		Stats:          h.stats,
		ConnectionID:   h.connectionIDs.Inc(),
		ClientInfo:     clientInfo,
	})
	err = handler.Initialize()
	if err != nil {
		h.logger.Error("Initializing websocket connection", zap.Error(err))

		hasErrored = true
		handler.Close()
		return
	}

	if h.readTimeout > 0 {
		err = handler.conn.conn.SetReadDeadline(time.Now().Add(h.readTimeout))
		if err != nil {
			h.logger.Error("Setting read deadline", zap.Error(err))

			hasErrored = true
			handler.Close()
			return
		}
	}

	msg, err := handler.protocol.ReadMessage()
	if err != nil {
		h.logger.Debug("Client closed connection. Could not read initial message.", zap.Error(err))

		hasErrored = true
		handler.Close()
		return
	}

	/**
	* Parse and create the operation context during upgrade once.
	* A subscription is immutable, so we can reuse the context for all messages
	 */

	_, operationContext, err := handler.parseAndPlan(msg.Payload)
	if err != nil {
		h.logger.Debug("Could not parse and plan initial operation", zap.Error(err))

		hasErrored = true
		// If the operation is invalid, send an error message immediately
		handler.writeErrorMessage(msg.ID, err)
		handler.Close()
		return
	}

	handler.operationContext = operationContext

	metrics.AddOperationContext(operationContext)

	// TODO: Instrument subscription with tracing & metrics

	/**
	* Create the context for all subscription execution with shared values
	 */

	handler.parentContext = withRequestContext(
		context.WithValue(
			context.Background(),
			middleware.RequestIDKey, middleware.GetReqID(r.Context()),
		),
		buildRequestContext(nil, r, operationContext, h.logger),
	)

	// Handle the first message in the main goroutine, which is faster than polling
	// then add the connection to the epoll to save resources
	err = h.HandleMessage(handler, msg)
	if err != nil {
		h.logger.Error("Handling websocket message", zap.Error(err))

		hasErrored = true
		handler.Close()
		return
	}

	// Only when epoll is available. On Windows, epoll is not available
	if h.epoll != nil {
		err = h.addConnection(c, handler)
		if err != nil {
			h.logger.Error("Adding connection to epoll", zap.Error(err))

			hasErrored = true
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
	fd := sockedFd(conn)
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

func sockedFd(conn net.Conn) int {
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
			connections, err := h.epoll.Wait(8)
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
				fd := sockedFd(conn)
				h.connectionsMu.RLock()
				handler, exists := h.connections[fd]
				h.connectionsMu.RUnlock()
				if !exists {
					continue
				}

				err = handler.conn.conn.SetReadDeadline(time.Now().Add(time.Second * 5))
				if err != nil {
					h.logger.Debug("Setting read deadline", zap.Error(err))
					h.removeConnection(conn, handler, fd)
					continue
				}

				msg, err := handler.protocol.ReadMessage()
				if err != nil {
					if isReadTimeout(err) {
						continue
					}
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
	id           string
	protocol     wsproto.Proto
	header       http.Header
	buf          bytes.Buffer
	writtenBytes int
	logger       *zap.Logger
	stats        WebSocketsStatistics
}

var _ http.ResponseWriter = (*websocketResponseWriter)(nil)
var _ resolve.SubscriptionResponseWriter = (*websocketResponseWriter)(nil)

func newWebsocketResponseWriter(id string, protocol wsproto.Proto, logger *zap.Logger, stats WebSocketsStatistics) *websocketResponseWriter {
	return &websocketResponseWriter{
		id:       id,
		protocol: protocol,
		header:   make(http.Header),
		logger:   logger.With(zap.String("subscription_id", id)),
		stats:    stats,
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
	defer rw.stats.SubscriptionsDec()
	if err != nil {
		rw.logger.Debug("Sending complete message", zap.Error(err))
	}
}

func (rw *websocketResponseWriter) Write(data []byte) (int, error) {
	rw.writtenBytes += len(data)
	return rw.buf.Write(data)
}

func (rw *websocketResponseWriter) Flush() {
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
			}
		}

		// Check if the result is an error
		errorsResult := gjson.GetBytes(payload, "errors")
		if errorsResult.Type == gjson.JSON {
			err = rw.protocol.WriteGraphQLErrors(rw.id, json.RawMessage(errorsResult.Raw), extensions)
		} else {
			err = rw.protocol.WriteGraphQLData(rw.id, payload, extensions)
		}

		// if err is websocket.ErrCloseSent, it means we got a Complete from
		// the client, and we closed the WS from a different goroutine
		if err != nil && !errors.Is(err, websocket.ErrCloseSent) {
			rw.logger.Warn("Sending response on websocket flush", zap.Error(err))
		}
		rw.buf.Reset()
	}
}

func (rw *websocketResponseWriter) SubscriptionResponseWriter() resolve.SubscriptionResponseWriter {
	return rw
}

type graphqlError struct {
	Message string `json:"message"`
}

type WebSocketConnectionHandlerOptions struct {
	Parser         *OperationParser
	Planner        *OperationPlanner
	GraphQLHandler *GraphQLHandler
	Metrics        *RouterMetrics
	ResponseWriter http.ResponseWriter
	Request        *http.Request
	Connection     *wsConnectionWrapper
	Protocol       wsproto.Proto
	Logger         *zap.Logger
	Stats          WebSocketsStatistics
	ConnectionID   int64
	RequestContext context.Context
	ClientInfo     *ClientInfo
}

type WebSocketConnectionHandler struct {
	ctx            context.Context
	parser         *OperationParser
	planner        *OperationPlanner
	graphqlHandler *GraphQLHandler
	metrics        *RouterMetrics
	w              http.ResponseWriter
	r              *http.Request
	conn           *wsConnectionWrapper
	protocol       wsproto.Proto
	initialPayload json.RawMessage
	clientInfo     *ClientInfo
	logger         *zap.Logger

	connectionID     int64
	subscriptionIDs  atomic.Int64
	subscriptions    sync.Map
	stats            WebSocketsStatistics
	parentContext    context.Context
	operationContext *operationContext
}

func NewWebsocketConnectionHandler(ctx context.Context, opts WebSocketConnectionHandlerOptions) *WebSocketConnectionHandler {
	return &WebSocketConnectionHandler{
		ctx:            ctx,
		parser:         opts.Parser,
		planner:        opts.Planner,
		graphqlHandler: opts.GraphQLHandler,
		metrics:        opts.Metrics,
		w:              opts.ResponseWriter,
		r:              opts.Request,
		conn:           opts.Connection,
		protocol:       opts.Protocol,
		logger:         opts.Logger,
		connectionID:   opts.ConnectionID,
		stats:          opts.Stats,
		parentContext:  opts.RequestContext,
		clientInfo:     opts.ClientInfo,
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
	operation, err := h.parser.Parse(h.ctx, h.clientInfo, payload, h.logger)
	if err != nil {
		return nil, nil, err
	}
	opContext, err := h.planner.Plan(operation, h.clientInfo, OperationProtocolWS, ParseRequestTraceOptions(h.r))
	if err != nil {
		return operation, nil, err
	}
	opContext.initialPayload = h.initialPayload
	return operation, opContext, nil
}

func (h *WebSocketConnectionHandler) executeSubscription(msg *wsproto.Message, id resolve.SubscriptionIdentifier) {

	rw := newWebsocketResponseWriter(msg.ID, h.protocol, h.logger, h.stats)
	requestID := middleware.GetReqID(h.parentContext)

	resolveCtx := &resolve.Context{
		Variables: h.operationContext.Variables(),
		Request: resolve.Request{
			Header: h.r.Header.Clone(),
			ID:     requestID,
		},
		RenameTypeNames:       h.graphqlHandler.executor.RenameTypeNames,
		RequestTracingOptions: h.operationContext.traceOptions,
		InitialPayload:        h.operationContext.initialPayload,
		Extensions:            h.operationContext.extensions,
	}

	// Pass the request context, so we don't lose the request ID and trace context
	resolveCtx = resolveCtx.WithContext(h.parentContext)

	h.stats.SubscriptionsInc()

	switch p := h.operationContext.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		err := h.graphqlHandler.executor.Resolver.ResolveGraphQLResponse(resolveCtx, p.Response, nil, rw)
		if err != nil {
			h.logger.Warn("Resolving GraphQL response", zap.Error(err))
			return
		}
		rw.Flush()
		rw.Complete()
	case *plan.SubscriptionResponsePlan:
		err := h.graphqlHandler.executor.Resolver.AsyncResolveGraphQLSubscription(resolveCtx, p.Response, rw.SubscriptionResponseWriter(), id)
		if err != nil {
			h.logger.Warn("Resolving GraphQL subscription", zap.Error(err))
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
	return nil
}

func (h *WebSocketConnectionHandler) Complete(rw *websocketResponseWriter) {
	h.subscriptions.Delete(rw.id)
	err := rw.protocol.Done(rw.id)
	if err != nil {
		return
	}
	rw.Flush()
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
