package core

import (
	"bytes"
	"context"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestDeferWriter(t *testing.T) (*HttpDeferWriter, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	return &HttpDeferWriter{
		ctx:     context.Background(),
		writer:  rec,
		flusher: rec,
		buf:     &bytes.Buffer{},
	}, rec
}

// A part must be complete on the wire as soon as it is flushed: the boundary that closes it follows its body
// directly, so a reader does not have to wait for the next part to know where this one ended.
func TestHttpDeferWriterEndsEachPartWithItsBoundary(t *testing.T) {
	t.Parallel()

	w, rec := newTestDeferWriter(t)

	_, err := w.Write([]byte(`{"data":{"a":1}}`))
	require.NoError(t, err)
	require.NoError(t, w.Flush())
	assert.Equal(t, "--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"a\":1}}\r\n--graphql", rec.Body.String())

	_, err = w.Write([]byte(`{"data":{"b":2}}`))
	require.NoError(t, err)
	require.NoError(t, w.Flush())
	w.Complete()

	assert.Equal(t,
		"--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"a\":1}}\r\n--graphql"+
			"\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"b\":2}}\r\n--graphql--",
		rec.Body.String())
}

func TestHttpDeferWriterCompleteWithoutParts(t *testing.T) {
	t.Parallel()

	w, rec := newTestDeferWriter(t)
	w.Complete()

	assert.Equal(t, "--graphql--", rec.Body.String())
}
