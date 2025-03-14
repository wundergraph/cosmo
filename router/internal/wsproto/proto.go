package wsproto

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	writeWait = 10 * time.Second
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
}

type JSONConn interface {
	ReadJSON(v interface{}) error
	WriteJSON(v interface{}) error
	SetReadDeadline(t time.Time) error
	SetWriteDeadline(t time.Time) error
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

func NewProtocol(subProtocol string, conn JSONConn, readTimeout time.Duration) (Proto, error) {
	switch subProtocol {
	case GraphQLWSSubprotocol:
		return newGraphQLWSProtocol(conn, readTimeout, writeWait), nil
	case SubscriptionsTransportWSSubprotocol:
		return newSubscriptionsTransportWSProtocol(conn, readTimeout, writeWait), nil
	case AbsintheWSSubProtocol:
		return newAbsintheWSProtocol(conn, readTimeout, writeWait), nil
	}
	return nil, fmt.Errorf("could not find a suitable websocket subprotocol, supported ones are: %s", strings.Join(Subprotocols(), ", "))
}
