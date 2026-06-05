package speedtrap

import (
	"iter"
	"maps"

	"github.com/stretchr/testify/require"
)

// SwitchCase pairs a key with a callback for ReadSwitch.
type SwitchCase[K comparable, V any] struct {
	Key K
	Fn  func(V)
}

// Case creates a SwitchCase for use with ReadSwitch.
func Case[K comparable, V any](key K, fn func(V)) SwitchCase[K, V] {
	return SwitchCase[K, V]{Key: key, Fn: fn}
}

// ReadSwitch reads exactly len(cases) values from the iterator, dispatching
// each to the case whose key matches. Every value must match a case and every
// case must be matched exactly once.
//
// Failures:
//   - Unexpected value: key doesn't match any remaining case
//   - Timeout/close: iterator yields an error before all cases are matched
func ReadSwitch[K comparable, V any](s *S, items iter.Seq2[V, error], key func(V) K, cases ...SwitchCase[K, V]) {
	remaining := make(map[K]func(V), len(cases))
	for _, c := range cases {
		remaining[c.Key] = c.Fn
	}

	for item, err := range items {
		if err != nil {
			require.NoError(s, err, "ReadSwitch: waiting for keys %v", maps.Keys(remaining))
		}

		k := key(item)
		fn, ok := remaining[k]
		require.True(s, ok, "ReadSwitch: unexpected key %v in value: %v", k, item)

		fn(item)
		delete(remaining, k)

		if len(remaining) == 0 {
			return
		}
	}
}

// Filter wraps an iterator, dropping values that match skip.
func Filter[V any](items iter.Seq2[V, error], skip func(V) bool) iter.Seq2[V, error] {
	return func(yield func(V, error) bool) {
		for item, err := range items {
			if err != nil {
				yield(item, err)
				return
			}
			if skip(item) {
				continue
			}
			if !yield(item, err) {
				return
			}
		}
	}
}

// Tagged pairs a message with the connection it was read from.
type Tagged struct {
	Conn *ConnectionHandle
	Msg  string
}

// Messages returns an iterator that reads messages from the connection.
func (h *ConnectionHandle) Messages() iter.Seq2[string, error] {
	return func(yield func(string, error) bool) {
		for {
			msg, err := h.Read()
			if !yield(msg, err) {
				return
			}
			if err != nil {
				return
			}
		}
	}
}

// MergeMessages reads one message from each connection sequentially, yielding
// Tagged values that pair the message with its source connection. This is safe
// when each connection will independently have a message available (no
// cross-connection dependencies).
func MergeMessages(conns ...*ConnectionHandle) iter.Seq2[Tagged, error] {
	return func(yield func(Tagged, error) bool) {
		for _, c := range conns {
			msg, err := c.Read()
			if !yield(Tagged{Conn: c, Msg: msg}, err) {
				return
			}
		}
	}
}
