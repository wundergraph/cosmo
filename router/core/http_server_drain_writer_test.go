package core

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
)

type drainTestHTTP1Writer struct{ *httptest.ResponseRecorder }

func (*drainTestHTTP1Writer) CloseNotify() <-chan bool { return nil }
func (*drainTestHTTP1Writer) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, http.ErrNotSupported
}
func (w *drainTestHTTP1Writer) ReadFrom(r io.Reader) (int64, error) {
	return io.Copy(w.ResponseRecorder, r)
}

type drainTestHTTP2Writer struct{ *httptest.ResponseRecorder }

func (*drainTestHTTP2Writer) CloseNotify() <-chan bool             { return nil }
func (*drainTestHTTP2Writer) Push(string, *http.PushOptions) error { return http.ErrNotSupported }

type drainTestPushHTTP1Writer struct{ *drainTestHTTP1Writer }

func (*drainTestPushHTTP1Writer) Push(string, *http.PushOptions) error { return http.ErrNotSupported }

type drainTestCopyHTTP2Writer struct{ *drainTestHTTP2Writer }

func (w *drainTestCopyHTTP2Writer) ReadFrom(r io.Reader) (int64, error) {
	return io.Copy(w.ResponseRecorder, r)
}

func TestServerDrain_PreservesWriterCapabilities(t *testing.T) {
	for _, tc := range []struct {
		name   string
		writer http.ResponseWriter
	}{
		{"http1", &drainTestHTTP1Writer{httptest.NewRecorder()}},
		{"http2", &drainTestHTTP2Writer{httptest.NewRecorder()}},
		{"http1 with push", &drainTestPushHTTP1Writer{&drainTestHTTP1Writer{httptest.NewRecorder()}}},
		{"http2 with copy", &drainTestCopyHTTP2Writer{&drainTestHTTP2Writer{httptest.NewRecorder()}}},
		{"recorder", httptest.NewRecorder()},
		{"basic", struct{ http.ResponseWriter }{httptest.NewRecorder()}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := &server{}
			wrapped, _ := srv.drainResponseWriter(tc.writer)
			for _, capability := range []reflect.Type{
				reflect.TypeFor[http.Flusher](),
				reflect.TypeFor[http.Hijacker](),
				reflect.TypeFor[io.ReaderFrom](),
				reflect.TypeFor[http.Pusher](),
				reflect.TypeFor[interface{ CloseNotify() <-chan bool }](),
			} {
				assert.Equal(t, reflect.TypeOf(tc.writer).Implements(capability), reflect.TypeOf(wrapped).Implements(capability), capability.String())
			}
			unwrapped, ok := wrapped.(interface{ Unwrap() http.ResponseWriter })
			if assert.True(t, ok) {
				assert.True(t, tc.writer == unwrapped.Unwrap(), "Unwrap must return the original writer")
			}
		})
	}
}
