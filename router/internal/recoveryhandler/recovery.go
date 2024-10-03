package recoveryhandler

import (
	"net/http"
)

// handler returns a http.Handler with a custom recovery handler
// that recovers from any panics and returns a 500 Internal Server Error.
type handler struct {
	handler http.Handler
}

// Option provides a functional approach to define
// configuration for a handler; such as setting the logging
// whether to print stack traces on panic.
type Option func(handler *handler)

func parseOptions(r *handler, opts ...Option) http.Handler {
	for _, option := range opts {
		option(r)
	}
	return r
}

func New(opts ...Option) func(h http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		r := &handler{handler: h}
		return parseOptions(r, opts...)
	}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {

			if err == http.ErrAbortHandler {
				// we don't recover http.ErrAbortHandler so the response
				// to the client is aborted, this should not be logged
				panic(err)
			}

			if r.Header.Get("Connection") != "Upgrade" {
				w.WriteHeader(http.StatusInternalServerError)
			}
		}
	}()

	h.handler.ServeHTTP(w, r)
}
