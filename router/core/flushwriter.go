package core

import (
	"bytes"
	"context"
	"github.com/wundergraph/astjson"
	"mime"
	"net/http"
	"sync"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	WgPrefix                   = "wg_"
	WgSseParam                 = WgPrefix + "sse"
	WgSubscribeOnceParam       = WgPrefix + "subscribe_once"
	multipartBoundary          = "graphql"
	multipartHeartbeatInterval = 5
	multipartAcceptHeader      = "multipart/mixed;subscriptionSpec=\"1.0\", application/json"
	jsonContent                = "application/json"
	sseMimeType                = "text/event-stream"
	PayloadString              = `{"payload": {}}`
)

type HttpFlushWriter struct {
	ctx           context.Context
	cancel        context.CancelFunc
	writer        http.ResponseWriter
	flusher       http.Flusher
	subscribeOnce bool
	sse           bool
	multipart     bool
	buf           *bytes.Buffer
	variables     []byte
	ticker        *time.Ticker // Ticker used for multipart heartbeats
	mu            *sync.Mutex
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
	if f.ticker != nil {
		f.ticker.Stop()
	}

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
	if flushBreak != "" {
		_, err = f.writer.Write([]byte(flushBreak))
		if err != nil {
			return err
		}
	}

	if f.multipart && len(resp) > 0 {
		var err error
		resp, err = wrapMultipartMessage(resp)
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
	separation := "\n\n"
	if f.multipart {
		separation = "\n"
	}
	_, err = f.writer.Write([]byte(separation))
	if err != nil {
		return err
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	f.flusher.Flush()
	return nil
}

func (f *HttpFlushWriter) StartHeartbeat() {
	if f.multipart {
		f.ticker = time.NewTicker(multipartHeartbeatInterval * time.Second)
		go func() {
			defer f.ticker.Stop()
			for {
				select {
				// Stop sending heartbeats when context is canceled
				case <-f.ctx.Done():
					return
				case <-f.ticker.C:
					f.sendHeartbeat()
				}
			}
		}()
	}
}

func (f *HttpFlushWriter) sendHeartbeat() {
	if f.ctx.Err() != nil {
		return
	}
	heartbeat := GetWriterPrefix(f.sse, f.multipart) + "{}\n"
	_, err := f.writer.Write([]byte(heartbeat))
	if err != nil {
		return
	}

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

	setSubscriptionHeaders(wgParams, r, w)

	flushWriter := &HttpFlushWriter{
		writer:        w,
		flusher:       flusher,
		sse:           wgParams.UseSse,
		multipart:     wgParams.UseMultipart,
		subscribeOnce: wgParams.SubscribeOnce,
		buf:           &bytes.Buffer{},
		ctx:           ctx.Context(),
		variables:     variables,
		mu:            &sync.Mutex{},
	}

	flushWriter.ctx, flushWriter.cancel = context.WithCancel(ctx.Context())
	ctx = ctx.WithContext(flushWriter.ctx)

	if wgParams.UseMultipart {
		flushWriter.StartHeartbeat()
	}

	return ctx, flushWriter, true
}

func wrapMultipartMessage(resp []byte) ([]byte, error) {
	// Per the Apollo docs, multipart messages are supposed to be json, wrapped in ` "payload"`
	a, err := astjson.Parse(`{"payload": {}}`)
	if err != nil {
		return nil, err
	}

	b, err := astjson.ParseBytes(resp)
	if err != nil {
		return nil, err
	}

	respValue, _ := astjson.MergeValuesWithPath(a, b, "payload")
	return respValue.MarshalTo(nil), nil
}

func setSubscriptionHeaders(wgParams WgRequestParams, r *http.Request, w http.ResponseWriter) {
	if wgParams.SubscribeOnce {
		return
	}

	if wgParams.UseMultipart {
		w.Header().Set("Content-Type", jsonContent)
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

func NewWgRequestParams(r *http.Request) WgRequestParams {
	q := r.URL.Query()
	acceptHeader := r.Header.Get("Accept")

	contentType := r.Header.Get("Content-Type")
	d, _, _ := mime.ParseMediaType(contentType)

	return WgRequestParams{
		UseSse:        q.Has(WgSseParam) || d == sseMimeType,
		SubscribeOnce: q.Has(WgSubscribeOnceParam),
		UseMultipart:  acceptHeader == multipartAcceptHeader,
	}
}

type WgRequestParams struct {
	UseSse        bool
	SubscribeOnce bool
	UseMultipart  bool
}

func GetWriterPrefix(sse bool, multipart bool) string {
	flushBreak := ""
	if sse {
		flushBreak = "event: next\ndata: "
	} else if multipart {
		flushBreak = "--" + multipartBoundary + "\nContent-Type: " + jsonContent + "\n\n"
	}

	return flushBreak
}
