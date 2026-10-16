package datasource

import (
	"errors"
	"fmt"

	"google.golang.org/protobuf/proto"

	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
)

var errCursorPositionMissing = errors.New("cursor has no position")

// MarshalCursor serializes a cursor into the payload of the cursor wire format.
// The same cursor always produces the same bytes.
func MarshalCursor(c *streamsv1.Cursor) ([]byte, error) {
	if c.GetPosition() == nil {
		return nil, errCursorPositionMissing
	}
	// Deterministic sorts map keys, which protobuf otherwise writes in random order.
	return proto.MarshalOptions{Deterministic: true}.Marshal(c)
}

// UnmarshalCursor deserializes the payload of the cursor wire format.
// A cursor without a position, e.g. one carrying a position of a provider type
// unknown to this router, is rejected.
func UnmarshalCursor(data []byte) (*streamsv1.Cursor, error) {
	c := &streamsv1.Cursor{}
	if err := proto.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("unmarshaling cursor: %w", err)
	}
	if c.GetPosition() == nil {
		return nil, errCursorPositionMissing
	}
	return c, nil
}
