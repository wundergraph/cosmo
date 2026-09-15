package datasource

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// Cursor is the provider-agnostic envelope for an opaque resume cursor. It is
// serialized as base64url(json) and handed to the client in the response
// extensions of every event, and accepted back from the client on reconnect.
type Cursor struct {
	ProviderType ProviderType    `json:"providerType"`
	ProviderID   string          `json:"providerId"`
	IssuedAt     int64           `json:"issuedAt"`
	Position     json.RawMessage `json:"position"`
}

// EncodeCursor serializes a Cursor to its wire representation.
func EncodeCursor(c Cursor) (string, error) {
	data, err := json.Marshal(c)
	if err != nil {
		return "", fmt.Errorf("marshal cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

// DecodeCursor parses the wire representation of a Cursor.
func DecodeCursor(s string) (Cursor, error) {
	var c Cursor
	data, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return c, fmt.Errorf("decode cursor: %w", err)
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return c, fmt.Errorf("unmarshal cursor: %w", err)
	}
	return c, nil
}

// CursorStreamEvent is implemented by stream events that carry a resume cursor.
type CursorStreamEvent interface {
	Cursor() string
}

// updateWithCursor sends event data to the subscription updater, attaching the
// event's resume cursor when both the event carries one and the updater
// supports cursor-aware delivery. Falls back to the plain Update otherwise.
func updateWithCursor(eventUpdater resolve.SubscriptionUpdater, event StreamEvent) {
	cursor := eventCursor(event)
	if cursor == "" {
		eventUpdater.Update(event.GetData())
		return
	}
	cursorUpdater, ok := eventUpdater.(resolve.CursorSubscriptionUpdater)
	if !ok {
		eventUpdater.Update(event.GetData())
		return
	}
	cursorUpdater.UpdateWithCursor(event.GetData(), cursor)
}

// updateSubscriptionWithCursor is the single-subscription counterpart of updateWithCursor.
func updateSubscriptionWithCursor(eventUpdater resolve.SubscriptionUpdater, subID resolve.SubscriptionIdentifier, event StreamEvent) {
	cursor := eventCursor(event)
	if cursor == "" {
		eventUpdater.UpdateSubscription(subID, event.GetData())
		return
	}
	cursorUpdater, ok := eventUpdater.(resolve.CursorSubscriptionUpdater)
	if !ok {
		eventUpdater.UpdateSubscription(subID, event.GetData())
		return
	}
	cursorUpdater.UpdateSubscriptionWithCursor(subID, event.GetData(), cursor)
}

func eventCursor(event StreamEvent) string {
	cursorEvent, ok := event.(CursorStreamEvent)
	if !ok {
		return ""
	}
	return cursorEvent.Cursor()
}
