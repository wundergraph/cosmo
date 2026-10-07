package core

import (
	"io"
	"net/http"

	"github.com/felixge/httpsnoop"
)

// drainResponseWriter checks the drain state when response headers are committed,
// including for requests that started before draining. Already-sent headers
// cannot be changed. Standard server writers need only one wrapper allocation.
func (s *server) drainResponseWriter(w http.ResponseWriter) (http.ResponseWriter, *drainWriter) {
	if _, ok := w.(serverHTTP1Writer); ok {
		if _, pushes := w.(http.Pusher); !pushes {
			wrapped := &drainHTTP1ResponseWriter{drainWriter: drainWriter{ResponseWriter: w, server: s}}
			return wrapped, &wrapped.drainWriter
		}
	}
	if _, ok := w.(serverHTTP2Writer); ok {
		_, hijacks := w.(http.Hijacker)
		_, copies := w.(io.ReaderFrom)
		if !hijacks && !copies {
			wrapped := &drainHTTP2ResponseWriter{drainWriter: drainWriter{ResponseWriter: w, server: s}}
			return wrapped, &wrapped.drainWriter
		}
	}
	return s.drainGenericResponseWriter(w)
}

// drainGenericResponseWriter retains legacy optional interfaces for other writer
// shapes, including test recorders and custom middleware wrappers. Production
// net/http writers use the concrete wrappers above, which also retain FlushError.
func (s *server) drainGenericResponseWriter(w http.ResponseWriter) (http.ResponseWriter, *drainWriter) {
	state := &drainWriter{ResponseWriter: w, server: s}
	wrapped := httpsnoop.Wrap(w, httpsnoop.Hooks{
		WriteHeader: func(httpsnoop.WriteHeaderFunc) httpsnoop.WriteHeaderFunc { return state.WriteHeader },
		Write:       func(httpsnoop.WriteFunc) httpsnoop.WriteFunc { return state.Write },
		Flush:       func(httpsnoop.FlushFunc) httpsnoop.FlushFunc { return state.Flush },
		ReadFrom:    func(httpsnoop.ReadFromFunc) httpsnoop.ReadFromFunc { return state.readFrom },
		Hijack:      func(httpsnoop.HijackFunc) httpsnoop.HijackFunc { return state.hijack },
	})
	return wrapped, state
}

// drainReader delays the header check until ReadFrom has bytes to write. An
// empty or blocked source has not committed any response headers yet.
type drainReader struct {
	io.Reader
	writer *drainWriter
}

func (r *drainReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if n > 0 && r.writer != nil {
		r.writer.finish()
		r.writer = nil
	}
	return n, err
}
