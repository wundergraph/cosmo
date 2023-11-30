package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tidwall/gjson"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type WebsocketMiddlewareOptions struct {
	Parser           *OperationParser
	Planner          *OperationPlanner
	GraphQLHandler   *GraphQLHandler
	Metrics          *RouterMetrics
	AccessController *AccessController
	Logger           *zap.Logger
}

func NewWebsocketMiddleware(ctx context.Context, opts WebsocketMiddlewareOptions) func(http.Handler) http.Handler {
	ids := newGlobalIDStorage()
	return func(next http.Handler) http.Handler {
		return &WebsocketHandler{
			ctx:              ctx,
			next:             next,
			ids:              ids,
			parser:           opts.Parser,
			planner:          opts.Planner,
			graphqlHandler:   opts.GraphQLHandler,
			metrics:          opts.Metrics,
			accessController: opts.AccessController,
			logger:           opts.Logger,
		}
	}
}

// globalIDStorage is used to store the request IDs of in-flight requests.
// Use newIDStorage to create a new instance.
type globalIDStorage struct {
	ids map[string]struct{}
	mu  sync.Mutex
}

// newGlobalIDStorage creates an initialized globalIDStorage.
func newGlobalIDStorage() *globalIDStorage {
	return &globalIDStorage{
		ids: make(map[string]struct{}),
	}
}

// Insert checks if the id is not present in the storage and adds it
// atomically. Returns true if the id was inserted, false if it was already present.
func (s *globalIDStorage) Insert(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, found := s.ids[id]
	if !found {
		s.ids[id] = struct{}{}
	}
	return !found
}

// Remove checks if the id is present in the storage and removes it atomically.
// Returns true if the id was removed, false if it was not present.
func (s *globalIDStorage) Remove(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, found := s.ids[id]
	if found {
		delete(s.ids, id)
	}
	return found
}

// wsConnectionWrapper is a wrapper around websocket.Conn that allows
// writing from multiple goroutines
type wsConnectionWrapper struct {
	ctx  context.Context
	conn *websocket.Conn
	mu   sync.Mutex
}

func newWSConnectionWrapper(ctx context.Context, conn *websocket.Conn) *wsConnectionWrapper {
	return &wsConnectionWrapper{
		ctx:  ctx,
		conn: conn,
	}
}

func (c *wsConnectionWrapper) ReadJSON(v interface{}) error {
	ech := make(chan error, 1)
	go func() {
		ech <- c.conn.ReadJSON(v)
	}()
	select {
	case <-c.ctx.Done():
		c.conn.Close()
		return c.ctx.Err()
	case err := <-ech:
		return err
	}
}

type countingWriter struct {
	n int
	w io.Writer
}

func (w *countingWriter) Write(data []byte) (int, error) {
	n, err := w.w.Write(data)
	w.n += n
	return n, err
}

func (c *wsConnectionWrapper) WriteText(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	w, err := c.conn.NextWriter(websocket.TextMessage)
	if err != nil {
		return err
	}
	_, err = io.WriteString(w, text)
	return err
}

func (c *wsConnectionWrapper) WriteJSON(v interface{}) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	w, err := c.conn.NextWriter(websocket.TextMessage)
	if err != nil {
		return 0, err
	}
	cw := &countingWriter{w: w}
	err1 := json.NewEncoder(cw).Encode(v)
	err2 := w.Close()
	if err1 != nil {
		return cw.n, err1
	}
	return cw.n, err2
}

func (c *wsConnectionWrapper) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.Close()
}

type WebsocketHandler struct {
	ctx              context.Context
	next             http.Handler
	ids              *globalIDStorage
	parser           *OperationParser
	planner          *OperationPlanner
	graphqlHandler   *GraphQLHandler
	metrics          *RouterMetrics
	accessController *AccessController
	logger           *zap.Logger
}

func (h *WebsocketHandler) requestLooksLikeWebsocket(r *http.Request) bool {
	return r.Header.Get("Upgrade") == "websocket"
}

func (h *WebsocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Don't call upgrader.Upgrade unless the request looks like a websocket
	// because if Upgrade() fails it sends an error response
	if h.requestLooksLikeWebsocket(r) {
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

		upgrader := websocket.Upgrader{
			HandshakeTimeout: 5 * time.Second,
			// TODO: WriteBufferPool,
			EnableCompression: true,
			Subprotocols:      wsproto.Subprotocols(),
			CheckOrigin: func(_ *http.Request) bool {
				// Allow any origin to subscribe via WS
				return true
			},
		}
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			// Upgrade() sends an error response already, just log the error
			h.logger.Warn("upgrading websocket", zap.Error(err))
			return
		}
		conn := newWSConnectionWrapper(h.ctx, c)
		protocol, err := wsproto.NewProtocol(c.Subprotocol(), conn)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			c.Close()
			return
		}
		connectionHandler := NewWebsocketConnectionHandler(h.ctx, WebSocketConnectionHandlerOptions{
			IDs:            h.ids,
			Parser:         h.parser,
			Planner:        h.planner,
			GraphQLHandler: h.graphqlHandler,
			Metrics:        h.metrics,
			ResponseWriter: w,
			Request:        r,
			Connection:     conn,
			Protocol:       protocol,
			Logger:         h.logger,
		})
		defer connectionHandler.Close()
		connectionHandler.Serve()
		return
	}
	// Otherwise forward the request through the pipeline
	h.next.ServeHTTP(w, r)
}

type websocketResponseWriter struct {
	id           string
	protocol     wsproto.Proto
	header       http.Header
	buf          bytes.Buffer
	writtenBytes int
	logger       *zap.Logger
}

var _ http.ResponseWriter = (*websocketResponseWriter)(nil)
var _ resolve.FlushWriter = (*websocketResponseWriter)(nil)

func newWebsocketResponseWriter(id string, protocol wsproto.Proto, logger *zap.Logger) *websocketResponseWriter {
	return &websocketResponseWriter{
		id:       id,
		protocol: protocol,
		header:   make(http.Header),
		logger:   logger.With(zap.String("subscription_id", id)),
	}
}

func (rw *websocketResponseWriter) Header() http.Header {
	return rw.header
}

func (rw *websocketResponseWriter) WriteHeader(statusCode int) {
	rw.logger.Debug("response status code", zap.Int("status_code", statusCode))
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
			_, err = rw.protocol.GraphQLErrors(rw.id, json.RawMessage(errorsResult.Raw), extensions)
		} else {
			_, err = rw.protocol.GraphQLData(rw.id, payload, extensions)
		}
		// if err is websocket.ErrCloseSent, it means we got a Complete from
		// the client, and we closed the WS from a different goroutine
		if err != nil && err != websocket.ErrCloseSent {
			rw.logger.Warn("sending response on websocket flush", zap.Error(err))
		}
		rw.buf.Reset()
	}
}

func (rw *websocketResponseWriter) FlushWriter() resolve.FlushWriter {
	return rw
}

type subscriptionStorage struct {
	mu sync.Mutex
	// Key is the subsciption ID, value is the cancellation function for the subscription context.Context
	cancellations map[string]func()
}

func newSubscriptionStorage() *subscriptionStorage {
	return &subscriptionStorage{
		cancellations: make(map[string]func()),
	}
}

func (s *subscriptionStorage) Insert(id string, cancel func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancellations[id] = cancel
}

func (s *subscriptionStorage) Remove(id string) bool {
	s.mu.Lock()
	cancel := s.cancellations[id]
	delete(s.cancellations, id)
	s.mu.Unlock()
	// To simplify logic in the upper layers, we allow calling Remove()
	// multiple times with the same ID, so cancel might be nil
	if cancel != nil {
		cancel()
		return true
	}
	return false
}

func (s *subscriptionStorage) ForKeys(fn func(id string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k := range s.cancellations {
		fn(k)
	}
}

// TODO: Do we already have a type for this?
type graphqlError struct {
	Message string `json:"message"`
}

type WebSocketConnectionHandlerOptions struct {
	IDs            *globalIDStorage
	Parser         *OperationParser
	Planner        *OperationPlanner
	GraphQLHandler *GraphQLHandler
	Metrics        *RouterMetrics
	ResponseWriter http.ResponseWriter
	Request        *http.Request
	Connection     *wsConnectionWrapper
	Protocol       wsproto.Proto
	Logger         *zap.Logger
}

type WebSocketConnectionHandler struct {
	ctx            context.Context
	globalIDs      *globalIDStorage
	subscriptions  *subscriptionStorage
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
}

func NewWebsocketConnectionHandler(ctx context.Context, opts WebSocketConnectionHandlerOptions) *WebSocketConnectionHandler {
	return &WebSocketConnectionHandler{
		ctx:            ctx,
		globalIDs:      opts.IDs,
		subscriptions:  newSubscriptionStorage(),
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
	}
}

func (h *WebSocketConnectionHandler) requestError(err error) error {
	var wsErr *websocket.CloseError
	if errors.As(err, &wsErr) && wsErr.Code == websocket.CloseNormalClosure {
		// We closed the connection ourselves in response to an event, stopping
		// the event loop
		return nil
	}
	h.logger.Warn("handling websocket connection", zap.Error(err))
	return h.conn.WriteText(err.Error())
}

func (h *WebSocketConnectionHandler) writeErrorMessage(operationID string, err error) (int, error) {
	gqlErrors := []graphqlError{
		{Message: err.Error()},
	}
	payload, err := json.Marshal(gqlErrors)
	if err != nil {
		return 0, fmt.Errorf("encoding GraphQL errors: %w", err)
	}
	return h.protocol.GraphQLErrors(operationID, payload, nil)
}

func (h *WebSocketConnectionHandler) parseAndPlan(payload []byte) (*ParsedOperation, *operationContext, error) {
	operation, err := h.parser.Parse(h.ctx, h.clientInfo, payload, h.logger)
	if err != nil {
		return nil, nil, err
	}
	opContext, err := h.planner.Plan(operation, h.clientInfo, ParseRequestTraceOptions(h.r, false))
	if err != nil {
		return operation, nil, err
	}
	opContext.initialPayload = h.initialPayload
	return operation, opContext, nil
}

func (h *WebSocketConnectionHandler) executeSubscription(ctx context.Context, msg *wsproto.Message) error {
	// In GraphQL the statusCode does not always express the error state of the request
	// we use this flag to determine if we have an error and mark the metrics
	hasRequestError := false

	statusCode := http.StatusOK
	responseSize := 0

	metrics := h.metrics.StartOperation(h.clientInfo, h.logger, int64(len(msg.Payload)))
	defer func() {
		metrics.Finish(hasRequestError, statusCode, responseSize)
	}()

	// If the operation is invalid, send an error message immediately without
	// bothering to try to check if the ID is unique
	operation, opContext, err := h.parseAndPlan(msg.Payload)
	if err != nil {
		hasRequestError = true

		var inputErr InputError
		if errors.As(err, &inputErr) {
			statusCode = inputErr.StatusCode()
		} else {
			statusCode = http.StatusBadRequest
		}
		n, werr := h.writeErrorMessage(msg.ID, err)
		if werr != nil {
			h.logger.Warn("writing error message", zap.Error(werr))
		}
		responseSize = n
		return werr
	}

	metrics.AddOperationContext(opContext)

	commonAttributeValues := commonMetricAttributes(operation, OperationProtocolGraphQLWS)
	metrics.AddAttributes(commonAttributeValues...)

	initializeSpan(ctx, operation, opContext.clientInfo, commonAttributeValues)

	if !h.globalIDs.Insert(msg.ID) {
		hasRequestError = true
		return fmt.Errorf("4409: Subscriber for %s already exists", msg.ID)
	}
	defer h.globalIDs.Remove(msg.ID)

	cancellableCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	// This gets removed by WebSocketConnectionHandler.Complete()
	h.subscriptions.Insert(msg.ID, cancel)

	rw := newWebsocketResponseWriter(msg.ID, h.protocol, h.logger)
	defer h.Complete(rw)

	requestContext := buildRequestContext(rw, h.r, opContext, h.logger)
	ctxWithOperation := withOperationContext(cancellableCtx, opContext)
	r := h.r.WithContext(ctxWithOperation)

	r = r.WithContext(withRequestContext(r.Context(), requestContext))
	h.graphqlHandler.ServeHTTP(rw, r)

	// Evaluate the request status and written response
	// after the request has been handled by the engine
	responseSize = rw.writtenBytes
	hasRequestError = requestContext.hasError

	return nil
}

func (h *WebSocketConnectionHandler) handleSubscribe(msg *wsproto.Message) error {
	if msg.ID == "" {
		return fmt.Errorf("missing id in subscribe")
	}
	go h.executeSubscription(h.r.Context(), msg)
	return nil
}

func (h *WebSocketConnectionHandler) handleComplete(msg *wsproto.Message) error {
	if !h.subscriptions.Remove(msg.ID) {
		return h.requestError(fmt.Errorf("no subscription was registered for ID %q", msg.ID))
	}
	return nil
}

func (h *WebSocketConnectionHandler) handleConnectedMessage(msg *wsproto.Message) (stop bool, err error) {
	switch msg.Type {
	case wsproto.MessageTypePing:
		_, err := h.protocol.Pong(msg)
		return false, err
	case wsproto.MessageTypePong:
		// "Furthermore, the Pong message may even be sent unsolicited as a unidirectional heartbeat"
	case wsproto.MessageTypeSubscribe:
		return false, h.handleSubscribe(msg)
	case wsproto.MessageTypeComplete:
		return false, h.handleComplete(msg)
	}
	// "Receiving a message of a type or format which is not specified in this document will result in an immediate socket closure"
	return true, h.requestError(fmt.Errorf("unknown message type %q", msg.Type))
}

func (h *WebSocketConnectionHandler) Serve() {
	h.logger.Debug("websocket connection", zap.String("protocol", h.protocol.Subprotocol()))

	initialPayload, err := h.protocol.Initialize()
	if err != nil {
		h.requestError(fmt.Errorf("error initializing session: %w", err))
		return
	}
	h.initialPayload = initialPayload
	for {
		msg, err := h.protocol.ReadMessage()
		if err != nil {
			h.requestError(fmt.Errorf("error reading message: %w", err))
			return
		}
		stop, err := h.handleConnectedMessage(msg)
		if err != nil {
			h.requestError(fmt.Errorf("error handling message type %q: %w", msg.Type, err))
		}
		if stop {
			break
		}
	}
}

func (h *WebSocketConnectionHandler) Complete(rw *websocketResponseWriter) error {
	rw.Flush()
	if h.subscriptions.Remove(rw.id) {
		_, err := rw.protocol.Done(rw.id)
		return err
	}
	// If the subscription was already removed, we shouldn't send the complete back
	return nil
}

func (h *WebSocketConnectionHandler) Close() error {
	// Remove any pending IDs associated with this connection
	h.subscriptions.ForKeys(func(id string) {
		h.globalIDs.Remove(id)
	})
	return h.conn.Close()
}
