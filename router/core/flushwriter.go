package core

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/mattbaird/jsonpatch"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

const (
	WgPrefix             = "wg_"
	WgJsonPatchParam     = WgPrefix + "json_patch"
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
	useJsonPatch  bool
	buf           *bytes.Buffer
	lastMessage   *bytes.Buffer
	variables     []byte
	logger        *zap.Logger
	mux           sync.Mutex
}

func (f *HttpFlushWriter) Complete() {
	f.Close()
}

func (f *HttpFlushWriter) Write(p []byte) (n int, err error) {
	return f.buf.Write(p)
}

func (f *HttpFlushWriter) Close() {
	f.cancel()
}

func (f *HttpFlushWriter) Flush() {

	f.mux.Lock()
	defer f.mux.Unlock()

	resp := f.buf.Bytes()
	f.buf.Reset()

	if f.useJsonPatch && f.lastMessage.Len() != 0 {
		last := f.lastMessage.Bytes()
		patch, err := jsonpatch.CreatePatch(last, resp)
		if err != nil {
			if f.logger != nil {
				f.logger.Error("subscription json patch", zap.Error(err))
			}
			return
		}
		if len(patch) == 0 {
			// no changes
			return
		}
		patchData, err := json.Marshal(patch)
		if err != nil {
			if f.logger != nil {
				f.logger.Error("subscription json patch", zap.Error(err))
			}
			return
		}
		if f.sse {
			_, _ = f.writer.Write([]byte("data: "))
		}
		if len(patchData) < len(resp) {
			_, _ = f.writer.Write(patchData)
		} else {
			_, _ = f.writer.Write(resp)
		}
	}

	if f.lastMessage.Len() == 0 || !f.useJsonPatch {
		if f.sse {
			_, _ = f.writer.Write([]byte("data: "))
		}
		_, _ = f.writer.Write(resp)
	}

	f.lastMessage.Reset()
	_, _ = f.lastMessage.Write(resp)

	if f.subscribeOnce {
		f.flusher.Flush()
		f.cancel()
		return
	}
	_, _ = f.writer.Write([]byte("\n\n"))
	f.flusher.Flush()
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

	w.WriteHeader(http.StatusOK)

	/*// hijack the connection
	hj, ok := w.(http.Hijacker)
	if !ok {
		return ctx, nil, false
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return ctx, nil, false
	}*/

	flushWriter := &HttpFlushWriter{
		writer:       w,
		flusher:      flusher,
		sse:          wgParams.UseSse,
		useJsonPatch: wgParams.UseJsonPatch,
		buf:          &bytes.Buffer{},
		lastMessage:  &bytes.Buffer{},
		ctx:          ctx.Context(),
		variables:    variables,
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
		UseJsonPatch:  q.Has(WgJsonPatchParam),
		UseSse:        q.Has(WgSseParam),
		SubscribeOnce: q.Has(WgSubscribeOnceParam),
	}
}

type WgRequestParams struct {
	UseJsonPatch  bool
	UseSse        bool
	SubscribeOnce bool
}
