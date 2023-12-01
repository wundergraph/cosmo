package wsproto

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Proto interface {
	Subprotocol() string
	// Initialize starts the protocol and returns the initial payload received from the client
	Initialize() (json.RawMessage, error)
	ReadMessage() (*Message, error)

	Pong(*Message) (int, error)
	GraphQLData(id string, data json.RawMessage, extensions json.RawMessage) (int, error)
	GraphQLErrors(id string, errors json.RawMessage, extensions json.RawMessage) (int, error)
	// Done is sent to indicate the requested operation is done and no more results will come in
	Done(id string) (int, error)
}

type JSONConn interface {
	ReadJSON(v interface{}) error
	WriteJSON(v interface{}) (int, error)
}

// MessageType indicates the type of the message received from the client
type MessageType int

const (
	MessageTypePing MessageType = iota + 1
	MessageTypePong
	MessageTypeSubscribe
	MessageTypeComplete
)

type Message struct {
	ID      string
	Type    MessageType
	Payload json.RawMessage
}

func Subprotocols() []string {
	return []string{
		graphQLWSSubprotocol,
		subscriptionsTransportWSSubprotocol,
	}
}

func NewProtocol(subprotocol string, conn JSONConn) (Proto, error) {
	switch subprotocol {
	case graphQLWSSubprotocol:
		return newGraphQLWSProtocol(conn), nil
	case subscriptionsTransportWSSubprotocol:
		return newSubscriptionsTransportWSProtocol(conn), nil
	}
	return nil, fmt.Errorf("could not find a suitable websocket subprotocol, supported ones are: %s", strings.Join(Subprotocols(), ", "))
}
