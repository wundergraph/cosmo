package batch

import (
	"bytes"
	"context"
	"github.com/go-chi/chi/v5"
	"github.com/goccy/go-json"
	"io"
	"net/http"
)

// IsBatchedRequestKey is a context key used to identify batched requests.
type IsBatchedRequestKey struct{}

func Handler(routineLimit uint, handlerSent http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		// 1. Read the request body for potential batching.
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request", http.StatusBadRequest)
			return
		}

		// Restore the body for further processing (if needed)
		r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		// 2. Not a batched request, continue as normal.
		var batchOperations []json.RawMessage
		if err = json.Unmarshal(bodyBytes, &batchOperations); err != nil {
			handlerSent.ServeHTTP(w, r)
			return
		}

		// 3. Batched request detected.
		// Store the batch in the request context.
		r = r.WithContext(context.WithValue(r.Context(), IsBatchedRequestKey{}, true))

		// We have a batched request.
		responses := make([]json.RawMessage, len(batchOperations))
		//var wg sync.WaitGroup
		//wg.Add(len(batchOperations))

		sem := make(chan struct{}, routineLimit)
		// Process each operation in parallel.
		for i, singleOp := range batchOperations {
			// TODO: Verify this is not needed as of go 1.23
			//i, singleOp := i, singleOp

			sem <- struct{}{}

			go func() {
				defer func() {
					<-sem
				}()
				// Create a new request for the single operation.
				rCopy := r.Clone(r.Context())
				// Reset the route context to avoid sharing mutable state.
				rCopy = rCopy.WithContext(context.WithValue(rCopy.Context(), chi.RouteCtxKey, chi.NewRouteContext()))
				rCopy.Body = io.NopCloser(bytes.NewBuffer(singleOp))

				// Create a ResponseWriter that captures the output.
				rw := newBufferingResponseWriter()
				// Execute the mux handler for this operation.
				handlerSent.ServeHTTP(rw, rCopy)

				// Store the response (assuming the response is valid JSON).
				responses[i] = rw.Body.Bytes()
			}()
		}

		// Wait for all operations to be completed by blocking.
		for n := routineLimit; n > 0; n-- {
			sem <- struct{}{}
		}

		// Drain and close the semaphore.
		for len(sem) > 0 {
			<-sem
		}
		close(sem)

		// Write out the batched response as a JSON array.
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(responses); err != nil {
			http.Error(w, "failed to encode batched response", http.StatusInternalServerError)
		}
	}

	return http.HandlerFunc(fn)
}
