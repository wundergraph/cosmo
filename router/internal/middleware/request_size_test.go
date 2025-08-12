package middleware

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestRequestSizeAndCompression(t *testing.T) {
	// Define maximum allowed request size
	const maxRequestSize = 1024 // Example: 1 KB

	// Chain the compression and request_size middlewares
	r := chi.NewMux()
	r.Use(HandleCompression(zap.NewNop()))
	r.Use(RequestSize(maxRequestSize))

	t.Run("request size limiter should not allow requests exceeding allowed maximum request size", func(t *testing.T) {
		// Recorder to capture the response
		recorder := httptest.NewRecorder()

		// Write a large payload that exceeds the maxRequestSize after decompression
		largePayload := strings.Repeat("A", maxRequestSize*10) // 10x the max size

		// Create the request with the gzip bomb payload
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(largePayload))

		r.HandleFunc("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, err := io.Copy(io.Discard, r.Body)
			require.ErrorContains(t, err, "http: request body too large")
			w.WriteHeader(http.StatusRequestEntityTooLarge)
		}))

		r.ServeHTTP(recorder, req)

		// Assert that the response status is 413 Payload Too Large
		require.Equal(t, http.StatusRequestEntityTooLarge, recorder.Code)
	})

	t.Run("request size limiter should reject gzip bomb exceeding allowed maximum request size", func(t *testing.T) {
		// Recorder to capture the response
		recorder := httptest.NewRecorder()

		// Create a gzip bomb payload
		var buf bytes.Buffer
		w := gzip.NewWriter(&buf)

		// Write a large payload that exceeds the maxRequestSize after decompression
		largePayload := strings.Repeat("A", maxRequestSize*10) // 10x the max size
		_, err := w.Write([]byte(largePayload))
		require.NoError(t, err)
		require.NoError(t, w.Close())

		// Create the request with the gzip bomb payload
		req := httptest.NewRequest(http.MethodPost, "/", &buf)
		req.Header.Set("Content-Encoding", "gzip")

		r.HandleFunc("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, err := io.Copy(io.Discard, r.Body)
			require.ErrorContains(t, err, "http: request body too large")
			w.WriteHeader(http.StatusRequestEntityTooLarge)
		}))

		r.ServeHTTP(recorder, req)

		// Assert that the response status is 413 Payload Too Large
		require.Equal(t, http.StatusRequestEntityTooLarge, recorder.Code)
	})
}
