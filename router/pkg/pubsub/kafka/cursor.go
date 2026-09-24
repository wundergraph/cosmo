package kafka

import (
	"encoding/json"
	"maps"
)

// cursorPosition serves as the tracker that accumulates the position of a
// subscription across all partitions of all its topics.
type cursorPosition map[string]map[int32]partitionOffset

type partitionOffset struct {
	Offset int64 `json:"offset"`
	Epoch  int32 `json:"epoch"`
}

// addOffset adds or overwrites offset+epoch on partition of topic.
func (p cursorPosition) addOffset(topic string, partition int32, offset int64, epoch int32) {
	partitions, ok := p[topic]
	if !ok {
		partitions = make(map[int32]partitionOffset)
		p[topic] = partitions
	}

	partitions[partition] = partitionOffset{Offset: offset, Epoch: epoch}
}

// merge merges pos into p. It overrides any partition position found in both, p and pos,
// with pos.
func (p cursorPosition) merge(pos cursorPosition) {
	for topic, partitions := range pos {
		dst, ok := p[topic]
		if !ok {
			dst = make(map[int32]partitionOffset)
			p[topic] = dst
		}

		maps.Copy(dst, partitions)
	}
}

func (p cursorPosition) marshal() (json.RawMessage, error) {
	return json.Marshal(p.deepCopy())
}

func (p cursorPosition) deepCopy() cursorPosition {
	copy := make(cursorPosition, len(p))
	for topic, parts := range p {
		copy[topic] = maps.Clone(parts)
	}
	return copy
}
