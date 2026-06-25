package core

import (
	"bytes"
	"context"
	"io"
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type HttpDeferWriter struct {
	ctx     context.Context
	writer  io.Writer
	flusher http.Flusher
	buf     *bytes.Buffer
}

var _ resolve.DeferResponseWriter = (*HttpDeferWriter)(nil)

func (f *HttpDeferWriter) Complete() {
	if f.ctx.Err() != nil {
		return
	}

	// Closing boundary terminates the multipart/mixed stream. Each part written
	// by Flush already ends with "\r\n\r\n", so the boundary follows directly.
	_, _ = f.writer.Write([]byte("--" + multipartBoundary + "--"))

	// Flush before closing the writer to ensure all data is sent
	f.flusher.Flush()
}

func (f *HttpDeferWriter) Write(p []byte) (n int, err error) {
	if err = f.ctx.Err(); err != nil {
		return
	}

	return f.buf.Write(p)
}

func (f *HttpDeferWriter) Flush() (err error) {
	if err = f.ctx.Err(); err != nil {
		return err
	}

	resp := f.buf.Bytes()
	f.buf.Reset()

	// For @defer, each payload is a self-contained multipart/mixed part. The
	// payload itself is raw JSON (not wrapped in a `payload` field like
	// subscriptions).
	// --graphql\r\n
	// Content-Type: application/json\r\n
	// \r\n
	// {"data": {...}, "incremental": [...], "hasNext": true}\r\n
	// \r\n
	// The trailing "\r\n\r\n" separates this part from the next boundary (or the
	// closing --graphql-- written by Complete).
	partHeader := "--" + multipartBoundary + "\r\nContent-Type: " + jsonContent + "\r\n\r\n"

	// resp sometimes ends with newlines. We need to remove them
	// to cleanly add the separation in the next step.
	if bytes.HasSuffix(resp, []byte{'\n'}) {
		resp = bytes.TrimRight(resp, "\n")
	}

	full := partHeader + string(resp) + "\r\n\r\n"
	_, err = f.writer.Write([]byte(full))
	if err != nil {
		return err
	}

	// Flush before closing the writer to ensure all data is sent
	f.flusher.Flush()

	return nil
}

func GetDeferResponseWriter(ctx *resolve.Context, _ *http.Request, w http.ResponseWriter) (*resolve.Context, resolve.DeferResponseWriter, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return ctx, nil, false
	}

	// Standard headers for Apollo Client @defer support
	w.Header().Set("Content-Type", "multipart/mixed; deferSpec=20220824; boundary=\""+multipartBoundary+"\"")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// allow unbuffered responses, it's used when it's necessary just to pass response through
	// setting this to “yes” will allow the response to be cached
	w.Header().Set("X-Accel-Buffering", "no")

	flushWriter := &HttpDeferWriter{
		writer:  w,
		flusher: flusher,
		buf:     &bytes.Buffer{},
	}

	flushWriter.ctx = ctx.Context()

	// execution engine heartbeat not needed for defer?
	return ctx, flushWriter, true
}
