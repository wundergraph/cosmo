package datasource

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// Cursor is provider-agnostic position information for subscription messages. It is
// handed to the client in the response extensions of every event,
// and accepted back from the client on reconnect.
type Cursor struct {
	// The message broker type like "kafka" or "nats-jetstream".
	ProviderType ProviderType `json:"providerType"`

	// The provider id as specified in the router config.
	ProviderID string `json:"providerId"`

	// Unix timestamp of the creation date of this cursor.
	IssuedAt int64 `json:"issuedAt"`

	// The actual message position in the broker encoded as json. The format is provider-agnostic.
	Position json.RawMessage `json:"position"`
}

// MarshalCursor serializes a Cursor to its wire representation (base64 encoded json).
func MarshalCursor(c Cursor) (string, error) {
	data, err := json.Marshal(c)
	if err != nil {
		return "", fmt.Errorf("marshal cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

// UnmarshalCursor parses the wire representation of a Cursor.
func UnmarshalCursor(s string) (Cursor, error) {
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
