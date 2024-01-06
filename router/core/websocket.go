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
	"sync"
	"syscall"
	"time"

	"github.com/alitto/pond"
	"github.com/go-chi/chi/middleware"
	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	"github.com/gorilla/websocket"
	"github.com/smallnest/epoller"
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
	Stats                      *WebSocketStats
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
		if opts.EnableWebSocketEpollKqueue {
			poller, err := epoller.NewPoller()
			if err == nil {
				handler.epoll = poller
				handler.connections = make(map[int]*WebSocketConnectionHandler)
				go handler.runPoller()
			}
		}
		handler.handlerPool = pond.New(
			64,
			0,
			pond.Context(ctx),
			pond.IdleTimeout(time.Second*30),
			pond.Strategy(pond.Lazy()),
			pond.MinWorkers(8),
		)
		return handler
	}
}

// wsConnectionWrapper is a wrapper around websocket.Conn that allows
// writing from multiple goroutines
type wsConnectionWrapper struct {
	ctx  context.Context
	conn net.Conn
	mu   sync.Mutex
	rw   *bufio.ReadWriter
}

func newWSConnectionWrapper(ctx context.Context, conn net.Conn, rw *bufio.ReadWriter) *wsConnectionWrapper {
	return &wsConnectionWrapper{
		ctx:  ctx,
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

	stats *WebSocketStats

	readTimeout time.Duration
}

func (h *WebsocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !websocket.IsWebSocketUpgrade(r) {
		h.next.ServeHTTP(w, r)
		return
	}
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
	var (
		subProtocol string
	)
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
		h.logger.Warn("websocket upgrade", zap.Error(err))
		return
	}
	conn := newWSConnectionWrapper(h.ctx, c, rw)
	protocol, err := wsproto.NewProtocol(subProtocol, conn)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
	})
	err = handler.Initialize()
	if err != nil {
		h.logger.Warn("initializing websocket connection", zap.Error(err))
		_ = c.Close()
		return
	}
	// handle the first message in the main goroutine, which is faster than polling
	// then add the connection to the epoll to save resources
	err = h.HandleMessage(handler, h.readTimeout)
	if err != nil && !h.isReadTimeout(err) {
		h.logger.Warn("handling websocket connection", zap.Error(err))
		_ = c.Close()
		return
	}
	if h.epoll != nil {
		err = h.addConnection(c, handler)
		if err != nil {
			h.logger.Warn("adding connection to epoll", zap.Error(err))
		}
		return
	}
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
			err := h.HandleMessage(handler, h.readTimeout)
			if err != nil {
				if h.isReadTimeout(err) {
					continue
				}
				if errors.Is(err, errClientTerminatedConnection) {
					return
				}
				h.logger.Warn("handling websocket connection", zap.Error(err))
				return
			}
		}
	}
}

func (h *WebsocketHandler) isReadTimeout(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return netErr.Timeout()
	}
	return false
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
		h.logger.Warn("removing connection from epoll", zap.Error(err))
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
			connections, err := h.epoll.WaitWithBuffer()
			if err != nil {
				h.logger.Warn("epoll wait", zap.Error(err))
				continue
			}
			g := h.handlerPool.Group()
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
				g.Submit(func() {
					err = h.HandleMessage(handler, time.Second*5)
					if err != nil {
						h.removeConnection(conn, handler, fd)
					}
				})
			}
			g.Wait()
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
	stats        *WebSocketStats
}

var _ http.ResponseWriter = (*websocketResponseWriter)(nil)
var _ resolve.SubscriptionResponseWriter = (*websocketResponseWriter)(nil)

func newWebsocketResponseWriter(id string, protocol wsproto.Proto, logger *zap.Logger, stats *WebSocketStats) *websocketResponseWriter {
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
	rw.logger.Debug("response status code", zap.Int("status_code", statusCode))
}

func (rw *websocketResponseWriter) Complete() {
	err := rw.protocol.Done(rw.id)
	if err != nil {
		rw.logger.Warn("sending complete message", zap.Error(err))
	}
	rw.stats.SubscriptionsDec()
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
				rw.logger.Warn("serializing response headers", zap.Error(err))
			}
		}

		// Check if the result is an error
		errorsResult := gjson.GetBytes(payload, "errors")
		if errorsResult.Type == gjson.JSON {
			err = rw.protocol.GraphQLErrors(rw.id, json.RawMessage(errorsResult.Raw), extensions)
		} else {
			err = rw.protocol.GraphQLData(rw.id, payload, extensions)
		}
		// if err is websocket.ErrCloseSent, it means we got a Complete from
		// the client, and we closed the WS from a different goroutine
		if err != nil && err != websocket.ErrCloseSent {
			rw.logger.Warn("sending response on websocket flush", zap.Error(err))
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
	Stats          *WebSocketStats
	ConnectionID   int64
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

	connectionID    int64
	subscriptionIDs atomic.Int64
	subscriptions   sync.Map
	stats           *WebSocketStats
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
		clientInfo:     NewClientInfoFromRequest(opts.Request),
		logger:         opts.Logger,
		connectionID:   opts.ConnectionID,
		stats:          opts.Stats,
	}
}

func (h *WebSocketConnectionHandler) requestError(err error) error {
	if errors.As(err, &wsutil.ClosedError{}) {
		h.logger.Debug("client closed connection")
		return err
	}
	h.logger.Warn("handling websocket connection", zap.Error(err))
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
	return h.protocol.GraphQLErrors(operationID, payload, nil)
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

func (h *WebSocketConnectionHandler) executeSubscription(ctx context.Context, msg *wsproto.Message, id resolve.SubscriptionIdentifier) {

	metrics := h.metrics.StartOperation(h.clientInfo, h.logger, int64(len(msg.Payload)))

	// If the operation is invalid, send an error message immediately without
	// bothering to try to check if the ID is unique
	operation, operationCtx, err := h.parseAndPlan(msg.Payload)
	if err != nil {
		werr := h.writeErrorMessage(msg.ID, err)
		if werr != nil {
			h.logger.Warn("writing error message", zap.Error(werr))
		}
		return
	}

	metrics.AddOperationContext(operationCtx)

	commonAttributeValues := commonMetricAttributes(operationCtx)
	metrics.AddAttributes(commonAttributeValues...)

	initializeSpan(ctx, operation, commonAttributeValues)

	rw := newWebsocketResponseWriter(msg.ID, h.protocol, h.logger, h.stats)

	resolveCtx := &resolve.Context{
		Variables: operationCtx.Variables(),
		Request: resolve.Request{
			Header: h.r.Header.Clone(),
			ID:     middleware.GetReqID(ctx),
		},
		RenameTypeNames:       h.graphqlHandler.executor.RenameTypeNames,
		RequestTracingOptions: operationCtx.traceOptions,
		InitialPayload:        operationCtx.initialPayload,
		Extensions:            operationCtx.extensions,
	}
	resolveCtx = resolveCtx.WithContext(withRequestContext(ctx, buildRequestContext(nil, h.r, operationCtx, h.logger)))

	h.stats.SubscriptionsInc()

	switch p := operationCtx.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		err = h.graphqlHandler.executor.Resolver.ResolveGraphQLResponse(resolveCtx, p.Response, nil, rw)
		if err != nil {
			h.logger.Warn("resolving GraphQL response", zap.Error(err))
			return
		}
		rw.Flush()
		rw.Complete()
	case *plan.SubscriptionResponsePlan:
		err = h.graphqlHandler.executor.Resolver.AsyncResolveGraphQLSubscription(resolveCtx, p.Response, rw.SubscriptionResponseWriter(), id)
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
	h.executeSubscription(h.ctx, msg, id)
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

func (h *WebsocketHandler) HandleMessage(handler *WebSocketConnectionHandler, timeout time.Duration) (err error) {
	if timeout > 0 {
		err = handler.conn.conn.SetReadDeadline(time.Now().Add(timeout))
		if err != nil {
			return err
		}
	}
	msg, err := handler.protocol.ReadMessage()
	if err != nil {
		h.logger.Debug("client closed connection")
		return err
	}
	switch msg.Type {
	case wsproto.MessageTypeTerminate:
		handler.Close()
		return errClientTerminatedConnection
	case wsproto.MessageTypePing:
		_ = handler.protocol.Pong(msg)
	case wsproto.MessageTypePong:
		// "Furthermore, the Pong message may even be sent unsolicited as a unidirectional heartbeat"
		return nil
	case wsproto.MessageTypeSubscribe:
		_ = handler.handleSubscribe(msg)
	case wsproto.MessageTypeComplete:
		_ = handler.handleComplete(msg)

	default:
		return handler.requestError(fmt.Errorf("unsupported message type %d", msg.Type))
	}
	return nil
}

func (h *WebSocketConnectionHandler) Initialize() (err error) {
	h.logger.Debug("websocket connection", zap.String("protocol", h.protocol.Subprotocol()))
	h.initialPayload, err = h.protocol.Initialize()
	if err != nil {
		h.requestError(fmt.Errorf("error initializing session: %w", err))
		return
	}
	return
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
		h.logger.Warn("unsubscribing client", zap.Error(err))
	}
	err = h.conn.Close()
	if err != nil {
		h.logger.Warn("closing websocket connection", zap.Error(err))
	}
}

type WebSocketStats struct {
	ctx                            context.Context
	logger                         *zap.Logger
	connections                    int64
	subscriptions                  int64
	messagesSent                   int64
	updateConnections              chan int64
	updateSubscriptions            chan int64
	updateMessagesSent             chan int64
	updateSynchronousSubscriptions chan int64
	getReport                      chan chan UsageReport
	subscribers                    map[context.Context]chan UsageReport
	addSubscriber                  chan statsSubscription
}

type UsageReport struct {
	Connections   int64
	Subscriptions int64
	MessagesSent  int64
}

type statsSubscription struct {
	ctx context.Context
	ch  chan UsageReport
}

func NewWebSocketStats(ctx context.Context, logger *zap.Logger) *WebSocketStats {
	stats := &WebSocketStats{
		ctx:                            ctx,
		updateConnections:              make(chan int64),
		updateSubscriptions:            make(chan int64),
		updateMessagesSent:             make(chan int64),
		updateSynchronousSubscriptions: make(chan int64),
		getReport:                      make(chan chan UsageReport),
		subscribers:                    make(map[context.Context]chan UsageReport),
		addSubscriber:                  make(chan statsSubscription),
		logger:                         logger,
	}
	go stats.run(ctx)
	return stats
}

func (s *WebSocketStats) GetReport() (*UsageReport, error) {
	if s == nil {
		return nil, errors.New("WebSocketStats not initialized, use 'NewWebSocketStats' to create a new instance")
	}
	ch := make(chan UsageReport)
	s.getReport <- ch
	report := <-ch
	return &report, nil
}

func (s *WebSocketStats) Subscribe(ctx context.Context) (chan UsageReport, error) {
	if s == nil {
		return nil, errors.New("WebSocketStats not initialized, use 'NewWebSocketStats' to create a new instance")
	}
	ch := make(chan UsageReport)
	s.addSubscriber <- statsSubscription{
		ctx: ctx,
		ch:  ch,
	}
	return ch, nil
}

func (s *WebSocketStats) run(ctx context.Context) {
	tickReport := time.NewTicker(time.Second * 5)
	defer tickReport.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tickReport.C:
			s.reportConnections()
		case sub := <-s.addSubscriber:
			s.subscribers[sub.ctx] = sub.ch
		case n := <-s.updateConnections:
			s.connections += n
			s.publish()
		case n := <-s.updateSubscriptions:
			s.subscriptions += n
			s.publish()
		case n := <-s.updateSynchronousSubscriptions:
			s.connections += n
			s.subscriptions += n
			s.publish()
		case n := <-s.updateMessagesSent:
			s.messagesSent += n
			s.publish()
		case ch := <-s.getReport:
			ch <- UsageReport{
				Connections:   s.connections,
				Subscriptions: s.subscriptions,
				MessagesSent:  s.messagesSent,
			}
		}
	}
}

func (s *WebSocketStats) reportConnections() {
	s.logger.Info("WebSocket Stats",
		zap.Int64("open_connections", s.connections),
		zap.Int64("active_subscriptions", s.subscriptions),
	)
	if s.logger.Level() != zap.InfoLevel {
		fmt.Printf("WebSocket Stats: open_connections=%d active_subscriptions=%d\n", s.connections, s.subscriptions)
	}
}

func (s *WebSocketStats) publish() {
	report := UsageReport{
		Connections:   s.connections,
		Subscriptions: s.subscriptions,
		MessagesSent:  s.messagesSent,
	}
	for ctx, ch := range s.subscribers {
		select {
		case <-ctx.Done():
			close(ch)
			delete(s.subscribers, ctx)
		case ch <- report:
		}
	}
}

func (s *WebSocketStats) SubscriptionUpdateSent() {
	if s == nil {
		return
	}
	select {
	case <-s.ctx.Done():
	case s.updateMessagesSent <- 1:
	}
}

func (s *WebSocketStats) ConnectionsInc() {
	if s == nil {
		return
	}
	select {
	case <-s.ctx.Done():
	case s.updateConnections <- 1:
	}
}

func (s *WebSocketStats) ConnectionsDec() {
	if s == nil {
		return
	}
	select {
	case <-s.ctx.Done():
	case s.updateConnections <- -1:
	}
}

func (s *WebSocketStats) SubscriptionsInc() {
	if s == nil {
		return
	}
	select {
	case <-s.ctx.Done():
	case s.updateSubscriptions <- 1:
	}
}

func (s *WebSocketStats) SubscriptionsDec() {
	if s == nil {
		return
	}
	select {
	case <-s.ctx.Done():
	case s.updateSubscriptions <- -1:
	}
}

func (s *WebSocketStats) SynchronousSubscriptionsInc() {
	if s == nil {
		return
	}
	select {
	case <-s.ctx.Done():
	case s.updateSynchronousSubscriptions <- 1:
	}
}

func (s *WebSocketStats) SynchronousSubscriptionsDec() {
	if s == nil {
		return
	}
	select {
	case <-s.ctx.Done():
	case s.updateSynchronousSubscriptions <- -1:
	}
}
