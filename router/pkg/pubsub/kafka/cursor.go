package kafka

import (
	"encoding/json"
)

// cursorPosition maps topic -> partition -> last delivered message.
type cursorPosition map[string]map[int32]partitionOffset

type partitionOffset struct {
	Offset int64 `json:"offset"`
	Epoch  int32 `json:"epoch"` // leader epoch, for broker side truncation detection
}

// positionTracker accumulates the position of a subscription across all
// partitions of all its topics. It is only ever touched by the poller
// goroutine that owns the subscription, so it needs no locking.
type positionTracker struct {
	pos cursorPosition
}

func newPositionTracker() *positionTracker {
	return &positionTracker{pos: make(cursorPosition)}
}

// advance records the last delivered offset/epoch for a topic partition.
func (t *positionTracker) advance(topic string, partition int32, offset int64, epoch int32) {
	parts, ok := t.pos[topic]
	if !ok {
		parts = make(map[int32]partitionOffset)
		t.pos[topic] = parts
	}
	parts[partition] = partitionOffset{Offset: offset, Epoch: epoch}
}

// seed initializes the tracker from a decoded cursor position, e.g. when
// resuming a subscription, so cursors emitted afterwards stay complete rather
// than only describing partitions seen since the resume.
func (t *positionTracker) seed(pos cursorPosition) {
	for topic, parts := range pos {
		dst, ok := t.pos[topic]
		if !ok {
			dst = make(map[int32]partitionOffset)
			t.pos[topic] = dst
		}
		for partition, po := range parts {
			dst[partition] = po
		}
	}
}

// snapshot returns a deep copy of the current position, marshaled to JSON.
func (t *positionTracker) snapshot() (json.RawMessage, error) {
	cp := make(cursorPosition, len(t.pos))
	for topic, parts := range t.pos {
		dstParts := make(map[int32]partitionOffset, len(parts))
		for partition, po := range parts {
			dstParts[partition] = po
		}
		cp[topic] = dstParts
	}
	return json.Marshal(cp)
}
