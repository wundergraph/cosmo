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

// The CRLF lets a reader finish each part before the next one arrives.
func TestHttpDeferWriterEndsEachPartWithItsBoundary(t *testing.T) {
	t.Parallel()

	w, rec := newTestDeferWriter(t)

	_, err := w.Write([]byte(`{"data":{"a":1},"hasNext":true}`))
	require.NoError(t, err)
	require.NoError(t, w.Flush())
	assert.Equal(t, "--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"a\":1},\"hasNext\":true}\r\n--graphql\r\n", rec.Body.String())

	_, err = w.Write([]byte(`{"incremental":[{"data":{"b":2}}],"hasNext":false}`))
	require.NoError(t, err)
	require.NoError(t, w.Flush())
	w.Complete()

	assert.Equal(t,
		"--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"a\":1},\"hasNext\":true}\r\n--graphql\r\n"+
			"Content-Type: application/json\r\n\r\n{\"incremental\":[{\"data\":{\"b\":2}}],\"hasNext\":false}\r\n--graphql\r\n"+
			"\r\n--graphql--",
		rec.Body.String())
}

func TestHttpDeferWriterCompleteWithoutParts(t *testing.T) {
	t.Parallel()

	w, rec := newTestDeferWriter(t)
	w.Complete()

	assert.Equal(t, "--graphql--", rec.Body.String())
}
