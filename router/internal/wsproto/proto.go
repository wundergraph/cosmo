package wsproto

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/gobwas/ws"
)

type Proto interface {
	Subprotocol() string
	// Initialize starts the protocol and returns the initial payload received from the client.
	// On a protocol-level rejection (bad first message, etc.) it returns a *CloseError carrying
	// the close code and reason. The transport-layer caller writes the close frame.
	Initialize() (json.RawMessage, error)
	// ReadMessage reads the next message from the client. On a protocol-level rejection
	// (duplicate connection_init, unknown message type, etc.) it returns a *CloseError; the
	// transport-layer caller writes the close frame.
	ReadMessage() (*Message, error)

	Pong(*Message) error
	WriteGraphQLData(id string, data json.RawMessage, extensions json.RawMessage) error
	WriteGraphQLErrors(id string, errors json.RawMessage, extensions json.RawMessage) error

	// Complete is sent to indicate the requested operation is done and no more results will come in
	Complete(id string) error
}

type ProtoConn interface {
	ReadJSON(v any) error
	WriteJSON(v any) error
	WriteCloseFrame(code ws.StatusCode, reason string) error
}

// CloseKind is the WebSocket close code and reason sent to the downstream client
// when the connection handler tears down. Connection-level concern — never sent
// from the resolver.
type CloseKind struct {
	Code   ws.StatusCode
	Reason string
}

var (
	CloseKindNormal             = CloseKind{Code: ws.StatusNormalClosure, Reason: "Normal closure"}
	CloseKindGoingAway          = CloseKind{Code: ws.StatusGoingAway, Reason: "Going away"}
	CloseKindUnauthorized       = CloseKind{Code: 4401, Reason: "Unauthorized"}
	CloseKindTooManyInits       = CloseKind{Code: 4429, Reason: "Too many initialisation requests"}
	CloseKindInvalidMessageType = CloseKind{Code: 4400, Reason: "Invalid message type"}
)

// CloseError signals that the protocol layer (or a downstream handler) wants the
// connection torn down with a specific close kind. The protocol layer does not
// write the close frame itself — it returns this error so the transport-layer
// message loop owns the single Close call. Unwraps to the underlying cause for
// log/debug purposes.
type CloseError struct {
	Err  error
	Kind CloseKind
}

func (e *CloseError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Kind.Reason
}

func (e *CloseError) Unwrap() error { return e.Err }

// CloseKindOf returns the close kind to use when tearing down a connection
// after err. Errors that wrap a *CloseError carry their own kind; everything
// else (network read failure, JSON decode error, etc.) falls back to
// CloseKindNormal.
func CloseKindOf(err error) CloseKind {
	var ce *CloseError
	if errors.As(err, &ce) {
		return ce.Kind
	}
	return CloseKindNormal
}

// MessageType indicates the type of the message received from the client
type MessageType int

const (
	MessageTypePing MessageType = iota + 1
	MessageTypePong
	MessageTypeSubscribe
	MessageTypeComplete
	MessageTypeTerminate
)

type Message struct {
	ID      string
	Type    MessageType
	Payload json.RawMessage
}

func Subprotocols() []string {
	return []string{
		GraphQLWSSubprotocol,
		SubscriptionsTransportWSSubprotocol,
		AbsintheWSSubProtocol,
	}
}

func IsSupportedSubprotocol(subProtocol string) bool {
	return slices.Contains(Subprotocols(), subProtocol)
}

func NewProtocol(subProtocol string, conn ProtoConn) (Proto, error) {
	switch subProtocol {
	case GraphQLWSSubprotocol:
		return newGraphQLWSProtocol(conn), nil
	case SubscriptionsTransportWSSubprotocol:
		return newSubscriptionsTransportWSProtocol(conn), nil
	case AbsintheWSSubProtocol:
		return newAbsintheWSProtocol(conn), nil
	}
	return nil, fmt.Errorf("could not find a suitable websocket subprotocol, supported ones are: %s", strings.Join(Subprotocols(), ", "))
}
