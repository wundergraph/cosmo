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
	w.Header().Set("Content-Type", multipartMime+"; boundary=\""+multipartBoundary+"\"; incrementalSpec="+deferIncrementalSpec)
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

// deferIncrementalSpec is the version of the incremental delivery format the
// router implements. It is advertised in the response Content-Type and matched
// against the incrementalSpec parameter of the request Accept header.
const deferIncrementalSpec = "v0.2"

type deferAcceptVerdict int

const (
	// deferAcceptCompatible: the client accepts multipart/mixed in the format
	// the router produces, or accepts anything.
	deferAcceptCompatible deferAcceptVerdict = iota
	// deferAcceptNoMultipart: the Accept header allows neither multipart/mixed
	// nor a matching wildcard.
	deferAcceptNoMultipart
	// deferAcceptUnsupportedSpec: every multipart/mixed element names an
	// incremental delivery format the router does not produce.
	deferAcceptUnsupportedSpec
)

// deferAccept inspects the Accept header of a request whose operation contains
// @defer. A multipart/mixed element without a format parameter, or with
// incrementalSpec set to the supported version, is compatible. An element with
// deferSpec (the pre-2023 Apollo format) or another incrementalSpec version is
// not, and wins over "multipart/*" and "*/*" wildcards: a client that names the
// format it can parse is more specific than a wildcard next to it. A missing
// Accept header means the client accepts anything (RFC 9110).
// For an unsupported format the offending parameter is returned as "name=value".
func deferAccept(r *http.Request) (deferAcceptVerdict, string) {
	acceptHeader := r.Header.Get("Accept")
	if acceptHeader == "" {
		return deferAcceptCompatible, ""
	}

	var (
		wildcard    bool
		unsupported string
	)
	for _, element := range strings.Split(acceptHeader, ",") {
		mediaType, params, err := mime.ParseMediaType(element)
		if err != nil {
			continue
		}
		switch mediaType {
		case "multipart/*", "*/*":
			wildcard = true
		case multipartMime:
			// mime.ParseMediaType lowercases parameter names.
			if v, ok := params["deferspec"]; ok {
				unsupported = "deferSpec=" + v
				continue
			}
			if v, ok := params["incrementalspec"]; ok && v != deferIncrementalSpec {
				unsupported = "incrementalSpec=" + v
				continue
			}
			return deferAcceptCompatible, ""
		}
	}

	switch {
	case unsupported != "":
		return deferAcceptUnsupportedSpec, unsupported
	case wildcard:
		return deferAcceptCompatible, ""
	}
	return deferAcceptNoMultipart, ""
}
