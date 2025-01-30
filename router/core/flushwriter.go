package core

import (
	"bytes"
	"context"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
)

const (
	WgPrefix             = "wg_"
	WgSseParam           = WgPrefix + "sse"
	WgSubscribeOnceParam = WgPrefix + "subscribe_once"
	multipartBoundary    = "graphql"
	multipartMime        = "multipart/mixed"
	jsonContent          = "application/json"
	sseMimeType          = "text/event-stream"
	heartbeat            = "{}"
	multipartContent     = multipartMime + "; boundary=" + multipartBoundary
)

type HttpFlushWriter struct {
	ctx           context.Context
	cancel        context.CancelFunc
	writer        io.Writer
	flusher       http.Flusher
	subscribeOnce bool
	sse           bool
	multipart     bool
	buf           *bytes.Buffer
}

func (f *HttpFlushWriter) Complete() {
	if f.ctx.Err() != nil {
		return
	}
	if f.sse {
		_, _ = f.writer.Write([]byte("event: complete"))
	} else if f.multipart {
		// Write the final boundary in the multipart response
		_, _ = f.writer.Write([]byte("--" + multipartBoundary + "--\n"))
	}
	f.Close()
}

func (f *HttpFlushWriter) Write(p []byte) (n int, err error) {
	if err = f.ctx.Err(); err != nil {
		return
	}

	return f.buf.Write(p)
}

func (f *HttpFlushWriter) Close() {
	if f.ctx.Err() != nil {
		return
	}

	f.cancel()
}

func (f *HttpFlushWriter) Flush() (err error) {
	if err = f.ctx.Err(); err != nil {
		return err
	}

	resp := f.buf.Bytes()
	f.buf.Reset()

	flushBreak := GetWriterPrefix(f.sse, f.multipart)
	if f.multipart && len(resp) > 0 {
		var err error
		resp, err = wrapMultipartMessage(resp)
		if err != nil {
			return err
		}
	}

	separation := "\n\n"
	if f.multipart {
		separation = "\n"
	} else if f.subscribeOnce {
		separation = ""
	}

	full := flushBreak + string(resp) + separation
	_, err = f.writer.Write([]byte(full))
	if err != nil {
		return err
	}
	f.flusher.Flush()
	if f.subscribeOnce {
		defer f.Close()
	}
	return nil
}

func GetSubscriptionResponseWriter(ctx *resolve.Context, r *http.Request, w http.ResponseWriter) (*resolve.Context, resolve.SubscriptionResponseWriter, bool) {
	type withFlushWriter interface {
		SubscriptionResponseWriter() resolve.SubscriptionResponseWriter
	}
	if wfw, ok := w.(withFlushWriter); ok {
		return ctx, wfw.SubscriptionResponseWriter(), true
	}
	wgParams := NegotiateSubscriptionParams(r)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return ctx, nil, false
	}

	setSubscriptionHeaders(wgParams, r, w)

	flusher.Flush()

	flushWriter := &HttpFlushWriter{
		writer:        w,
		flusher:       flusher,
		sse:           wgParams.UseSse,
		multipart:     wgParams.UseMultipart,
		subscribeOnce: wgParams.SubscribeOnce,
		buf:           &bytes.Buffer{},
	}

	flushWriter.ctx, flushWriter.cancel = context.WithCancel(ctx.Context())
	ctx = ctx.WithContext(flushWriter.ctx)

	if wgParams.UseMultipart {
		ctx.ExecutionOptions.SendHeartbeat = true
	}

	return ctx, flushWriter, true
}

func wrapMultipartMessage(resp []byte) ([]byte, error) {
	if string(resp) == heartbeat {
		return resp, nil
	}

	// Per the Apollo docs, multipart messages are supposed to be json, wrapped in ` "payload"`
	a, err := astjson.Parse(`{"payload": {}}`)
	if err != nil {
		return nil, err
	}

	b, err := astjson.ParseBytes(resp)
	if err != nil {
		return nil, err
	}

	respValue, _, err := astjson.MergeValuesWithPath(a, b, "payload")
	if err != nil {
		return nil, err
	}
	return respValue.MarshalTo(nil), nil
}

// setSubscriptionHeaders sets the headers for the subscription response. Only used for non-websocket subscriptions.
func setSubscriptionHeaders(wgParams SubscriptionParams, r *http.Request, w http.ResponseWriter) {
	if wgParams.SubscribeOnce {
		return
	}

	if wgParams.UseMultipart {
		w.Header().Set("Content-Type", multipartContent)
		if r.ProtoMajor == 1 {
			w.Header().Set("Transfer-Encoding", "chunked")
		}
	} else if wgParams.UseSse {
		w.Header().Set("Content-Type", sseMimeType)
	}

	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// allow unbuffered responses, it's used when it's necessary just to pass response through
	// setting this to “yes” will allow the response to be cached
	w.Header().Set("X-Accel-Buffering", "no")
}

func NegotiateSubscriptionParams(r *http.Request) SubscriptionParams {
	q := r.URL.Query()
	acceptHeaders := r.Header.Get("Accept")
	elements := strings.Split(acceptHeaders, ",")
	// Per RFC 9110, Accept header can be in the form`text/event-stream,application/json`, with an optional q-value to
	// specify preference. We want to parse this and find the best option to use, and default to the first option if no
	// q-value is provided.
	// Eventually a solution will be in the stdlib: see https://github.com/golang/go/issues/19307, at which point we should
	// remove this
	var (
		useMultipart = false
		useSse       = q.Has(WgSseParam)
		bestType     = ""
		bestQ        = -1.0 // Default to lowest possible q-value
	)

	for _, acceptHeader := range elements {
		mediaType, params, _ := mime.ParseMediaType(acceptHeader)
		qValue := 1.0                            // Default quality factor
		if qStr, exists := params["q"]; exists { // If a quality factor exists, parse it and prefer it
			if parsedQ, err := strconv.ParseFloat(qStr, 64); err == nil {
				qValue = parsedQ
			}
		}

		// Find the media type with the highest q-value. If none is provided, it will default to the first option
		// in the header, per https://www.rfc-editor.org/rfc/rfc9110.html#name-accept
		if qValue > bestQ {
			bestQ = qValue
			bestType = mediaType
		}
	}
	subscribeOnce := q.Has(WgSubscribeOnceParam)
	useSse = useSse || bestType == sseMimeType
	useMultipart = bestType == multipartMime

	return SubscriptionParams{
		UseSse:        useSse,
		SubscribeOnce: subscribeOnce,
		UseMultipart:  useMultipart,
	}
}

type SubscriptionParams struct {
	UseSse        bool
	SubscribeOnce bool
	UseMultipart  bool
}

func GetWriterPrefix(sse bool, multipart bool) string {
	flushBreak := ""
	if sse {
		flushBreak = "event: next\ndata: "
	} else if multipart {
		flushBreak = "\r\n--" + multipartBoundary + "\nContent-Type: " + jsonContent + "\r\n\r\n"
	}

	return flushBreak
}
