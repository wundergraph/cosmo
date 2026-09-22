package datasource

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
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

// MarshalCursor serializes a Cursor to its wire representation.
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
