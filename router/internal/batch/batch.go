package batch

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"github.com/cespare/xxhash/v2"
	"github.com/go-chi/chi/v5"
	"github.com/goccy/go-json"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	ctrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"io"
	"net/http"
	"strconv"
)

func getFirstNonWhitespaceChar(r io.Reader) (*byte, *bufio.Reader, error) {
	// This uses the default buffer of 4 kb
	bufReader := bufio.NewReaderSize(r, 16)

	for {
		peeked, err := bufReader.Peek(1)
		if err != nil {
			if err == io.EOF {
				return nil, bufReader, nil
			}
			return nil, nil, err
		}

		if len(peeked) == 0 {
			return nil, bufReader, nil
		}
		peekByte := peeked[0]
		switch peekByte {
		// we check the characters based on this RFC https://datatracker.ietf.org/doc/html/rfc8259
		// and also the array decode function in goccy/go-json (which is the library we used to decode)
		case ' ', '\n', '\t', '\r':
			bufReader.ReadByte()
			continue
		default:
			return &peekByte, bufReader, nil
		}
	}
}

func Handler(
	maxEntriesPerBatch, maxRoutines int,
	handlerSent http.Handler,
	tracerProvider *sdktrace.TracerProvider,
	clientHeader config.ClientHeader,
	baseOtelAttributes []attribute.KeyValue,
) http.Handler {
	tracer := tracerProvider.Tracer(
		"wundergraph/cosmo/router/internal/batch",
		trace.WithInstrumentationVersion("0.0.1"),
	)

	fn := func(w http.ResponseWriter, r *http.Request) {
		firstChar, bufReader, err := getFirstNonWhitespaceChar(r.Body)
		if err != nil {
			http.Error(w, "failed to read request", http.StatusBadRequest)
			return
		}

		// When the first non whitespace character is not
		// an array start assume it's a non batched request
		if firstChar == nil || *firstChar != '[' {
			// if firstChar is nil we have downstream handle it
			// which is the current behaviour
			r.Body = io.NopCloser(bufReader)
			handlerSent.ServeHTTP(w, r)
			return
		}

		bodyBytes, err := io.ReadAll(bufReader)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}

		var batchOperations []json.RawMessage
		if err = json.Unmarshal(bodyBytes, &batchOperations); err != nil {
			// If there is an error, it's likely a malformed json array
			// as the start character is "["
			http.Error(w, "unexpected request body", http.StatusBadRequest)
			return
		}

		batchOperationsLength := len(batchOperations)

		addTracing(r, bodyBytes, clientHeader, batchOperationsLength, baseOtelAttributes)

		// When a max batch limit has been specified
		if batchOperationsLength > maxEntriesPerBatch {
			http.Error(w, "unable to process request", http.StatusBadRequest)
			return
		}

		// Store the batch in the request context.
		r = r.WithContext(context.WithValue(r.Context(), IsBatchedRequestKey{}, true))

		// We have a batched request.
		responses := make([]json.RawMessage, batchOperationsLength)

		sem := make(chan struct{}, maxRoutines)
		// Process each operation in parallel.
		for i, singleOp := range batchOperations {
			// print the pointer value of the above
			sem <- struct{}{}

			go func() {
				defer func() {
					<-sem
				}()

				spanCtx, span := tracer.Start(
					r.Context(), fmt.Sprintf("batch-operation-%d", i),
				)

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

func addTracing(
	r *http.Request,
	bodyBytes []byte,
	clientHeader config.ClientHeader,
	batchOperationsLength int,
	baseOtelAttributes []attribute.KeyValue,
) {
	rootSpan := trace.SpanFromContext(r.Context())

	stringBody := string(bodyBytes)

	digest := xxhash.New()
	digest.WriteString(stringBody)
	operationHashBatch := strconv.FormatUint(digest.Sum64(), 10)

	clientName, clientVersion := ctrace.GetClientDetails(r, clientHeader)

	rootSpan.SetAttributes(baseOtelAttributes...)
	rootSpan.SetAttributes(
		otel.WgIsBatchedOperation.Bool(true),
		otel.WgOperationHash.String(operationHashBatch),
		otel.WgClientName.String(clientName),
		otel.WgClientVersion.String(clientVersion),
		otel.WgBatchedRecordsCount.Int(batchOperationsLength),
	)
}
