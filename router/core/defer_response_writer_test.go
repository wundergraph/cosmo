package core

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type deferTestResponseWriter struct {
	header        http.Header
	body          bytes.Buffer
	chunks        [][]byte
	flushedBytes  int
	status        int
	writeCalls    int
	failWriteCall int
	failWriteN    int
	writeErr      error
}

func newDeferTestResponseWriter() *deferTestResponseWriter {
	return &deferTestResponseWriter{header: make(http.Header)}
}

func (w *deferTestResponseWriter) Header() http.Header {
	return w.header
}

func (w *deferTestResponseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *deferTestResponseWriter) Write(p []byte) (int, error) {
	w.writeCalls++
	if w.writeCalls == w.failWriteCall {
		n := min(w.failWriteN, len(p))
		if n > 0 {
			_, _ = w.body.Write(p[:n])
		}
		return n, w.writeErr
	}
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(p)
}

func (w *deferTestResponseWriter) Flush() {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.chunks = append(w.chunks, bytes.Clone(w.body.Bytes()[w.flushedBytes:]))
	w.flushedBytes = w.body.Len()
}

type deferTestNonFlusher struct {
	header http.Header
	body   bytes.Buffer
}

func newDeferTestNonFlusher() *deferTestNonFlusher {
	return &deferTestNonFlusher{header: make(http.Header)}
}

func (w *deferTestNonFlusher) Header() http.Header {
	return w.header
}

func (w *deferTestNonFlusher) WriteHeader(_ int) {}

func (w *deferTestNonFlusher) Write(p []byte) (int, error) {
	return w.body.Write(p)
}

func TestHttpDeferWriterFramesAndFlushesMultipartParts(t *testing.T) {
	transport := newDeferTestResponseWriter()
	writer := &HttpDeferWriter{
		ctx:     context.Background(),
		writer:  transport,
		flusher: transport,
		buf:     &bytes.Buffer{},
	}

	firstPayload := []byte("{\"data\":{\"fast\":true}}\n\n")
	n, err := writer.Write(firstPayload)
	require.NoError(t, err)
	assert.Equal(t, len(firstPayload), n)
	require.NoError(t, writer.Flush())

	require.Len(t, transport.chunks, 1)
	assert.Equal(t,
		"\r\n--graphql\r\nContent-Type: application/json\r\n\r\n"+
			"{\"data\":{\"fast\":true}}\r\n\r\n\r\n--graphql",
		string(transport.chunks[0]),
	)
	assert.True(t, writer.wroteFirstPart)
	assert.Zero(t, writer.buf.Len())

	secondPayload := []byte("{\"incremental\":[{\"id\":\"1\"}],\"extensions\":{\"trace\":{\"version\":\"1\"}},\"hasNext\":false}")
	n, err = writer.Write(secondPayload)
	require.NoError(t, err)
	assert.Equal(t, len(secondPayload), n)
	require.NoError(t, writer.Flush())

	require.Len(t, transport.chunks, 2)
	assert.Equal(t,
		"\r\nContent-Type: application/json\r\n\r\n"+
			"{\"incremental\":[{\"id\":\"1\"}],\"extensions\":{\"trace\":{\"version\":\"1\"}},\"hasNext\":false}\r\n\r\n\r\n--graphql",
		string(transport.chunks[1]),
	)

	writer.Complete()
	require.Len(t, transport.chunks, 3)
	assert.Equal(t, "--", string(transport.chunks[2]))
	assert.Equal(t,
		"\r\n--graphql\r\nContent-Type: application/json\r\n\r\n"+
			"{\"data\":{\"fast\":true}}\r\n\r\n\r\n--graphql"+
			"\r\nContent-Type: application/json\r\n\r\n"+
			"{\"incremental\":[{\"id\":\"1\"}],\"extensions\":{\"trace\":{\"version\":\"1\"}},\"hasNext\":false}\r\n\r\n\r\n--graphql--",
		transport.body.String(),
	)
}

func TestHttpDeferWriterCompleteState(t *testing.T) {
	t.Run("before the first part", func(t *testing.T) {
		transport := newDeferTestResponseWriter()
		writer := &HttpDeferWriter{
			ctx:     context.Background(),
			writer:  transport,
			flusher: transport,
			buf:     &bytes.Buffer{},
		}

		writer.Complete()

		assert.Empty(t, transport.chunks)
		assert.Empty(t, transport.body.String())

		n, err := writer.Write([]byte("payload"))
		assert.Zero(t, n)
		assert.ErrorIs(t, err, io.ErrClosedPipe)
		assert.ErrorIs(t, writer.Flush(), io.ErrClosedPipe)

		writer.Complete()

		assert.Empty(t, transport.chunks)
		assert.Empty(t, transport.body.String())
	})

	t.Run("after a flushed part", func(t *testing.T) {
		transport := newDeferTestResponseWriter()
		writer := &HttpDeferWriter{
			ctx:     context.Background(),
			writer:  transport,
			flusher: transport,
			buf:     &bytes.Buffer{},
		}
		_, err := writer.Write([]byte("payload"))
		require.NoError(t, err)
		require.NoError(t, writer.Flush())

		writer.Complete()
		require.Len(t, transport.chunks, 2)
		completedBody := transport.body.String()

		writer.Complete()

		require.Len(t, transport.chunks, 2)
		assert.Equal(t, completedBody, transport.body.String())
		assert.Equal(t, "\r\n--graphql\r\nContent-Type: application/json\r\n\r\npayload\r\n\r\n\r\n--graphql--", completedBody)

		n, err := writer.Write([]byte("after complete"))
		assert.Zero(t, n)
		assert.ErrorIs(t, err, io.ErrClosedPipe)
		assert.ErrorIs(t, writer.Flush(), io.ErrClosedPipe)
		assert.Equal(t, completedBody, transport.body.String())
	})
}

func TestHttpDeferWriterHonorsCancellation(t *testing.T) {
	t.Run("write", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		transport := newDeferTestResponseWriter()
		writer := &HttpDeferWriter{ctx: ctx, writer: transport, flusher: transport, buf: &bytes.Buffer{}}

		n, err := writer.Write([]byte("payload"))

		assert.Zero(t, n)
		assert.ErrorIs(t, err, context.Canceled)
		assert.Zero(t, writer.buf.Len())
		assert.Zero(t, transport.body.Len())
	})

	t.Run("flush", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		transport := newDeferTestResponseWriter()
		writer := &HttpDeferWriter{ctx: ctx, writer: transport, flusher: transport, buf: &bytes.Buffer{}}
		_, err := writer.Write([]byte("payload"))
		require.NoError(t, err)
		cancel()

		err = writer.Flush()

		assert.ErrorIs(t, err, context.Canceled)
		assert.Equal(t, "payload", writer.buf.String())
		assert.Empty(t, transport.chunks)
		assert.Zero(t, transport.body.Len())
	})

	t.Run("complete", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		transport := newDeferTestResponseWriter()
		writer := &HttpDeferWriter{ctx: ctx, writer: transport, flusher: transport, buf: &bytes.Buffer{}}
		_, err := writer.Write([]byte("payload"))
		require.NoError(t, err)
		require.NoError(t, writer.Flush())
		require.Len(t, transport.chunks, 1)
		cancel()

		writer.Complete()

		require.Len(t, transport.chunks, 1)
		assert.Equal(t, "\r\n--graphql\r\nContent-Type: application/json\r\n\r\npayload\r\n\r\n\r\n--graphql", transport.body.String())
	})
}

func TestHttpDeferWriterMakesFrameWriteFailuresTerminal(t *testing.T) {
	writeErr := errors.New("transport write failed")
	stages := []struct {
		name string
		call int
	}{
		{name: "part header", call: 1},
		{name: "payload", call: 2},
		{name: "next boundary", call: 3},
	}
	modes := []struct {
		name    string
		writeN  int
		err     error
		wantErr error
	}{
		{name: "zero bytes with error", err: writeErr, wantErr: writeErr},
		{name: "partial write with error", writeN: 1, err: writeErr, wantErr: writeErr},
		{name: "zero bytes without error", wantErr: io.ErrShortWrite},
	}

	for _, stage := range stages {
		for _, mode := range modes {
			t.Run(stage.name+"/"+mode.name, func(t *testing.T) {
				transport := newDeferTestResponseWriter()
				transport.failWriteCall = stage.call
				transport.failWriteN = mode.writeN
				transport.writeErr = mode.err
				writer := &HttpDeferWriter{
					ctx:     context.Background(),
					writer:  transport,
					flusher: transport,
					buf:     &bytes.Buffer{},
				}
				_, err := writer.Write([]byte("payload"))
				require.NoError(t, err)

				err = writer.Flush()

				assert.ErrorIs(t, err, mode.wantErr)
				assert.Equal(t, stage.call, transport.writeCalls)
				assert.Empty(t, transport.chunks)
				assert.Equal(t, "payload", writer.buf.String())
				failedBody := transport.body.String()

				n, writeAfterFailureErr := writer.Write([]byte("later"))
				assert.Zero(t, n)
				assert.ErrorIs(t, writeAfterFailureErr, mode.wantErr)
				assert.ErrorIs(t, writer.Flush(), mode.wantErr)
				writer.Complete()

				assert.Equal(t, failedBody, transport.body.String())
				assert.Empty(t, transport.chunks)
			})
		}
	}
}

func TestHttpDeferWriterMakesCloseFailureTerminal(t *testing.T) {
	closeErr := errors.New("close failed")
	transport := newDeferTestResponseWriter()
	writer := &HttpDeferWriter{ctx: context.Background(), writer: transport, flusher: transport, buf: &bytes.Buffer{}}
	_, err := writer.Write([]byte("payload"))
	require.NoError(t, err)
	require.NoError(t, writer.Flush())
	require.Len(t, transport.chunks, 1)

	transport.failWriteCall = 4
	transport.writeErr = closeErr
	beforeClose := transport.body.String()
	writer.Complete()

	assert.Equal(t, beforeClose, transport.body.String())
	require.Len(t, transport.chunks, 1)
	n, err := writer.Write([]byte("after close failure"))
	assert.Zero(t, n)
	assert.ErrorIs(t, err, closeErr)
	assert.ErrorIs(t, writer.Flush(), closeErr)
	writer.Complete()
	assert.Equal(t, beforeClose, transport.body.String())
}

func TestGetDeferResponseWriter(t *testing.T) {
	t.Run("sets streaming headers", func(t *testing.T) {
		transport := newDeferTestResponseWriter()
		resolveContext := resolve.NewContext(context.Background())

		gotContext, writer, ok := GetDeferResponseWriter(resolveContext, nil, transport)

		require.True(t, ok)
		assert.Same(t, resolveContext, gotContext)
		require.IsType(t, &HttpDeferWriter{}, writer)
		assert.Equal(t, `multipart/mixed; deferSpec=20220824; boundary="graphql"`, transport.Header().Get("Content-Type"))
		assert.Equal(t, "chunked", transport.Header().Get("Transfer-Encoding"))
		assert.Equal(t, "no-cache", transport.Header().Get("Cache-Control"))
		assert.Equal(t, "keep-alive", transport.Header().Get("Connection"))
		assert.Equal(t, "no", transport.Header().Get("X-Accel-Buffering"))
	})

	t.Run("rejects a response writer without flushing", func(t *testing.T) {
		transport := newDeferTestNonFlusher()
		resolveContext := resolve.NewContext(context.Background())

		gotContext, writer, ok := GetDeferResponseWriter(resolveContext, nil, transport)

		assert.False(t, ok)
		assert.Same(t, resolveContext, gotContext)
		assert.Nil(t, writer)
		assert.Empty(t, transport.Header())
	})
}

func TestClientAcceptsMultipartMixedNegotiation(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   bool
	}{
		{name: "missing Accept", want: true},
		{name: "exact", header: "multipart/mixed", want: true},
		{name: "media type and parameter casing", header: "Multipart/Mixed; DeferSpec=20220824", want: true},
		{name: "multipart wildcard", header: "multipart/*", want: true},
		{name: "any wildcard", header: "*/*", want: true},
		{name: "unmatched", header: "application/json", want: false},
		{name: "exact rejection overrides any wildcard", header: "multipart/mixed;q=0, */*;q=1", want: false},
		{name: "exact acceptance overrides multipart wildcard rejection", header: "multipart/*;q=0, multipart/mixed;q=1", want: true},
		{name: "multipart wildcard rejection overrides any wildcard acceptance", header: "multipart/*;q=0, */*;q=1", want: false},
		{name: "duplicate exact ranges use highest quality", header: "multipart/mixed;q=0, multipart/mixed;q=1", want: true},
		{name: "duplicate exact ranges are order independent", header: "multipart/mixed;q=1, multipart/mixed;q=0", want: true},
		{name: "matching deferSpec parameter has precedence", header: "multipart/mixed;q=1, multipart/mixed;deferSpec=20220824;q=0", want: false},
		{name: "matching boundary parameter has precedence", header: "multipart/mixed;q=1, multipart/mixed;boundary=graphql;q=0", want: false},
		{name: "wrong boundary does not match", header: "multipart/mixed;boundary=other", want: false},
		{name: "wrong deferSpec does not match", header: "multipart/mixed;deferSpec=wrong", want: false},
		{name: "wrong deferSpec falls back to a valid bare range", header: "multipart/mixed;deferSpec=wrong;q=1, multipart/mixed;q=0.5", want: true},
		{name: "unknown parameter does not match", header: "multipart/mixed;unknown=value", want: false},
		{name: "malformed quality invalidates the range", header: "multipart/mixed;q=bogus", want: false},
		{name: "malformed exact range does not override a valid wildcard", header: "multipart/mixed;q=bogus, */*;q=1", want: true},
		{name: "quality above one invalidates the range", header: "multipart/mixed;q=1.1", want: false},
		{name: "quality below zero invalidates the range", header: "multipart/mixed;q=-0.1", want: false},
		{name: "not-a-number quality invalidates the range", header: "multipart/mixed;q=NaN", want: false},
		{name: "quality with too many fractional digits is invalid", header: "multipart/mixed;q=0.1234", want: false},
		{name: "one quality requires zero fractional digits", header: "multipart/mixed;q=1.001", want: false},
		{name: "leading-dot quality is invalid", header: "multipart/mixed;q=.5", want: false},
		{name: "quoted quality is invalid", header: `multipart/mixed;q="0.5"`, want: false},
		{name: "three fractional digits are valid", header: "multipart/mixed;q=0.123", want: true},
		{name: "one with zero fractional digits is valid", header: "multipart/mixed;q=1.000", want: true},
		{name: "zero quality rejects", header: "multipart/mixed;q=0", want: false},
		{name: "fractional quality accepts", header: "multipart/mixed;q=0.5", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{Header: make(http.Header)}
			if tt.header != "" {
				r.Header.Set("Accept", tt.header)
			}

			assert.Equal(t, tt.want, clientAcceptsMultipartMixed(r))
		})
	}

	t.Run("combines repeated Accept field lines", func(t *testing.T) {
		r := &http.Request{Header: make(http.Header)}
		r.Header.Add("Accept", "application/json")
		r.Header.Add("Accept", "multipart/mixed")

		assert.True(t, clientAcceptsMultipartMixed(r))
	})
}
