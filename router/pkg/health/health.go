package health

import (
	"net/http"
	"sync/atomic"

	"go.uber.org/zap"
)

// Checker defines an interface that must be implemented by a health checker to
// determine if the router can currently accept traffic.
type Checker interface {
	// Liveness returns a handler that returns 200 OK if the server is alive (running).
	Liveness() http.HandlerFunc

	// Readiness returns a handler that returns 200 OK if the server is ready to accept traffic
	// and 503 Service Unavailable if the server is not ready to serve traffic.
	Readiness() http.HandlerFunc

	// SetReady should atomatically be set to true when the server is ready to accept traffic.
	SetReady(isReady bool)
}

var _ Checker = (*Checks)(nil)

type Checks struct {
	options *Options
	isReady atomic.Bool
}

type Options struct {
	Logger *zap.Logger
}

func New(opts *Options) *Checks {
	return &Checks{
		options: opts,
	}
}

// Liveness returns a handler that returns 200 OK if the server is alive (running).
func (c *Checks) Liveness() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("OK"))
	}
}

// Readiness returns a handler that returns 200 OK if the server is ready to accept traffic
// and 503 Service Unavailable if the server is not ready to serve traffic.
func (c *Checks) Readiness() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		if !c.isReady.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("OK"))
	}
}

// SetReady sets the readiness state to the given value
func (c *Checks) SetReady(isReady bool) {
	c.isReady.Swap(isReady)
}
