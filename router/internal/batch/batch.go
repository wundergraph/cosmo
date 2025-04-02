package batch

import (
	"bytes"
	"context"
	"fmt"
	"github.com/go-chi/chi/v5"
	"github.com/goccy/go-json"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"io"
	"net/http"
)

const unlimitedBatchEntries = 0

func Handler(maxEntriesPerBatch, maxRoutines int, handlerSent http.Handler, tracerProvider *sdktrace.TracerProvider) http.Handler {
	tracer := tracerProvider.Tracer(
		"wundergraph/cosmo/router/internal/batch",
		trace.WithInstrumentationVersion("0.0.1"),
	)

	fn := func(w http.ResponseWriter, r *http.Request) {
		// Read the request body for potential batching.
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request", http.StatusBadRequest)
			return
		}

		// Restore the body for further processing (if needed)
		r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		// When not a batched request, continue as normal.
		var batchOperations []json.RawMessage
		if err = json.Unmarshal(bodyBytes, &batchOperations); err != nil {
			handlerSent.ServeHTTP(w, r)
			return
		}

		batchOperationsLength := len(batchOperations)

		// When a max batch limit has been specified
		if maxEntriesPerBatch != unlimitedBatchEntries && batchOperationsLength > maxEntriesPerBatch {
			http.Error(w, fmt.Sprintf("unable to process request"), http.StatusBadRequest)
			return
		}

		// Store the batch in the request context.
		r = r.WithContext(context.WithValue(r.Context(), IsBatchedRequestKey{}, true))

		// We have a batched request.
		responses := make([]json.RawMessage, batchOperationsLength)

		sem := make(chan struct{}, maxRoutines)
		// Process each operation in parallel.
		// TODO: Verify we do not need to assign i and singleOp to new variables as of go 1.23
		for i, singleOp := range batchOperations {
			sem <- struct{}{}

			go func() {
				defer func() {
					<-sem
				}()

				spanCtx, span := tracer.Start(r.Context(), fmt.Sprintf("batch-operation-%d", i))

				defer span.End()

				// TODO: Check if we should pass the spanCtx, or r.Context() to the new request
				// Create a new request for the single operation.
				rCopy := r.Clone(spanCtx)
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
		for n := maxRoutines; n > 0; n-- {
			sem <- struct{}{}
		}

		// TODO: Check if we actually need to manually drain this, is it GCd?
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
