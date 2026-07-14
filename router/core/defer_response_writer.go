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

// HttpDeferWriter buffers one GraphQL JSON envelope at a time and writes it as
// a multipart/mixed part. It is not safe for concurrent use. Complete is
// terminal; because resolve.DeferResponseWriter cannot return a close error,
// any close failure is returned by later Write or Flush calls.
type HttpDeferWriter struct {
	ctx     context.Context
	writer  io.Writer
	flusher http.Flusher
	buf     *bytes.Buffer
	// wroteFirstPart tracks whether the opening boundary is on the wire; every
	// later part's boundary is written eagerly by the preceding Flush.
	wroteFirstPart bool
	terminalErr    error
}

var _ resolve.DeferResponseWriter = (*HttpDeferWriter)(nil)

// The multipart/mixed stream frames every @defer payload as:
//
//	\r\n--graphql\r\n
//	Content-Type: application/json\r\n
//	\r\n
//	<raw JSON>\r\n\r\n
//
// terminated by \r\n--graphql--. Unlike subscriptions, the payload is raw JSON
// (not wrapped in a `payload` field).
//
// Two constraints shape how these bytes are scheduled onto the wire:
//   - Every boundary starts with CRLF (RFC 2046 delimiter form). Client
//     multipart parsers (meros, used by graphiql and Apollo Client) scan each
//     network chunk for "\r\n--boundary"; without the leading CRLF a part
//     boundary can straddle two chunks and coalesced parts get merged into one.
//   - A parser can only complete part N when it sees the boundary that follows
//     it, so each flush ENDS with the next boundary (deferPartSuffix). Writing
//     the boundary at the start of the next part instead would hold every part
//     in the client's parser until the following one arrives — the initial
//     response would render only when the first deferred part lands.
const (
	// deferFirstPartHeader opens the stream and the first part.
	deferFirstPartHeader = "\r\n--" + multipartBoundary + "\r\nContent-Type: " + jsonContent + "\r\n\r\n"
	// deferNextPartHeader continues a part whose boundary was already written by
	// the previous flush's deferPartSuffix.
	deferNextPartHeader = "\r\nContent-Type: " + jsonContent + "\r\n\r\n"
	// deferPartSuffix terminates a part and eagerly announces the next boundary.
	deferPartSuffix = "\r\n\r\n" + "\r\n--" + multipartBoundary
	// deferClose turns the eagerly written boundary into the closing one.
	deferClose = "--"
)

func writeStringFull(w io.Writer, value string) error {
	for len(value) > 0 {
		n, err := io.WriteString(w, value)
		if n > 0 {
			value = value[n:]
		}
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

func writeBytesFull(w io.Writer, value []byte) error {
	for len(value) > 0 {
		n, err := w.Write(value)
		if n > 0 {
			value = value[n:]
		}
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

func (f *HttpDeferWriter) stateError() error {
	if f.terminalErr != nil {
		return f.terminalErr
	}
	return f.ctx.Err()
}

func (f *HttpDeferWriter) fail(err error) error {
	f.terminalErr = err
	return err
}

func (f *HttpDeferWriter) Complete() {
	if f.stateError() != nil {
		return
	}

	// The engine calls Complete only after the first part has flushed. Treat an
	// early call as terminal without inventing an invalid zero-part MIME body.
	if !f.wroteFirstPart {
		f.terminalErr = io.ErrClosedPipe
		return
	}

	// Every flushed part ends with the next boundary, so only the closing dashes
	// are missing. Complete is best-effort because its interface returns no error.
	// Preserve a close failure so later Write or Flush calls can observe it.
	if err := writeStringFull(f.writer, deferClose); err != nil {
		f.terminalErr = err
		return
	}
	f.terminalErr = io.ErrClosedPipe

	// Flush only after the closing delimiter was written successfully.
	f.flusher.Flush()
}

func (f *HttpDeferWriter) Write(p []byte) (n int, err error) {
	if err = f.stateError(); err != nil {
		return
	}

	return f.buf.Write(p)
}

func (f *HttpDeferWriter) Flush() (err error) {
	if err = f.stateError(); err != nil {
		return err
	}

	// resp points at the buffer's backing array; it stays valid until the next
	// Write into f.buf, which can't happen before we finish writing it out here.
	// resp sometimes ends with newlines, trim them so the trailer attaches cleanly.
	resp := bytes.TrimRight(f.buf.Bytes(), "\n")

	// Write the part directly to the underlying writer rather than assembling a
	// new buffer: the header/trailer are tiny constants and the (potentially
	// large) JSON payload is written without copying. The net/http response is
	// buffered, so these writes coalesce into a single chunk on Flush.
	header := deferNextPartHeader
	if !f.wroteFirstPart {
		header = deferFirstPartHeader
	}
	if err = writeStringFull(f.writer, header); err != nil {
		return f.fail(err)
	}
	if err = writeBytesFull(f.writer, resp); err != nil {
		return f.fail(err)
	}
	if err = writeStringFull(f.writer, deferPartSuffix); err != nil {
		return f.fail(err)
	}

	// Reset state only after the complete frame reached the transport. A write
	// failure is terminal, but retaining the buffer avoids silently losing the
	// payload and makes the failure state observable in tests and diagnostics.
	f.buf.Reset()
	f.wroteFirstPart = true

	// Flush before closing the writer to ensure all data is sent
	f.flusher.Flush()

	return nil
}

// GetDeferResponseWriter configures an unbuffered multipart response and returns
// a writer bound to ctx. It returns false when w cannot flush streamed parts.
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
// payloads. It matches the representation emitted by GetDeferResponseWriter,
// including its deferSpec and boundary parameters, and accepts the multipart/*
// and */* wildcards. A missing or empty Accept header means any representation
// is acceptable (RFC 9110 section 12.5.1).
func clientAcceptsMultipartMixed(r *http.Request) bool {
	acceptHeader := strings.Join(r.Header.Values("Accept"), ",")
	if strings.TrimSpace(acceptHeader) == "" {
		return true
	}

	// Matching media parameters increase precedence within a media type. For
	// otherwise equal ranges, choose the highest q-value as a deterministic
	// duplicate-range policy.
	bestTypeSpecificity := -1
	bestParameterSpecificity := -1
	bestQuality := 0.0
	for element := range strings.SplitSeq(acceptHeader, ",") {
		if hasQuotedHTTPQuality(element) {
			continue
		}
		mediaType, params, err := mime.ParseMediaType(element)
		if err != nil {
			continue
		}

		typeSpecificity, parameterSpecificity, matches := deferMediaRangeSpecificity(mediaType, params)
		if !matches {
			continue
		}

		quality := 1.0
		if q, ok := params["q"]; ok {
			var valid bool
			quality, valid = parseHTTPQuality(q)
			if !valid {
				continue
			}
		}

		if typeSpecificity > bestTypeSpecificity ||
			(typeSpecificity == bestTypeSpecificity && parameterSpecificity > bestParameterSpecificity) ||
			(typeSpecificity == bestTypeSpecificity && parameterSpecificity == bestParameterSpecificity && quality > bestQuality) {
			bestTypeSpecificity = typeSpecificity
			bestParameterSpecificity = parameterSpecificity
			bestQuality = quality
		}
	}

	if bestTypeSpecificity < 0 {
		return false
	}
	return bestQuality > 0
}

// mime.ParseMediaType unquotes parameter values, so check the raw syntax before
// parsing to keep qvalues constrained to RFC 9110's token grammar.
func hasQuotedHTTPQuality(mediaRange string) bool {
	for parameter := range strings.SplitSeq(mediaRange, ";") {
		name, value, ok := strings.Cut(parameter, "=")
		if !ok || !strings.EqualFold(strings.TrimSpace(name), "q") {
			continue
		}
		return strings.HasPrefix(strings.TrimSpace(value), `"`)
	}
	return false
}

func deferMediaRangeSpecificity(mediaType string, params map[string]string) (typeSpecificity, parameterSpecificity int, matches bool) {
	switch mediaType {
	case multipartMime:
		typeSpecificity = 2
	case "multipart/*":
		typeSpecificity = 1
	case "*/*":
		typeSpecificity = 0
	default:
		return 0, 0, false
	}

	for name, value := range params {
		switch name {
		case "q":
			continue
		case "deferspec":
			if value != "20220824" {
				return 0, 0, false
			}
		case "boundary":
			if value != multipartBoundary {
				return 0, 0, false
			}
		default:
			return 0, 0, false
		}
		parameterSpecificity++
	}

	return typeSpecificity, parameterSpecificity, true
}

// parseHTTPQuality implements the qvalue grammar from RFC 9110 section 12.4.2:
// zero or one, optionally followed by a decimal point and up to three digits;
// fractions following one can contain only zeroes.
func parseHTTPQuality(value string) (float64, bool) {
	whole, fraction, hasFraction := strings.Cut(value, ".")
	if !hasFraction {
		switch whole {
		case "0":
			return 0, true
		case "1":
			return 1, true
		default:
			return 0, false
		}
	}
	if len(fraction) > 3 || (whole != "0" && whole != "1") {
		return 0, false
	}

	quality := 0.0
	factor := 0.1
	for _, digit := range fraction {
		if digit < '0' || digit > '9' || (whole == "1" && digit != '0') {
			return 0, false
		}
		quality += float64(digit-'0') * factor
		factor /= 10
	}
	if whole == "1" {
		return 1, true
	}
	return quality, true
}
