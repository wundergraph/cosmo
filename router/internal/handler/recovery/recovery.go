package recovery

import (
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"go.uber.org/zap"
)

// handler returns a http.Handler with a custom recovery handler
// that recovers from any panics and logs requests using uber-go/zap.
// All errors are logged using zap.Error().
// stack means whether output the stack info.
type handler struct {
	handler    http.Handler
	logger     *zap.Logger
	printStack bool
}

// Option provides a functional approach to define
// configuration for a handler; such as setting the logging
// whether to print stack traces on panic.
type Option func(handler *handler)

func parseOptions(r *handler, opts ...Option) http.Handler {
	for _, option := range opts {
		option(r)
	}

	if r.logger == nil {
		r.logger = zap.NewNop()
	}

	return r
}

func WithPrintStack() Option {
	return func(r *handler) {
		r.printStack = true
	}
}

func WithLogger(logger *zap.Logger) Option {
	return func(r *handler) {
		r.logger = logger
	}
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
			w.WriteHeader(http.StatusInternalServerError)

			// Check for a broken connection, as it is not really a
			// condition that warrants a panic stack trace.
			var brokenPipe bool
			if ne, ok := err.(*net.OpError); ok {
				if se, ok := ne.Err.(*os.SyscallError); ok {
					if strings.Contains(strings.ToLower(se.Error()), "broken pipe") || strings.Contains(strings.ToLower(se.Error()), "connection reset by peer") {
						brokenPipe = true
					}
				}
			}

			httpRequest, _ := httputil.DumpRequest(r, false)
			if brokenPipe {
				h.logger.Error(r.URL.Path,
					zap.Any("error", err),
					zap.String("request", string(httpRequest)),
				)
				return
			}

			if h.printStack {
				h.logger.Error("[Recovery from panic]",
					zap.Time("time", time.Now()),
					zap.Any("error", err),
					zap.String("request", string(httpRequest)),
					zap.String("stack", string(debug.Stack())),
				)
			} else {
				h.logger.Error("[Recovery from panic]",
					zap.Time("time", time.Now()),
					zap.Any("error", err),
					zap.String("request", string(httpRequest)),
				)
			}
		}
	}()

	h.handler.ServeHTTP(w, r)
}
