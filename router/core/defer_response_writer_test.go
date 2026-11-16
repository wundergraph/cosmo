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
	require.NoError(t, w.Flush(false))
	assert.Equal(t, "--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"a\":1},\"hasNext\":true}\r\n--graphql\r\n", rec.Body.String())

	// A reader can finish the first part before any later payload is written.
	reader := multipart.NewReader(bytes.NewReader(rec.Body.Bytes()), multipartBoundary)
	part, err := reader.NextPart()
	require.NoError(t, err)
	body, err := io.ReadAll(part)
	require.NoError(t, err)
	assert.JSONEq(t, `{"data":{"a":1},"hasNext":true}`, string(body))

	_, err = w.Write([]byte(`{"incremental":[{"data":{"b":2}}],"hasNext":false}`))
	require.NoError(t, err)
	require.NoError(t, w.Flush(true))
	w.Complete()

	assert.Equal(t,
		"--graphql\r\nContent-Type: application/json\r\n\r\n{\"data\":{\"a\":1},\"hasNext\":true}\r\n--graphql\r\n"+
			"Content-Type: application/json\r\n\r\n{\"incremental\":[{\"data\":{\"b\":2}}],\"hasNext\":false}\r\n--graphql--",
		rec.Body.String())
}

func TestHttpDeferWriterCompleteWithoutParts(t *testing.T) {
	t.Parallel()

	w, rec := newTestDeferWriter(t)
	w.Complete()

	assert.Empty(t, rec.Body.String())
}

func TestHttpDeferWriterFinalPayloadClosesStream(t *testing.T) {
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
				`{"incremental":[{"data":{"b":2}}],"hasNext":false}`,
			},
		},
		{name: "single final payload", payloads: []string{`{"data":null,"hasNext":false}`}},
		{name: "no surviving defers", payloads: []string{`{"data":{"hasNext":true}}`}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			w, rec := newTestDeferWriter(t)
			for i, payload := range tc.payloads {
				_, err := io.WriteString(w, payload+"\n")
				require.NoError(t, err)
				require.NoError(t, w.Flush(i == len(tc.payloads)-1))
			}
			wire := rec.Body.String()
			w.Complete()
			w.Complete()
			require.Equal(t, wire, rec.Body.String(), "cleanup must not append another boundary")

			reader := multipart.NewReader(rec.Body, multipartBoundary)
			for _, payload := range tc.payloads {
				part, err := reader.NextPart()
				require.NoError(t, err)
				require.Equal(t, jsonContent, part.Header.Get("Content-Type"))
				body, err := io.ReadAll(part)
				require.NoError(t, err)
				require.Equal(t, payload, string(body))
			}
			_, err := reader.NextPart()
			require.ErrorIs(t, err, io.EOF, "no empty part may follow the final payload")
		})
	}
}

func TestHttpDeferWriterCompleteLeavesInterruptedStreamIncomplete(t *testing.T) {
	t.Parallel()

	w, rec := newTestDeferWriter(t)
	_, err := io.WriteString(w, `{"data":{},"hasNext":true}`)
	require.NoError(t, err)
	require.NoError(t, w.Flush(false))
	wire := rec.Body.String()

	// An error during the next render may leave an incomplete buffered payload.
	_, err = io.WriteString(w, `{"incremental":[`)
	require.NoError(t, err)
	w.Complete()
	require.Zero(t, w.buf.Len())
	require.Equal(t, wire, rec.Body.String())
	require.NotContains(t, rec.Body.String(), deferCloseLine)
}
