package core

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-wasm-module/wire"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

// fakeEvent is a StreamEvent that carries provider-like metadata (key) in
// addition to its data payload, to verify metadata is preserved across the
// WASM boundary.
type fakeEvent struct {
	data []byte
	key  string
}

func (e *fakeEvent) GetData() []byte  { return e.data }
func (e *fakeEvent) SetData(d []byte) { e.data = d }
func (e *fakeEvent) Clone() datasource.MutableStreamEvent {
	return &fakeEvent{data: append([]byte(nil), e.data...), key: e.key}
}

func TestRebuildEventsPreservesMetadata(t *testing.T) {
	original := datasource.NewStreamEvents([]datasource.StreamEvent{
		&fakeEvent{data: []byte(`{"a":1}`), key: "k0"},
		&fakeEvent{data: []byte(`{"a":2}`), key: "k1"},
	})

	newEvent := func(d []byte) datasource.MutableStreamEvent {
		return &fakeEvent{data: d, key: "new"}
	}

	// Guest returns the first event modified, the second unchanged, and one extra.
	out := rebuildEvents([][]byte{
		[]byte(`{"a":10}`),
		[]byte(`{"a":2}`),
		[]byte(`{"a":3}`),
	}, original, newEvent)

	events := out.Unsafe()
	require.Len(t, events, 3)

	e0 := events[0].(*fakeEvent)
	assert.Equal(t, "k0", e0.key, "metadata of index 0 must be preserved")
	assert.JSONEq(t, `{"a":10}`, string(e0.GetData()))

	e1 := events[1].(*fakeEvent)
	assert.Equal(t, "k1", e1.key, "metadata of unchanged event must be preserved")

	e2 := events[2].(*fakeEvent)
	assert.Equal(t, "new", e2.key, "extra event beyond original is created fresh")
	assert.JSONEq(t, `{"a":3}`, string(e2.GetData()))
}

func TestApplyContextSetsPreservesIntegerPrecision(t *testing.T) {
	rc := &requestContext{}
	// 2^53 + 1 cannot be represented exactly as a float64.
	applyContextSets(rc, map[string]json.RawMessage{
		"bigID": json.RawMessage(`9007199254740993`),
		"name":  json.RawMessage(`"alice"`),
	})

	got, ok := rc.Get("bigID")
	require.True(t, ok)
	num, ok := got.(json.Number)
	require.True(t, ok, "integers must be decoded as json.Number, got %T", got)
	assert.Equal(t, "9007199254740993", num.String())

	// The stored value round-trips back into a guest snapshot with full
	// precision (a plain float64 decode would corrupt it to ...992).
	m := &wasmModule{}
	snap := m.snapshotContextValues(rc)
	assert.JSONEq(t, `9007199254740993`, string(snap["bigID"]))
	assert.JSONEq(t, `"alice"`, string(snap["name"]))
}

func TestApplyRequestMutation(t *testing.T) {
	t.Run("replaces headers", func(t *testing.T) {
		req := &http.Request{Header: http.Header{"A": {"1"}}}
		applyRequestMutation(req, &wire.RequestMutation{Header: wire.Header{"B": {"2"}}})
		assert.Equal(t, "", req.Header.Get("A"))
		assert.Equal(t, "2", req.Header.Get("B"))
	})

	t.Run("clears all headers with an empty map", func(t *testing.T) {
		req := &http.Request{Header: http.Header{"A": {"1"}}}
		applyRequestMutation(req, &wire.RequestMutation{Header: wire.Header{}})
		assert.Empty(t, req.Header)
	})

	t.Run("nil header is a no-op", func(t *testing.T) {
		req := &http.Request{Header: http.Header{"A": {"1"}}}
		applyRequestMutation(req, &wire.RequestMutation{Header: nil})
		assert.Equal(t, "1", req.Header.Get("A"))
	})

	t.Run("clears body with an empty slice", func(t *testing.T) {
		req := &http.Request{Header: http.Header{}, Body: nil}
		empty := []byte{}
		applyRequestMutation(req, &wire.RequestMutation{Body: &empty})
		require.NotNil(t, req.Body)
		assert.Equal(t, int64(0), req.ContentLength)
	})
}
