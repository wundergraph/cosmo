package core

import (
	"bytes"
	"context"
	"net/http"
	"unicode/utf8"

	"github.com/gobwas/ws"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

// WebSocketConnectionInitHandler is implemented by modules that keep track of WebSocket connections, for example to
// close a connection when the credentials it was authenticated with expire or are revoked. The router calls
// OnWebSocketConnectionInit once for each connection, after the connection has been initialized and authenticated and
// before any of its operations is read. A non-nil error closes the connection with the close code 4403 (Forbidden).
type WebSocketConnectionInitHandler interface {
	OnWebSocketConnectionInit(ctx WebSocketConnectionInitHandlerContext) error
}

// WebSocketConnectionInitHandlerContext describes a WebSocket connection that has just been initialized.
type WebSocketConnectionInitHandlerContext interface {
	// Request is a copy of the connection's upgrade request, which the module may keep. Its context ends once the
	// upgrade has been handled; Connection().Context() follows the connection itself.
	Request() *http.Request
	// Logger is the connection's logger.
	Logger() *zap.Logger
	// Authentication is the connection's authentication, or nil when the connection is not authenticated.
	Authentication() authentication.Authentication
	// InitialPayload is a copy of the payload of the client's connection_init message, or nil when it had none.
	InitialPayload() []byte
	// Connection is the connection, which the module may close at any later time.
	Connection() WebSocketConnection
}

// WebSocketConnection is an open WebSocket connection that a module can close.
type WebSocketConnection interface {
	// Close closes the connection with a close code and reason, and the router then ends the connection's
	// subscriptions as it does when a client disconnects. The code is 1000 for a normal closure, or a code from 3000
	// to 4999, the ranges RFC 6455 leaves to libraries, frameworks and applications; any other code is sent as 1008
	// (policy violation). A reason longer than the 123 bytes a close frame holds is cut short between characters.
	// Close may be called from any goroutine, at any time and more than once: only the first call has an effect, and a
	// call after the connection has closed does nothing.
	Close(code int, reason string)
	// Context ends once the connection has closed, for whatever reason. A module can forget the connection then with
	// context.AfterFunc, which keeps no goroutine waiting for each connection.
	Context() context.Context
}

type webSocketConnectionInitHandlerContext struct {
	request        *http.Request
	logger         *zap.Logger
	authentication authentication.Authentication
	initialPayload []byte
	connection     WebSocketConnection
}

func newWebSocketConnectionInitHandlerContext(handler *WebSocketConnectionHandler, logger *zap.Logger) *webSocketConnectionInitHandlerContext {
	return &webSocketConnectionInitHandlerContext{
		request:        handler.request.Clone(handler.request.Context()),
		logger:         logger,
		authentication: authentication.FromContext(handler.request.Context()),
		initialPayload: bytes.Clone(handler.initialPayload),
		connection:     &webSocketModuleConnection{handler: handler},
	}
}

func (c *webSocketConnectionInitHandlerContext) Request() *http.Request {
	return c.request
}

func (c *webSocketConnectionInitHandlerContext) Logger() *zap.Logger {
	return c.logger
}

func (c *webSocketConnectionInitHandlerContext) Authentication() authentication.Authentication {
	return c.authentication
}

func (c *webSocketConnectionInitHandlerContext) InitialPayload() []byte {
	return c.initialPayload
}

func (c *webSocketConnectionInitHandlerContext) Connection() WebSocketConnection {
	return c.connection
}

// webSocketModuleConnection is a module's handle on a connection.
type webSocketModuleConnection struct {
	handler *WebSocketConnectionHandler
}

// maxCloseReasonBytes is the longest reason a close frame holds: its 125-byte payload less the 2-byte code.
const maxCloseReasonBytes = 123

func (c *webSocketModuleConnection) Close(code int, reason string) {
	status := ws.StatusCode(code)
	if code < 0 || code > 4999 || (status != ws.StatusNormalClosure && !status.IsApplicationSpec() && !status.IsPrivateSpec()) {
		status = ws.StatusPolicyViolation
	}
	if len(reason) > maxCloseReasonBytes {
		end := maxCloseReasonBytes
		for end > 0 && !utf8.RuneStart(reason[end]) {
			end--
		}
		reason = reason[:end]
	}
	c.handler.requestClose(wsproto.CloseKind{Code: status, Reason: reason})
}

func (c *webSocketModuleConnection) Context() context.Context {
	return c.handler.closed
}
