package wsproto

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gobwas/ws"
)

type Proto interface {
	Subprotocol() string
	// Initialize starts the protocol and returns the initial payload received from the client
	Initialize() (json.RawMessage, error)
	ReadMessage() (*Message, error)

	Pong(*Message) error
	WriteGraphQLData(id string, data json.RawMessage, extensions json.RawMessage) error
	WriteGraphQLErrors(id string, errors json.RawMessage, extensions json.RawMessage) error

	// Done is sent to indicate the requested operation is done and no more results will come in
	Done(id string) error

	// Close closes the connection with a close frame indicating a downstream error
	Close() error
}

type ProtoConn interface {
	ReadJSON(v any) error
	WriteJSON(v any) error
	WriteCloseFrame(code ws.StatusCode, reason string) error
	Close() error
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
	for _, s := range Subprotocols() {
		if s == subProtocol {
			return true
		}
	}
	return false
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
