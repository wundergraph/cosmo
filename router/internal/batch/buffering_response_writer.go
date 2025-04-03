package batch

import (
	"bytes"
	"net/http"
)

type bufferingResponseWriter struct {
	HeaderMap http.Header
	Body      *bytes.Buffer
	Status    int
}

func newBufferingResponseWriter() *bufferingResponseWriter {
	return &bufferingResponseWriter{
		HeaderMap: make(http.Header),
		Body:      &bytes.Buffer{},
		Status:    http.StatusOK,
	}
}

func (brw *bufferingResponseWriter) Header() http.Header {
	return brw.HeaderMap
}

func (brw *bufferingResponseWriter) Write(b []byte) (int, error) {
	return brw.Body.Write(b)
}

func (brw *bufferingResponseWriter) WriteHeader(statusCode int) {
	brw.Status = statusCode
}
