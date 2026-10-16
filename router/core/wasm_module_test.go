package core

import (
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

func TestBuildHTTPResponseCanonicalizesHeaders(t *testing.T) {
	resp := buildHTTPResponse(&wire.HTTPResponse{
		Header: wire.Header{"content-type": {"application/json"}, "X-Multi": {"a", "b"}},
		Body:   []byte(`{}`),
	}, nil)

	assert.Equal(t, http.StatusOK, resp.StatusCode, "zero status defaults to 200")
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	assert.Equal(t, []string{"a", "b"}, resp.Header.Values("X-Multi"))
	assert.Equal(t, int64(2), resp.ContentLength)
}
