package core

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type HttpDeferWriter struct {
	ctx     context.Context
	writer  io.Writer
	flusher http.Flusher
	buf     *bytes.Buffer
}

var _ resolve.DeferResponseWriter = (*HttpDeferWriter)(nil)

const (
	// deferPartHeader prefixes every @defer payload as a multipart/mixed part.
	// Unlike subscriptions, the payload is raw JSON (not wrapped in a `payload`
	// field):
	//   --graphql\r\n
	//   Content-Type: application/json\r\n
	//   \r\n
	deferPartHeader = "--" + multipartBoundary + "\r\nContent-Type: " + jsonContent + "\r\n\r\n"
	// deferPartTrailer separates a part from the next boundary (or the closing
	// boundary written by Complete).
	deferPartTrailer = "\r\n\r\n"
	// deferCloseBoundary terminates the multipart/mixed stream.
	deferCloseBoundary = "--" + multipartBoundary + "--"
)

func (f *HttpDeferWriter) Complete() {
	if f.ctx.Err() != nil {
		return
	}

	// Each part written by Flush already ends with deferPartTrailer, so the
	// closing boundary follows directly.
	_, _ = io.WriteString(f.writer, deferCloseBoundary)

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

	// resp points at the buffer's backing array; it stays valid until the next
	// Write into f.buf, which can't happen before we finish writing it out here.
	// resp sometimes ends with newlines, trim them so the trailer attaches cleanly.
	resp := bytes.TrimRight(f.buf.Bytes(), "\n")
	f.buf.Reset()

	// Write the part directly to the underlying writer rather than assembling a
	// new buffer: the header/trailer are tiny constants and the (potentially
	// large) JSON payload is written without copying. The net/http response is
	// buffered, so these writes coalesce into a single chunk on Flush.
	if _, err = io.WriteString(f.writer, deferPartHeader); err != nil {
		return err
	}
	if _, err = f.writer.Write(resp); err != nil {
		return err
	}
	if _, err = io.WriteString(f.writer, deferPartTrailer); err != nil {
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

// clientAcceptsMultipartMixed reports whether the request's Accept header allows
// a multipart/mixed response, which @defer requires to stream incremental
// payloads. The check is lenient: it accepts "multipart/mixed" with any
// parameters (e.g. with or without deferSpec), the "multipart/*" and "*/*"
// wildcards, and a missing/empty Accept header (which per RFC 9110 means the
// client accepts anything).
func clientAcceptsMultipartMixed(r *http.Request) bool {
	acceptHeader := r.Header.Get("Accept")
	if acceptHeader == "" {
		return true
	}

	for _, element := range strings.Split(acceptHeader, ",") {
		mediaType, _, err := mime.ParseMediaType(element)
		if err != nil {
			continue
		}
		switch mediaType {
		case multipartMime, "multipart/*", "*/*":
			return true
		}
	}

	return false
}
