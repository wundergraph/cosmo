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
	"github.com/tidwall/sjson"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// See protocol at https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md

type wsMessageType string

const (
	wsMessageTypeConnectionInit = wsMessageType("connection_init")
	wsMessageTypeConnectionAck  = wsMessageType("connection_ack")
	wsMessageTypePing           = wsMessageType("ping")
	wsMessageTypePong           = wsMessageType("pong")
	wsMessageTypeSubscribe      = wsMessageType("subscribe")
	wsMessageTypeNext           = wsMessageType("next")
	wsMessageTypeError          = wsMessageType("error")
	wsMessageTypeComplete       = wsMessageType("complete")
)

type wsMessage struct {
	ID      string          `json:"id,omitempty"`
	Type    wsMessageType   `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type WebsocketMiddlewareOptions struct {
	Parser         *OperationParser
	GraphQLHandler *GraphQLHandler
	Metrics        *metric.Metrics
	Logger         *zap.Logger
}

func NewWebsocketMiddleware(ctx context.Context, opts WebsocketMiddlewareOptions) func(http.Handler) http.Handler {
	ids := newGlobalIDStorage()
	return func(next http.Handler) http.Handler {
		return &WebsocketHandler{
			ctx:            ctx,
			next:           next,
			ids:            ids,
			parser:         opts.Parser,
			graphqlHandler: opts.GraphQLHandler,
			metrics:        opts.Metrics,
			logger:         opts.Logger,
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

type WebsocketHandler struct {
	ctx            context.Context
	next           http.Handler
	ids            *globalIDStorage
	parser         *OperationParser
	graphqlHandler *GraphQLHandler
	metrics        *metric.Metrics
	logger         *zap.Logger
}

func (h *WebsocketHandler) requestLooksLikeWebsocket(r *http.Request) bool {
	return r.Header.Get("Upgrade") == "websocket"
}

func (h *WebsocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Don't call upgrader.Upgrade unless the request looks like a websocket
	// because if Upgrade() fails it sends an error response
	if h.requestLooksLikeWebsocket(r) {
		upgrader := websocket.Upgrader{
			HandshakeTimeout: 5 * time.Second,
			// TODO: WriteBufferPool,
			EnableCompression: true,
			Subprotocols:      []string{"graphql-transport-ws"},
		}
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			// Upgrade() sends an error response already, just log the error
			h.logger.Warn("upgrading websocket", zap.Error(err))
			return
		}
		connectionHandler := NewWebsocketConnectionHandler(h.ctx, WebSocketConnectionHandlerOptions{
			IDs:            h.ids,
			Parser:         h.parser,
			GraphQLHandler: h.graphqlHandler,
			Metrics:        h.metrics,
			ResponseWriter: w,
			Request:        r,
			Connection:     c,
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
	conn         *websocket.Conn
	header       http.Header
	buf          bytes.Buffer
	writtenBytes int
	logger       *zap.Logger
}

var _ http.ResponseWriter = (*websocketResponseWriter)(nil)
var _ resolve.FlushWriter = (*websocketResponseWriter)(nil)

func newWebsocketResponseWriter(id string, conn *websocket.Conn, logger *zap.Logger) *websocketResponseWriter {
	return &websocketResponseWriter{
		id:     id,
		conn:   conn,
		header: make(http.Header),
		logger: logger.With(zap.String("subscription_id", id)),
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
		var msg *wsMessage
		// Check if the result is an error
		result := gjson.GetBytes(payload, "errors")
		if result.Type == gjson.JSON {
			msg = &wsMessage{
				ID:      rw.id,
				Type:    wsMessageTypeError,
				Payload: json.RawMessage(result.Raw),
			}
		} else {
			msg = &wsMessage{
				ID:      rw.id,
				Type:    wsMessageTypeNext,
				Payload: payload,
			}
		}
		if len(rw.header) > 0 {
			headers, err := json.Marshal(rw.header)
			if err != nil {
				rw.logger.Warn("serializing response headers", zap.Error(err))
			} else {
				msg.Payload, err = sjson.SetBytes(msg.Payload, "extensions.response_headers", headers)
				if err != nil {
					rw.logger.Warn("setting response_headers", zap.Error(err))
				}
			}
		}
		if err := rw.conn.WriteJSON(&msg); err != nil {
			rw.logger.Warn("writing JSON on websocket flush", zap.Error(err))
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
	GraphQLHandler *GraphQLHandler
	Metrics        *metric.Metrics
	ResponseWriter http.ResponseWriter
	Request        *http.Request
	Connection     *websocket.Conn
	Logger         *zap.Logger
}

type WebSocketConnectionHandler struct {
	ctx            context.Context
	globalIDs      *globalIDStorage
	subscriptions  *subscriptionStorage
	parser         *OperationParser
	graphqlHandler *GraphQLHandler
	metrics        *metric.Metrics
	w              http.ResponseWriter
	r              *http.Request
	conn           *websocket.Conn
	clientInfo     *ClientInfo
	logger         *zap.Logger
}

func NewWebsocketConnectionHandler(ctx context.Context, opts WebSocketConnectionHandlerOptions) *WebSocketConnectionHandler {
	return &WebSocketConnectionHandler{
		ctx:            ctx,
		globalIDs:      opts.IDs,
		subscriptions:  newSubscriptionStorage(),
		parser:         opts.Parser,
		graphqlHandler: opts.GraphQLHandler,
		metrics:        opts.Metrics,
		w:              opts.ResponseWriter,
		r:              opts.Request,
		conn:           opts.Connection,
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
	return h.conn.WriteMessage(websocket.TextMessage, []byte(err.Error()))
}

func (h *WebSocketConnectionHandler) writeErrorMessage(operationID string, err error) (int, error) {
	errors := []graphqlError{
		{Message: err.Error()},
	}
	payload, err := json.Marshal(errors)
	if err != nil {
		return 0, fmt.Errorf("encoding GraphQL errors: %w", err)
	}
	return h.writeJSON(wsMessage{ID: operationID, Type: wsMessageTypeError, Payload: payload})
}

func (h *WebSocketConnectionHandler) readJSON(v interface{}) error {
	ech := make(chan error, 1)
	go func() {
		ech <- h.conn.ReadJSON(v)
	}()
	select {
	case <-h.ctx.Done():
		h.Close()
		return h.ctx.Err()
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

func (h *WebSocketConnectionHandler) writeJSON(v interface{}) (int, error) {

	w, err := h.conn.NextWriter(websocket.TextMessage)
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

func (h *WebSocketConnectionHandler) sessionInit() error {
	var msg wsMessage
	// First message must be a connection_init
	if err := h.readJSON(&msg); err != nil {
		return fmt.Errorf("error reading connection_init: %w", err)
	}
	if msg.Type != wsMessageTypeConnectionInit {
		return fmt.Errorf("connections should start with %s, got %s", wsMessageTypeConnectionInit, msg.Type)
	}
	if err := h.conn.WriteJSON(wsMessage{Type: wsMessageTypeConnectionAck}); err != nil {
		return fmt.Errorf("sending %s: %w", wsMessageTypeConnectionAck, err)
	}
	return nil
}

func (h *WebSocketConnectionHandler) executeSubscription(ctx context.Context, msg *wsMessage) error {
	var metrics *OperationMetrics

	statusCode := http.StatusOK
	responseSize := int64(0)

	if h.metrics != nil {
		metrics = StartOperationMetrics(ctx, h.metrics, int64(len(msg.Payload)))
		metrics.AddClientInfo(ctx, h.clientInfo)

		defer func() {
			metrics.Finish(ctx, statusCode, responseSize)
		}()
	}

	// If the operation is invalid, send an error message immediately without
	// bothering to try to check if the ID is unique
	operation, err := h.parser.Parse(msg.Payload)
	if err != nil {
		statusCode = http.StatusBadRequest
		n, werr := h.writeErrorMessage(msg.ID, err)
		if werr != nil {
			h.logger.Warn("writing error message", zap.Error(werr))
		}
		responseSize = int64(n)
		return werr
	}

	if metrics != nil {
		metrics.AddOperation(ctx, operation, OperationProtocolGraphQLWS)
	}

	if !h.globalIDs.Insert(msg.ID) {
		return fmt.Errorf("4409: Subscriber for %s already exists", msg.ID)
	}
	defer h.globalIDs.Remove(msg.ID)

	cancellableCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	// This gets removed by WebSocketConnectionHandler.Complete()
	h.subscriptions.Insert(msg.ID, cancel)

	ctxWithOperation := withOperationContext(cancellableCtx, operation, h.clientInfo)
	r := h.r.WithContext(ctxWithOperation)
	rw := newWebsocketResponseWriter(msg.ID, h.conn, h.logger)
	defer h.Complete(rw)
	r = requestWithAttachedContext(rw, r, h.logger)
	h.graphqlHandler.ServeHTTP(rw, r)
	responseSize = int64(rw.writtenBytes)
	return nil
}

func (h *WebSocketConnectionHandler) handleSubscribe(msg *wsMessage) error {
	if msg.ID == "" {
		return fmt.Errorf("missing id in %s", wsMessageTypeSubscribe)
	}
	go h.executeSubscription(h.r.Context(), msg)
	return nil
}

func (h *WebSocketConnectionHandler) handleComplete(msg *wsMessage) error {
	if !h.subscriptions.Remove(msg.ID) {
		return h.requestError(fmt.Errorf("no subscription was registered for ID %q", msg.ID))
	}
	return nil
}

func (h *WebSocketConnectionHandler) handleConnectedMessage(msg *wsMessage) (stop bool, err error) {
	switch msg.Type {
	case wsMessageTypePing:
		return false, h.conn.WriteJSON(wsMessage{Type: wsMessageTypePong})
	case wsMessageTypePong:
		// "Furthermore, the Pong message may even be sent unsolicited as an unidirectional heartbeat"
	case wsMessageTypeSubscribe:
		return false, h.handleSubscribe(msg)
	case wsMessageTypeComplete:
		return false, h.handleComplete(msg)
	}
	// "Receiving a message of a type or format which is not specified in this document will result in an immediate socket closure"
	return true, h.requestError(fmt.Errorf("4400: unknown message type %q", msg.Type))
}

func (h *WebSocketConnectionHandler) Serve() {
	h.logger.Debug("websocket connection", zap.String("remote_addr", h.conn.RemoteAddr().String()))

	if err := h.sessionInit(); err != nil {
		h.requestError(fmt.Errorf("error initializing session: %w", err))
		return
	}
	var msg wsMessage
	for {
		if err := h.readJSON(&msg); err != nil {
			h.requestError(fmt.Errorf("error decoding message: %w", err))
			return
		}
		stop, err := h.handleConnectedMessage(&msg)
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
		msg := wsMessage{
			ID:   rw.id,
			Type: wsMessageTypeComplete,
		}
		return rw.conn.WriteJSON(&msg)
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
