package metric

import (
	"context"
	"github.com/cep21/circuit/v4"
	"time"
)

type WrapperMetrics struct {
	metrics Store
}

func (w *WrapperMetrics) Constructor(name string) circuit.Config {
	return circuit.Config{
		Metrics: circuit.MetricsCollectors{
			Circuit: []circuit.Metrics{w},
			Run:     []circuit.RunMetrics{w},
		},
	}
}

func (w *WrapperMetrics) Closed(ctx context.Context, now time.Time) {
	w.metrics.MeasureRequestCount()
}

func (w *WrapperMetrics) Opened(ctx context.Context, now time.Time) {

}

func (w *WrapperMetrics) ErrShortCircuit(ctx context.Context, now time.Time) {}

// No-op functions required to satisfy the interface
func (w *WrapperMetrics) Success(ctx context.Context, now time.Time, duration time.Duration)       {}
func (w *WrapperMetrics) ErrFailure(ctx context.Context, now time.Time, duration time.Duration)    {}
func (w *WrapperMetrics) ErrTimeout(ctx context.Context, now time.Time, duration time.Duration)    {}
func (w *WrapperMetrics) ErrBadRequest(ctx context.Context, now time.Time, duration time.Duration) {}
func (w *WrapperMetrics) ErrInterrupt(ctx context.Context, now time.Time, duration time.Duration)  {}
func (w *WrapperMetrics) ErrConcurrencyLimitReject(ctx context.Context, now time.Time)             {}
