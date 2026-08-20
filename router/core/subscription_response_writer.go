package core

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
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
	subscriptionSpec     = "subscriptionSpec=1.0"
	multipartContent     = multipartMime + "; " + subscriptionSpec + "; boundary=" + multipartBoundary
	multipartStart       = "\r\n--" + multipartBoundary
)

type withFlushWriter interface {
	SubscriptionResponseWriter() resolve.SubscriptionResponseWriter
}

type SubscriptionResponseWriterOptions struct {
	ApolloSubscriptionMultipartPrintBoundary bool
	SSEWriteTimeout                          time.Duration
	Logger                                   *zap.Logger
	Stats                                    statistics.EngineStatistics
	Telemetry                                subscriptionTelemetryContext
}

type HttpFlushWriter struct {
	ctx             context.Context
	cancel          context.CancelFunc
	writer          io.Writer
	flusher         http.Flusher
	responseControl *http.ResponseController
	subscribeOnce   bool
	sse             bool
	multipart       bool
	buf             *bytes.Buffer
	firstMessage    bool
	sseWriteTimeout time.Duration
	logger          *zap.Logger
	stats           statistics.EngineStatistics
	telemetry       subscriptionTelemetryContext
	requestContext  context.Context
	disconnect      *subscriptionDisconnectTracker
	delivery        *subscriptionDeliveryTracker
	// apolloSubscriptionMultipartPrintBoundary if set to true will send the multipart boundary at the end of the message to allow
	// misbehaving client (like apollo client) to read the message just sent before the next one or the heartbeat
	apolloSubscriptionMultipartPrintBoundary bool
}

var _ resolve.SubscriptionResponseWriter = (*HttpFlushWriter)(nil)

func (f *HttpFlushWriter) Complete() {
	if f.ctx.Err() != nil {
		return
	}
	if f.sse {
		err := f.writeAndFlushSSE(func() error {
			_, err := f.writer.Write([]byte("event: complete\ndata: \n\n"))
			return err
		})
		observeSubscriptionFrame(f.stats, f.logger, f.telemetry, "complete", err)
		if err != nil {
			initiator, reason := disconnectReasonFromWriteError(err)
			f.disconnect.disconnect(initiator, reason, err)
		} else {
			f.disconnect.disconnect("server", "normal_completion", nil)
		}
	} else if f.multipart {
		// Write the final boundary in the multipart response
		if f.apolloSubscriptionMultipartPrintBoundary {
			_, _ = f.writer.Write([]byte("--\r\n"))
		} else {
			_, _ = f.writer.Write([]byte("--" + multipartBoundary + "--\r\n"))
		}
	}

	if !f.sse {
		// Flush before closing the writer to ensure all data is sent.
		f.flusher.Flush()
	}

	f.cancel()
}

func (f *HttpFlushWriter) Write(p []byte) (n int, err error) {
	if err = f.ctx.Err(); err != nil {
		err = wrapSubscriptionWriteError("buffer", err)
		if f.sse {
			f.delivery.observe(f.telemetry, p, 0, err)
			initiator, reason := disconnectReasonFromWriteError(err)
			f.disconnect.disconnect(initiator, reason, err)
		}
		return 0, err
	}

	return f.buf.Write(p)
}

func (f *HttpFlushWriter) Heartbeat() error {
	if err := f.ctx.Err(); err != nil {
		return err
	}

	var heartbeat []byte
	if f.sse {
		heartbeat = []byte(":heartbeat\n\n")
		err := f.writeAndFlushSSE(func() error {
			_, err := f.writer.Write(heartbeat)
			return err
		})
		observeSubscriptionFrame(f.stats, f.logger, f.telemetry, "heartbeat", err)
		if err != nil {
			initiator, reason := disconnectReasonFromWriteError(err)
			f.disconnect.disconnect(initiator, reason, err)
		}
		return err
	} else if f.multipart {
		if _, err := f.Write([]byte("{}")); err != nil {
			return err
		}

		if err := f.Flush(); err != nil {
			return err
		}
	}

	return nil
}

func (f *HttpFlushWriter) Error(data []byte) {
	if f.ctx.Err() != nil {
		return
	}
	_, _ = f.buf.Write(data)
	err := f.flush("terminal_error")
	if f.sse {
		observeSubscriptionFrame(f.stats, f.logger, f.telemetry, "terminal_error", err)
		if err != nil {
			initiator, reason := disconnectReasonFromWriteError(err)
			f.disconnect.disconnect(initiator, reason, err)
		} else {
			f.disconnect.disconnect("server", "normal_completion", nil)
		}
	}
	f.cancel()
}

func (f *HttpFlushWriter) subscriptionRequestEnded() {
	if !f.sse {
		return
	}
	if err := f.requestContext.Err(); err != nil {
		f.disconnect.disconnect("client", "context_canceled", err)
		return
	}
	f.disconnect.disconnect("server", "normal_completion", nil)
}

func (f *HttpFlushWriter) Flush() (err error) {
	return f.flush("next")
}

func (f *HttpFlushWriter) flush(frameType string) (err error) {
	if err = f.ctx.Err(); err != nil {
		if f.sse && frameType == "next" {
			err = wrapSubscriptionWriteError("buffer", err)
			f.delivery.observe(f.telemetry, f.buf.Bytes(), 0, err)
			initiator, reason := disconnectReasonFromWriteError(err)
			f.disconnect.disconnect(initiator, reason, err)
		}
		return err
	}

	resp := f.buf.Bytes()
	f.buf.Reset()

	flushBreak := GetWriterPrefix(f.sse, f.multipart, !f.apolloSubscriptionMultipartPrintBoundary || f.firstMessage)
	if f.firstMessage {
		f.firstMessage = false
	}
	if f.multipart && len(resp) > 0 {
		var err error
		resp, err = wrapMultipartMessage(resp, true)
		if err != nil {
			return err
		}
	}

	separation := "\n\n"
	if f.multipart {
		if !f.apolloSubscriptionMultipartPrintBoundary {
			separation = "\r\n"
		} else {
			separation = "\r\n" + multipartStart
		}
	} else if f.subscribeOnce {
		separation = ""
	}

	// resp sometimes ends with newlines. We need to remove them
	// to cleanly add the seperation in the next step.
	if bytes.HasSuffix(resp, []byte{'\n'}) {
		resp = bytes.TrimRight(resp, "\n")
	}

	full := flushBreak + string(resp) + separation
	if f.sse {
		started := time.Now()
		err = f.writeAndFlushSSE(func() error {
			_, writeErr := f.writer.Write([]byte(full))
			return writeErr
		})
		if frameType == "next" {
			f.delivery.observe(f.telemetry, []byte(full), time.Since(started), err)
			if err != nil {
				initiator, reason := disconnectReasonFromWriteError(err)
				f.disconnect.disconnect(initiator, reason, err)
			}
		}
	} else {
		_, err = f.writer.Write([]byte(full))
		if err == nil {
			// Flush before closing the writer to ensure all data is sent.
			f.flusher.Flush()
		}
	}
	if err != nil {
		return err
	}

	if f.subscribeOnce {
		defer f.cancel()
	}

	return nil
}

func (f *HttpFlushWriter) writeAndFlushSSE(write func() error) error {
	if f.sseWriteTimeout > 0 {
		if err := f.responseControl.SetWriteDeadline(time.Now().Add(f.sseWriteTimeout)); err != nil {
			// Failing closed prevents a response writer without deadline support from
			// reintroducing an unbounded shared-trigger stall.
			return wrapSubscriptionWriteError("deadline", fmt.Errorf("set SSE write deadline: %w", err))
		}
	}

	if err := write(); err != nil {
		return wrapSubscriptionWriteError("write", err)
	}

	return wrapSubscriptionWriteError("flush", f.responseControl.Flush())
}

func GetSubscriptionResponseWriter(ctx *resolve.Context, r *http.Request, w http.ResponseWriter, opts SubscriptionResponseWriterOptions) (*resolve.Context, resolve.SubscriptionResponseWriter, error) {
	if wfw, ok := w.(withFlushWriter); ok {
		return ctx, wfw.SubscriptionResponseWriter(), nil
	}
	wgParams := NegotiateSubscriptionParams(r, false)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return ctx, nil, errors.New("subscription response writer does not support flushing")
	}

	setSubscriptionHeaders(wgParams, r, w)

	flushWriter := &HttpFlushWriter{
		writer:                                   w,
		flusher:                                  flusher,
		responseControl:                          http.NewResponseController(w),
		sse:                                      wgParams.UseSse,
		multipart:                                wgParams.UseMultipart,
		subscribeOnce:                            wgParams.SubscribeOnce,
		buf:                                      &bytes.Buffer{},
		firstMessage:                             true,
		sseWriteTimeout:                          opts.SSEWriteTimeout,
		logger:                                   opts.Logger,
		stats:                                    opts.Stats,
		telemetry:                                opts.Telemetry,
		requestContext:                           r.Context(),
		apolloSubscriptionMultipartPrintBoundary: opts.ApolloSubscriptionMultipartPrintBoundary,
	}
	if flushWriter.sse {
		flushWriter.disconnect = newSubscriptionDisconnectTracker(flushWriter.stats, flushWriter.logger, flushWriter.telemetry)
		flushWriter.delivery = newSubscriptionDeliveryTracker(flushWriter.stats, flushWriter.logger, "")
	}

	flushWriter.ctx, flushWriter.cancel = context.WithCancel(ctx.Context())
	ctx = ctx.WithContext(flushWriter.ctx)

	if wgParams.UseMultipart || wgParams.UseSse {
		ctx.ExecutionOptions.SendHeartbeat = true
		// Flush the response head immediately so the client establishes the connection
		// before the first message, instead of blocking until one is streamed.
		if wgParams.UseSse {
			err := flushWriter.writeAndFlushSSE(func() error { return nil })
			observeSubscriptionFrame(flushWriter.stats, flushWriter.logger, flushWriter.telemetry, "headers", err)
			if err != nil {
				initiator, reason := disconnectReasonFromWriteError(err)
				flushWriter.disconnect.disconnect(initiator, reason, err)
				flushWriter.cancel()
				return ctx, nil, fmt.Errorf("flush initial SSE response headers: %w", err)
			}
		} else {
			flusher.Flush()
		}
	}

	return ctx, flushWriter, nil
}

func wrapMultipartMessage(resp []byte, wrapPayload bool) ([]byte, error) {
	if string(resp) == heartbeat {
		return resp, nil
	}

	respValuePreMerge, err := astjson.ParseBytes(resp)
	if err != nil {
		return nil, err
	}

	if !wrapPayload {
		return respValuePreMerge.MarshalTo(nil), nil
	}

	// Per the Apollo docs, multipart messages are supposed to be json, wrapped in `"payload"`
	// for subscriptions
	payloadWrapper, err := astjson.Parse(`{"payload": {}}`)
	if err != nil {
		return nil, err
	}
	respValue, _, err := astjson.MergeValuesWithPath(nil, payloadWrapper, respValuePreMerge, "payload")
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

func NegotiateSubscriptionParams(r *http.Request, preferJson bool) SubscriptionParams {
	q := r.URL.Query()
	acceptHeaders := r.Header.Get("Accept")
	elements := strings.Split(acceptHeaders, ",")
	// Per RFC 9110, Accept header can be in the form`text/event-stream,application/json`, with an optional q-value to
	// specify preference. We want to parse this and find the best option to use, and default to the first option if no
	// q-value is provided.
	// Eventually a solution will be in the stdlib: see https://github.com/golang/go/issues/19307, at which point we should
	// remove this
	var (
		useMultipart bool
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

		// We also have an exception where we prioritize json over higher priority media types
		if preferJson && strings.EqualFold(mediaType, jsonContent) {
			bestType = mediaType
			break
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

func GetWriterPrefix(sse bool, multipart bool, firstMessage bool) string {
	flushBreak := ""
	if sse {
		flushBreak = "event: next\ndata: "
	} else if multipart {
		messageStart := ""
		if firstMessage {
			messageStart = multipartStart
		}
		flushBreak = messageStart + "\r\nContent-Type: " + jsonContent + "\r\n\r\n"
	}

	return flushBreak
}
