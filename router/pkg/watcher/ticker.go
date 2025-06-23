package watcher

import "time"

// TickSource interface so that we can use this to create custom tickers for testing
type TickSource interface {
	C() <-chan time.Time
	Stop()
	Reset(d time.Duration)
}

// The Real Ticker which implements TickSource interface
type RealTicker struct {
	ticker *time.Ticker
}

func NewRealTicker(d time.Duration) *RealTicker {
	return &RealTicker{ticker: time.NewTicker(d)}
}

func (r *RealTicker) C() <-chan time.Time {
	return r.ticker.C
}

func (r *RealTicker) Stop() {
	r.ticker.Stop()
}

func (r *RealTicker) Reset(d time.Duration) {
	r.ticker.Reset(d)
}

// Custom ticker for tests only
type ManualTicker struct {
	ch chan time.Time
}

func NewManualTicker() *ManualTicker {
	return &ManualTicker{ch: make(chan time.Time)}
}

func (m *ManualTicker) C() <-chan time.Time {
	return m.ch
}

func (m *ManualTicker) Stop() {}

func (m *ManualTicker) Tick(t time.Time) {
	m.ch <- t
	time.Sleep(10 * time.Millisecond)
}

func (m *ManualTicker) Reset(d time.Duration) {
	// No-op for manual ticker
}
