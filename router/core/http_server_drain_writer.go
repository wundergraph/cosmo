package core

import (
	"bufio"
	"io"
	"net"
	"net/http"
)

// These interfaces describe the standard library's HTTP/1 and HTTP/2 writers.
type serverHTTP1Writer interface {
	http.ResponseWriter
	http.Flusher
	http.Hijacker
	io.ReaderFrom
	CloseNotify() <-chan bool
}

type serverHTTP2Writer interface {
	http.ResponseWriter
	http.Flusher
	http.Pusher
	CloseNotify() <-chan bool
}

type drainWriter struct {
	http.ResponseWriter
	server    *server
	committed bool
}

func (w *drainWriter) commit(code int) {
	if w.committed || (code >= 100 && code < 200 && code != http.StatusSwitchingProtocols) {
		return
	}
	w.committed = true
	if code != http.StatusSwitchingProtocols && w.server.draining.Load() {
		w.Header().Set("Connection", "close")
	}
}

func (w *drainWriter) finish()                     { w.commit(http.StatusOK) }
func (w *drainWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *drainWriter) WriteHeader(code int) {
	w.commit(code)
	w.ResponseWriter.WriteHeader(code)
}

func (w *drainWriter) Write(p []byte) (int, error) {
	w.commit(http.StatusOK)
	return w.ResponseWriter.Write(p)
}

func (w *drainWriter) FlushError() error {
	w.commit(http.StatusOK)
	return http.NewResponseController(w.ResponseWriter).Flush()
}

func (w *drainWriter) Flush() { _ = w.FlushError() }

func (w *drainWriter) CloseNotify() <-chan bool {
	return w.ResponseWriter.(interface{ CloseNotify() <-chan bool }).CloseNotify()
}

type drainHTTP1ResponseWriter struct{ drainWriter }

func (w *drainHTTP1ResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return w.hijack()
}

func (w *drainHTTP1ResponseWriter) ReadFrom(r io.Reader) (int64, error) {
	return w.readFrom(r)
}

func (w *drainWriter) hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, rw, err := w.ResponseWriter.(http.Hijacker).Hijack()
	if err == nil {
		w.committed = true
	}
	return conn, rw, err
}

func (w *drainWriter) readFrom(r io.Reader) (int64, error) {
	readerFrom := w.ResponseWriter.(io.ReaderFrom)
	if w.committed {
		// Preserve source-specific copying optimizations once headers are fixed.
		return readerFrom.ReadFrom(r)
	}
	return readerFrom.ReadFrom(&drainReader{Reader: r, writer: w})
}

type drainHTTP2ResponseWriter struct{ drainWriter }

func (w *drainHTTP2ResponseWriter) Push(target string, opts *http.PushOptions) error {
	return w.ResponseWriter.(http.Pusher).Push(target, opts)
}
