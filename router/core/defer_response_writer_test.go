package core

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
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
			"Content-Type: application/json\r\n\r\n{\"incremental\":[{\"data\":{\"b\":2}}],\"hasNext\":false}\r\n--graphql--",
		rec.Body.String())
}

func TestHttpDeferWriterHasNoEmptyFinalPart(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name     string
		payloads []string
	}{
		{
			name: "deferred response",
			payloads: []string{
				`{"data":{"hasNext":false},"hasNext":true}`,
				`{"incremental":[{"data":{"a":1}}],"hasNext":true}`,
				`{"incremental":[{"data":{"b":2}}], "hasNext": false}`,
			},
		},
		{
			name:     "single final payload",
			payloads: []string{`{"data":null,"hasNext":false}`},
		},
		{
			// The engine omits hasNext when no deferred anchor survives.
			name:     "no surviving defers",
			payloads: []string{`{"data":{"hasNext":true}}`},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			w, rec := newTestDeferWriter(t)
			for _, payload := range tc.payloads {
				_, err := io.WriteString(w, payload+"\n")
				require.NoError(t, err)
				require.NoError(t, w.Flush())
			}
			w.Complete()

			reader := multipart.NewReader(rec.Body, multipartBoundary)
			for _, payload := range tc.payloads {
				part, err := reader.NextPart()
				require.NoError(t, err)
				assert.Equal(t, jsonContent, part.Header.Get("Content-Type"))
				body, err := io.ReadAll(part)
				require.NoError(t, err)
				assert.Equal(t, payload, string(body))
			}
			_, err := reader.NextPart()
			require.ErrorIs(t, err, io.EOF, "the last JSON payload must be followed by the closing boundary, not an empty part")
		})
	}
}

func TestHttpDeferWriterCompleteWithoutParts(t *testing.T) {
	t.Parallel()

	w, rec := newTestDeferWriter(t)
	w.Complete()

	assert.Equal(t, "--graphql--", rec.Body.String())
}
