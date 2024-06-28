package core

import (
	"bytes"
	"context"
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	WgPrefix             = "wg_"
	WgSseParam           = WgPrefix + "sse"
	WgSubscribeOnceParam = WgPrefix + "subscribe_once"
)

type HttpFlushWriter struct {
	ctx           context.Context
	cancel        context.CancelFunc
	writer        http.ResponseWriter
	flusher       http.Flusher
	subscribeOnce bool
	sse           bool
	buf           *bytes.Buffer
	variables     []byte
}

func (f *HttpFlushWriter) Complete() {
	if f.ctx.Err() != nil {
		return
	}
	if f.sse {
		_, _ = f.writer.Write([]byte("event: complete"))
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

	if f.sse {
		_, err = f.writer.Write([]byte("event: next\ndata: "))
		if err != nil {
			return err
		}
	}
	_, err = f.writer.Write(resp)
	if err != nil {
		return err
	}

	if f.subscribeOnce {
		f.flusher.Flush()
		f.cancel()
		return
	}
	_, err = f.writer.Write([]byte("\n\n"))
	if err != nil {
		return err
	}
	f.flusher.Flush()
	return nil
}

func GetSubscriptionResponseWriter(ctx *resolve.Context, variables []byte, r *http.Request, w http.ResponseWriter) (*resolve.Context, resolve.SubscriptionResponseWriter, bool) {
	type withFlushWriter interface {
		SubscriptionResponseWriter() resolve.SubscriptionResponseWriter
	}
	if wfw, ok := w.(withFlushWriter); ok {
		return ctx, wfw.SubscriptionResponseWriter(), true
	}
	wgParams := NewWgRequestParams(r)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return ctx, nil, false
	}

	if !wgParams.SubscribeOnce {
		setSubscriptionHeaders(w)
	}

	flushWriter := &HttpFlushWriter{
		writer:    w,
		flusher:   flusher,
		sse:       wgParams.UseSse,
		buf:       &bytes.Buffer{},
		ctx:       ctx.Context(),
		variables: variables,
	}
	if wgParams.SubscribeOnce {
		flushWriter.subscribeOnce = true
	}
	flushWriter.ctx, flushWriter.cancel = context.WithCancel(ctx.Context())
	ctx = ctx.WithContext(flushWriter.ctx)

	return ctx, flushWriter, true
}

func setSubscriptionHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// allow unbuffered responses, it's used when it's necessary just to pass response through
	// setting this to “yes” will allow the response to be cached
	w.Header().Set("X-Accel-Buffering", "no")
}

func NewWgRequestParams(r *http.Request) WgRequestParams {
	q := r.URL.Query()
	return WgRequestParams{
		UseSse:        q.Has(WgSseParam),
		SubscribeOnce: q.Has(WgSubscribeOnceParam),
	}
}

type WgRequestParams struct {
	UseSse        bool
	SubscribeOnce bool
}
