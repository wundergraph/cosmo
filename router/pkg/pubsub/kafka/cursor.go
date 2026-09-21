package kafka

import (
	"encoding/json"
	"maps"
)

// cursorPosition maps topic -> partition -> last delivered message.
//
// It also serves as the tracker that accumulates the position of a
// subscription across all partitions of all its topics. It is only ever
// touched by the poller goroutine that owns the subscription, so it needs
// no locking.
type cursorPosition map[string]map[int32]partitionOffset

type partitionOffset struct {
	Offset int64 `json:"offset"`
	Epoch  int32 `json:"epoch"`
}

// advance records the last delivered offset/epoch for a topic partition.
func (p cursorPosition) advance(topic string, partition int32, offset int64, epoch int32) {
	parts, ok := p[topic]
	if !ok {
		parts = make(map[int32]partitionOffset)
		p[topic] = parts
	}

	parts[partition] = partitionOffset{Offset: offset, Epoch: epoch}
}

// seed merges a decoded cursor position into the tracker, e.g. when resuming
// a subscription, so cursors emitted afterwards stay complete rather than
// only describing partitions seen since the resume.
func (p cursorPosition) seed(pos cursorPosition) {
	for topic, partitions := range pos {
		dst, ok := p[topic]
		if !ok {
			dst = make(map[int32]partitionOffset)
			p[topic] = dst
		}

		maps.Copy(dst, partitions)
	}
}

// snapshot returns a deep copy of the position, marshaled to JSON.
func (p cursorPosition) snapshot() (json.RawMessage, error) {
	cp := make(cursorPosition, len(p))

	for topic, parts := range p {
		dstParts := make(map[int32]partitionOffset, len(parts))
		maps.Copy(dstParts, parts)
		cp[topic] = dstParts
	}

	return json.Marshal(cp)
}
