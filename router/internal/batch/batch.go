package batch

import (
	"bytes"
	"context"
	"github.com/go-chi/chi/v5"
	"github.com/goccy/go-json"
	"io"
	"net/http"
	"sync"
)

// IsBatchedRequestKey is a context key used to identify batched requests.
type IsBatchedRequestKey struct{}

func Batch() func(http.Handler) http.Handler {

	f := func(h http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {

			// 1. Read the request body for potential batching.
			bodyBytes, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "failed to read request", http.StatusBadRequest)
				return
			}
			// Restore the body for further processing (if needed)
			r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

			// 2. Check if the request is a batched operation.
			var batchOperations []json.RawMessage
			if json.Unmarshal(bodyBytes, &batchOperations) == nil {

				// Store the batch in the request context.
				r = r.WithContext(context.WithValue(r.Context(), IsBatchedRequestKey{}, true))

				// We have a batched request.
				responses := make([]json.RawMessage, len(batchOperations))
				var wg sync.WaitGroup
				wg.Add(len(batchOperations))

				// Process each operation in parallel.
				for i, singleOp := range batchOperations {
					// Capture loop variables.
					i, singleOp := i, singleOp
					go func() {
						defer wg.Done()
						// Create a new request for the single operation.
						rCopy := r.Clone(r.Context())
						// Reset the route context to avoid sharing mutable state.
						rCopy = rCopy.WithContext(context.WithValue(rCopy.Context(), chi.RouteCtxKey, chi.NewRouteContext()))
						rCopy.Body = io.NopCloser(bytes.NewBuffer(singleOp))
						// Create a ResponseWriter that captures the output.
						rw := newBufferingResponseWriter()
						// Execute the mux handler for this operation.
						h.ServeHTTP(rw, rCopy)

						// Store the response (assuming the response is valid JSON).
						responses[i] = rw.Body.Bytes()
					}()
				}

				// Wait for all operations to complete.
				wg.Wait()

				// Write out the batched response as a JSON array.
				w.Header().Set("Content-Type", "application/json")
				if err := json.NewEncoder(w).Encode(responses); err != nil {
					http.Error(w, "failed to encode batched response", http.StatusInternalServerError)
				}
				return
			}

			// 3. Not a batched request, continue as normal.
			h.ServeHTTP(w, r)
		}

		return http.HandlerFunc(fn)
	}

	return f
}

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
