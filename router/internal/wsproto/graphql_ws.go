package wsproto

import (
	"encoding/json"
	"fmt"

	"github.com/gobwas/ws"
)

// See protocol at https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md

type graphQLWSMessageType string

const (
	graphQLWSMessageTypeConnectionInit = graphQLWSMessageType("connection_init")
	graphQLWSMessageTypeConnectionAck  = graphQLWSMessageType("connection_ack")
	graphQLWSMessageTypePing           = graphQLWSMessageType("ping")
	graphQLWSMessageTypePong           = graphQLWSMessageType("pong")
	graphQLWSMessageTypeSubscribe      = graphQLWSMessageType("subscribe")
	graphQLWSMessageTypeNext           = graphQLWSMessageType("next")
	graphQLWSMessageTypeError          = graphQLWSMessageType("error")
	graphQLWSMessageTypeComplete       = graphQLWSMessageType("complete")

	// This might seem confusing, but the protocol is called graphql-ws and uses "graphql-transport-ws" as subprotocol
	GraphQLWSSubprotocol = "graphql-transport-ws"
)

var _ Proto = (*graphQLWSProtocol)(nil)

type graphQLWSMessage struct {
	ID         string               `json:"id,omitempty"`
	Type       graphQLWSMessageType `json:"type"`
	Payload    json.RawMessage      `json:"payload,omitempty"`
	Extensions json.RawMessage      `json:"extensions,omitempty"`
}

type graphQLWSProtocol struct {
	conn ProtoConn
}

func newGraphQLWSProtocol(conn ProtoConn) *graphQLWSProtocol {
	return &graphQLWSProtocol{
		conn: conn,
	}
}

func (p *graphQLWSProtocol) Subprotocol() string {
	return GraphQLWSSubprotocol
}

func (p *graphQLWSProtocol) Initialize() (json.RawMessage, error) {
	// First message must be a connection_init
	var msg graphQLWSMessage
	if err := p.conn.ReadJSON(&msg); err != nil {
		return nil, fmt.Errorf("error reading connection_init: %w", err)
	}
	if msg.Type != graphQLWSMessageTypeConnectionInit {
		return nil, fmt.Errorf("first message should be %s, got %s", graphQLWSMessageTypeConnectionInit, msg.Type)
	}
	if err := p.conn.WriteJSON(graphQLWSMessage{Type: graphQLWSMessageTypeConnectionAck}); err != nil {
		return nil, fmt.Errorf("sending %s: %w", graphQLWSMessageTypeConnectionAck, err)
	}
	return msg.Payload, nil
}

func (p *graphQLWSProtocol) ReadMessage() (*Message, error) {
	var msg graphQLWSMessage
	if err := p.conn.ReadJSON(&msg); err != nil {
		return nil, err
	}
	var messageType MessageType
	switch msg.Type {
	case graphQLWSMessageTypePing:
		messageType = MessageTypePing
	case graphQLWSMessageTypePong:
		messageType = MessageTypePong
	case graphQLWSMessageTypeSubscribe:
		messageType = MessageTypeSubscribe
	case graphQLWSMessageTypeComplete:
		messageType = MessageTypeComplete
	default:
		return nil, fmt.Errorf("unsupported message type %s", msg.Type)
	}

	return &Message{
		ID:      msg.ID,
		Type:    messageType,
		Payload: msg.Payload,
	}, nil
}

func (p *graphQLWSProtocol) Pong(msg *Message) error {
	return p.conn.WriteJSON(
		graphQLWSMessage{
			ID:      msg.ID,
			Type:    graphQLWSMessageTypePong,
			Payload: msg.Payload,
		})
}

func (p *graphQLWSProtocol) WriteGraphQLData(id string, data json.RawMessage, extensions json.RawMessage) error {
	return p.conn.WriteJSON(graphQLWSMessage{
		ID:         id,
		Type:       graphQLWSMessageTypeNext,
		Payload:    data,
		Extensions: extensions,
	})
}

func (p *graphQLWSProtocol) WriteGraphQLErrors(id string, errors json.RawMessage, extensions json.RawMessage) error {
	return p.conn.WriteJSON(graphQLWSMessage{
		ID:         id,
		Type:       graphQLWSMessageTypeError,
		Payload:    errors,
		Extensions: extensions,
	})
}

func (p *graphQLWSProtocol) Close(code ws.StatusCode, reason string) error {
	if err := p.conn.WriteCloseFrame(code, reason); err != nil {
		return err
	}

	return nil
}

func (p *graphQLWSProtocol) Complete(id string) error {
	return p.conn.WriteJSON(
		graphQLWSMessage{ID: id, Type: graphQLWSMessageTypeComplete},
	)
}
