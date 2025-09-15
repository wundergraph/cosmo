package middleware

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"compress/gzip"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestHandleCompression(t *testing.T) {
	t.Parallel()

	t.Run("Should ignore any request that is not a POST request", func(t *testing.T) {
		t.Parallel()

		tests := []struct {
			method string
		}{
			{
				method: "GET",
			},
			{
				method: "PUT",
			},
			{
				method: "DELETE",
			},
			{
				method: "OPTIONS",
			},
		}

		for _, tc := range tests {
			t.Run("should call next without attempting to handle gzip for method "+tc.method, func(t *testing.T) {
				t.Parallel()

				recorder := httptest.NewRecorder()

				next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusOK)
				})

				req := httptest.NewRequest(tc.method, "/", strings.NewReader("test"))

				HandleCompression(zap.NewNop())(next).ServeHTTP(recorder, req)

				require.Equal(t, http.StatusOK, recorder.Code)
			})
		}
	})

	t.Run("Should ignore chained compressions", func(t *testing.T) {
		t.Parallel()

		recorder := httptest.NewRecorder()

		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("test"))
		req.Header.Set("Content-Encoding", "gzip, deflate")

		HandleCompression(zap.NewNop())(next).ServeHTTP(recorder, req)

		require.Equal(t, http.StatusBadRequest, recorder.Code)
	})

	t.Run("Should successfully process gzipped compressed payload and return status 200", func(t *testing.T) {
		t.Parallel()

		recorder := httptest.NewRecorder()

		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Emptyf(t, r.Header.Get("Content-Encoding"), "Content-Encoding header should be removed")
			w.WriteHeader(http.StatusOK)

			require.IsType(t, &gzip.Reader{}, r.Body)

			b, err := io.ReadAll(r.Body)
			require.NoError(t, err)

			require.Equal(t, "test", string(b))
		})

		// create gzip compressed request

		var buf bytes.Buffer
		w := gzip.NewWriter(&buf)

		_, err := w.Write([]byte("test"))
		require.NoError(t, err)
		require.NoError(t, w.Close())

		req := httptest.NewRequest(http.MethodPost, "/", &buf)
		req.Header.Set("Content-Encoding", "gzip")

		HandleCompression(zap.NewNop())(next).ServeHTTP(recorder, req)
		require.Equal(t, http.StatusOK, recorder.Code)

	})

	t.Run("Should return status 422 for invalid gzip payload", func(t *testing.T) {
		t.Parallel()

		recorder := httptest.NewRecorder()

		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("test"))
		req.Header.Set("Content-Encoding", "gzip")

		HandleCompression(zap.NewNop())(next).ServeHTTP(recorder, req)

		require.Equal(t, http.StatusUnprocessableEntity, recorder.Code)
	})

	t.Run("Should return status 415 for unsupported content encoding", func(t *testing.T) {
		t.Parallel()

		recorder := httptest.NewRecorder()

		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("test"))
		req.Header.Set("Content-Encoding", "deflate")

		HandleCompression(zap.NewNop())(next).ServeHTTP(recorder, req)

		require.Equal(t, http.StatusUnsupportedMediaType, recorder.Code)
		require.Equal(t, "unsupported media type\n", recorder.Body.String())
	})

	t.Run("Should not handle gzip compression when no content encoding is set", func(t *testing.T) {
		t.Parallel()

		recorder := httptest.NewRecorder()

		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("test"))

		HandleCompression(zap.NewNop())(next).ServeHTTP(recorder, req)

		require.Equal(t, http.StatusOK, recorder.Code)
	})
}
