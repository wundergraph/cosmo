// Package sse_slow_client reports SSE subscriptions that the router drops because
// the client did not read a message within engine.sse_server_write_timeout.
//
// The router itself records nothing when this happens: the access log, metrics
// and trace look the same as for a client that disconnected on its own.
package sse_slow_client

import (
	"net/http"
	"sync/atomic"
	"time"

	"github.com/wundergraph/cosmo/router/core"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

const (
	moduleID = "sseSlowClientModule"

	// MeterName is the name of the meter that owns the drop counter.
	MeterName = "cosmo.router.module.sse_slow_client"
	// DropCounterName counts SSE subscriptions dropped for a write timeout.
	DropCounterName = "router.sse.slow_client.drops"
	// DropLogMessage is the warning logged for each dropped subscription.
	DropLogMessage = "SSE client dropped: write timeout exceeded"
	// DropSpanEventName is the event added to the request span for each drop.
	DropSpanEventName = "sse.slow_client.dropped"
)

type SSESlowClientModule struct {
	// MeterProvider creates the drop counter. Defaults to the global provider,
	// which is the router's OTLP meter provider.
	MeterProvider metric.MeterProvider `mapstructure:"-"`

	logger *zap.Logger
	drops  metric.Int64Counter
}

func (m *SSESlowClientModule) Provision(ctx *core.ModuleContext) error {
	m.logger = ctx.Logger

	provider := m.MeterProvider
	if provider == nil {
		provider = otel.GetMeterProvider()
	}

	drops, err := provider.Meter(MeterName).Int64Counter(
		DropCounterName,
		metric.WithDescription("SSE subscriptions dropped because a write to the client exceeded the write timeout"),
	)
	if err != nil {
		return err
	}
	m.drops = drops

	return nil
}

func (m *SSESlowClientModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	request := ctx.Request()

	// The router only sets a write deadline for SSE responses.
	if !core.NegotiateSubscriptionParams(request, false).UseSse {
		next.ServeHTTP(ctx.ResponseWriter(), request)
		return
	}

	writer := &deadlineObservingWriter{
		ResponseWriter: ctx.ResponseWriter(),
		controller:     http.NewResponseController(ctx.ResponseWriter()),
		request:        request,
	}
	writer.onDrop = func(waited time.Duration) {
		m.drops.Add(request.Context(), 1)
		trace.SpanFromContext(request.Context()).AddEvent(
			DropSpanEventName,
			trace.WithAttributes(attribute.Int64("sse.write_wait_ms", waited.Milliseconds())),
		)
		// ctx.Logger() carries the request fields, such as the request ID.
		ctx.Logger().Warn(DropLogMessage,
			zap.Duration("write_wait", waited),
			zap.String("protocol", request.Proto),
		)
	}

	next.ServeHTTP(writer, request)
}

func (m *SSESlowClientModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &SSESlowClientModule{MeterProvider: m.MeterProvider}
		},
	}
}

// deadlineObservingWriter detects a write that ran into the router's write deadline.
//
// The deadline error itself never reaches a custom writer: the router's compression
// wrapper flushes without returning an error. What is observable is that the HTTP
// server cancels the request context when the connection write fails. A cancelled
// context right after a flush, at or past the deadline of that write, therefore
// means the write timed out. A client that disconnects on its own also cancels the
// context, but before the deadline.
type deadlineObservingWriter struct {
	http.ResponseWriter
	controller *http.ResponseController
	request    *http.Request
	onDrop     func(waited time.Duration)

	// Unix nanoseconds. The router sets a deadline before each write and clears
	// it afterwards; the cleared value is not stored, so the last deadline stays
	// available to FlushError.
	deadlineSetAt atomic.Int64
	deadline      atomic.Int64
	reported      atomic.Bool
}

// SetWriteDeadline is required for the router to keep the SSE write timeout when
// the response writer is wrapped.
func (w *deadlineObservingWriter) SetWriteDeadline(deadline time.Time) error {
	if !deadline.IsZero() {
		w.deadlineSetAt.Store(time.Now().UnixNano())
		w.deadline.Store(deadline.UnixNano())
	}
	return w.controller.SetWriteDeadline(deadline)
}

// Flush is required for streaming responses.
func (w *deadlineObservingWriter) Flush() {
	_ = w.FlushError()
}

func (w *deadlineObservingWriter) FlushError() error {
	err := w.controller.Flush()

	deadline := w.deadline.Load()
	if deadline == 0 || w.request.Context().Err() == nil {
		return err
	}

	now := time.Now().UnixNano()
	if now >= deadline && w.reported.CompareAndSwap(false, true) {
		w.onDrop(time.Duration(now - w.deadlineSetAt.Load()))
	}

	return err
}

// Unwrap lets http.ResponseController reach the other optional interfaces of the
// wrapped writer.
func (w *deadlineObservingWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// Interface guards
var (
	_ core.RouterOnRequestHandler = (*SSESlowClientModule)(nil)
	_ core.Provisioner            = (*SSESlowClientModule)(nil)
)
