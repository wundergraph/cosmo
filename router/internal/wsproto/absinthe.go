package wsproto

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/gobwas/ws"
	"github.com/tidwall/sjson"
)

type absintheMessageEventType string

const (
	absintheMessageEventTypeJoin             = absintheMessageEventType("phx_join")
	absintheMessageEventTypeDoc              = absintheMessageEventType("doc")
	absintheMessageEventTypeReply            = absintheMessageEventType("phx_reply")
	absintheMessageEventTypeLeave            = absintheMessageEventType("phx_leave")
	absintheMessageEventTypeHeartbeat        = absintheMessageEventType("heartbeat")
	absintheMessageEventTypeSubscriptionData = absintheMessageEventType("subscription:data")

	AbsintheWSSubProtocol = "absinthe"
)

var (
	absintheOKPayload    = json.RawMessage(`{"status":"ok","response":{}}`)
	absintheErrorPayload = json.RawMessage(`{"status":"error","response":{}}`)
)

// ["1","1","__absinthe__:control","phx_join",{}]
type absintheMessage struct {
	ID       *string
	Channel  string
	Protocol string
	Type     absintheMessageEventType
	Payload  json.RawMessage
}

func (r absintheMessage) MarshalJSON() ([]byte, error) {
	out := []interface{}{r.ID, r.Channel, r.Protocol, r.Type, r.Payload}
	return json.Marshal(out)
}

func (r *absintheMessage) UnmarshalJSON(data []byte) error {
	incoming := []*json.RawMessage{}

	if err := json.Unmarshal(data, &incoming); err != nil {
		return err
	}

	if len(incoming) != 5 {
		return fmt.Errorf("expected 5 elements, got %d", len(incoming))
	}

	if rawID := incoming[0]; rawID != nil {
		err := json.Unmarshal(*rawID, &r.ID)
		if err != nil {
			return err
		}
	}

	if incoming[1] == nil {
		return fmt.Errorf("`channel` cannot be nil")
	}

	if err := json.Unmarshal(*incoming[1], &r.Channel); err != nil {
		return err
	}

	if incoming[2] == nil {
		return fmt.Errorf("`protocol` cannot be nil")
	}

	if err := json.Unmarshal(*incoming[2], &r.Protocol); err != nil {
		return err
	}

	if incoming[3] == nil {
		return fmt.Errorf("`type` cannot be nil")
	}

	if err := json.Unmarshal(*incoming[3], &r.Type); err != nil {
		return err
	}

	if incoming[4] == nil {
		return fmt.Errorf("`query` cannot be nil")
	}

	r.Payload = *incoming[4]

	return nil
}

var _ Proto = (*absintheWSProtocol)(nil)

type absintheWSProtocol struct {
	conn ProtoConn
}

func newAbsintheWSProtocol(conn ProtoConn) *absintheWSProtocol {
	return &absintheWSProtocol{
		conn: conn,
	}
}

func (p *absintheWSProtocol) Subprotocol() string {
	return GraphQLWSSubprotocol
}

func (p *absintheWSProtocol) Initialize() (json.RawMessage, error) {
	var msg absintheMessage
	if err := p.conn.ReadJSON(&msg); err != nil {
		return nil, fmt.Errorf("error reading phx_join: %w", err)
	}
	if msg.Type != absintheMessageEventTypeJoin {
		return nil, fmt.Errorf("first message should be %s, got %s", absintheMessageEventTypeJoin, msg.Type)
	}
	if err := p.conn.WriteJSON(absintheMessage{
		ID:       msg.ID,
		Channel:  msg.Channel,
		Protocol: "__absinthe__:control",
		Type:     absintheMessageEventTypeReply,
		Payload:  absintheOKPayload,
	}); err != nil {
		return nil, fmt.Errorf("sending %s: for join %w", absintheMessageEventTypeReply, err)
	}
	return msg.Payload, nil
}

func (p *absintheWSProtocol) ReadMessage() (*Message, error) {
	var msg absintheMessage
	if err := p.conn.ReadJSON(&msg); err != nil {
		return nil, err
	}

	id := ""
	if msg.ID != nil {
		id = *msg.ID
	}
	var messageType MessageType
	switch msg.Type {
	case absintheMessageEventTypeHeartbeat:
		messageType = MessageTypePing
	case absintheMessageEventTypeDoc:
		messageType = MessageTypeSubscribe
		if err := p.conn.WriteJSON(absintheMessage{
			ID:       msg.ID,
			Channel:  msg.Channel,
			Protocol: "__absinthe__:control",
			Type:     "phx_reply",
			Payload:  json.RawMessage(fmt.Sprintf(`{"status":"ok", "response": {"subscriptionId": %q}}`, toSubscriptionId(&id))),
		}); err != nil {
			return nil, fmt.Errorf("sending phx_reply for subscribe: %w", err)
		}
	case absintheMessageEventTypeLeave:
		messageType = MessageTypeComplete
	default:
		return nil, fmt.Errorf("unsupported message type %s", msg.Type)
	}
	return &Message{
		ID:      id,
		Type:    messageType,
		Payload: msg.Payload,
	}, nil
}

func (p *absintheWSProtocol) Pong(msg *Message) error {
	return p.conn.WriteJSON(absintheMessage{
		ID:       &msg.ID,
		Channel:  "",
		Protocol: "phoenix",
		Type:     absintheMessageEventTypeReply,
		Payload:  absintheOKPayload,
	})
}

func (p *absintheWSProtocol) WriteGraphQLData(id string, data json.RawMessage, extensions json.RawMessage) error {
	payload, err := sjson.SetBytes(nil, "result", data)
	if err != nil {
		return err
	}
	payload, err = sjson.SetBytes(payload, "subscriptionId", toSubscriptionId(&id))
	if err != nil {
		return err
	}
	return p.conn.WriteJSON(absintheMessage{
		ID:       &id,
		Channel:  "1",
		Protocol: "__absinthe__:control",
		Type:     absintheMessageEventTypeSubscriptionData,
		Payload:  payload,
	})
}

func (p *absintheWSProtocol) WriteGraphQLErrors(id string, errors json.RawMessage, extensions json.RawMessage) error {
	return p.conn.WriteJSON(absintheMessage{
		ID:       &id,
		Channel:  "1",
		Protocol: "__absinthe__:control",
		Type:     absintheMessageEventTypeReply,
		Payload:  absintheErrorPayload,
	})
}

func (p *absintheWSProtocol) Close(code ws.StatusCode, reason string) error {
	if err := p.conn.WriteCloseFrame(code, reason); err != nil {
		return err
	}

	return nil
}

func (p *absintheWSProtocol) Complete(id string) error {
	return p.conn.WriteJSON(absintheMessage{
		ID:       &id,
		Protocol: "__absinthe__:control",
		Type:     absintheMessageEventTypeReply,
		Payload:  json.RawMessage(fmt.Sprintf(`{"status":"ok", "response": {"subscriptionId": %q}}`, toSubscriptionId(&id))),
	})
}

func toSubscriptionId(id *string) string {
	h := sha256.New()
	h.Write([]byte(*id))
	operationId := new(big.Int).SetBytes(h.Sum(nil))
	return fmt.Sprintf("__absinthe__:doc:%s:%s", *id, operationId)
}
