package core

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// drainBenchmarkWriter models the capabilities of net/http's HTTP/1 writer
// without including network or response-buffer allocation in the measurement.
type drainBenchmarkWriter struct{ header http.Header }

func (w *drainBenchmarkWriter) Header() http.Header       { return w.header }
func (*drainBenchmarkWriter) WriteHeader(int)             {}
func (*drainBenchmarkWriter) Write(p []byte) (int, error) { return len(p), nil }
func (*drainBenchmarkWriter) Flush()                      {}
func (*drainBenchmarkWriter) FlushError() error           { return nil }
func (*drainBenchmarkWriter) CloseNotify() <-chan bool    { return nil }
func (*drainBenchmarkWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, net.ErrClosed
}
func (*drainBenchmarkWriter) ReadFrom(r io.Reader) (int64, error) { return io.Copy(io.Discard, r) }

func BenchmarkServerDrainHandler(b *testing.B) {
	for _, mode := range []string{"disabled", "request_entry", "configured"} {
		b.Run(mode, func(b *testing.B) {
			mux := chi.NewRouter()
			mux.Post("/graphql", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
			srv := &server{drainEnabled: mode == "configured"}
			srv.state.Store(&serverState{mux: mux})
			handler := http.HandlerFunc(srv.serveHTTP)
			if mode == "request_entry" {
				handler = func(w http.ResponseWriter, r *http.Request) {
					if srv.draining.Load() {
						w.Header().Set("Connection", "close")
					}
					srv.state.Load().mux.ServeHTTP(w, r)
				}
			}
			req := httptest.NewRequest(http.MethodPost, "http://router.test/graphql", nil)
			w := &drainBenchmarkWriter{header: make(http.Header)}
			b.ReportAllocs()
			for b.Loop() {
				handler.ServeHTTP(w, req)
			}
		})
	}
}
